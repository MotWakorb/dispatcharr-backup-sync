import cron from 'node-cron';
import parser from 'cron-parser';
import { scheduleStore } from './scheduleStore.js';
import { savedConnectionStore } from './savedConnectionStore.js';
import { settingsStore } from './settingsStore.js';
import { exportService } from './exportService.js';
import { syncService } from './syncService.js';
import { jobManager } from './jobManager.js';
import { notificationService } from './notificationService.js';
import { createLogger } from './logger.js';
import type { Schedule, SchedulePreset } from '../types/index.js';

const log = createLogger('scheduler');

// Preset cron expressions
const PRESET_CRONS: Record<SchedulePreset, string> = {
  hourly: '0 * * * *', // At minute 0 of every hour
  daily: '0 2 * * *', // At 2:00 AM every day
  weekly: '0 2 * * 0', // At 2:00 AM every Sunday
  monthly: '0 2 1 * *', // At 2:00 AM on the 1st of each month
  custom: '', // User-defined
};

// Default retry settings
const DEFAULT_RETRY_DELAY_MINUTES = 5;
const MAX_RETRY_DELAY_MINUTES = 60;

class SchedulerService {
  private scheduledTasks: Map<string, cron.ScheduledTask> = new Map();
  private runningJobs: Map<string, string> = new Map(); // scheduleId -> jobId
  private pendingRetries: Map<string, NodeJS.Timeout> = new Map(); // scheduleId -> retry timeout
  private currentTimezone: string = 'UTC';
  private initialized: boolean = false;

  // Check if scheduler is initialized
  isInitialized(): boolean {
    return this.initialized;
  }

  // Initialize on startup
  async initialize(): Promise<void> {
    log.info('Initializing scheduler service');
    try {
      // Load timezone from settings
      this.currentTimezone = await settingsStore.getTimezone();
      log.info({ timezone: this.currentTimezone }, 'Scheduler using timezone');

      // Handle interrupted jobs from previous run
      await this.recoverInterruptedJobs();

      const schedules = await scheduleStore.getAll();
      for (const schedule of schedules) {
        if (schedule.enabled) {
          await this.scheduleJob(schedule);
        }
      }
      this.initialized = true;
      log.info({ count: this.scheduledTasks.size }, 'Scheduler initialized with active schedules');
    } catch (error) {
      log.error({ err: error }, 'Failed to initialize scheduler');
    }
  }

  // Recover jobs that were interrupted by server restart
  private async recoverInterruptedJobs(): Promise<void> {
    try {
      // Find and mark interrupted runs
      const interrupted = await scheduleStore.markInterruptedRuns();

      if (interrupted.length === 0) {
        log.debug('No interrupted jobs to recover');
        return;
      }

      log.info(
        { count: interrupted.length, jobIds: interrupted.map((e) => e.jobId) },
        'Found interrupted scheduled jobs from previous run'
      );

      // Get schedules that should be re-queued (still enabled)
      const schedulesToRequeue = await scheduleStore.getSchedulesToRequeue(interrupted);

      if (schedulesToRequeue.length === 0) {
        log.info('No enabled schedules to requeue after recovery');
        return;
      }

      log.info(
        { count: schedulesToRequeue.length, scheduleIds: schedulesToRequeue },
        'Re-queuing interrupted schedules'
      );

      // Schedule re-runs after a brief delay (30 seconds) to allow full startup
      const RECOVERY_DELAY_MS = 30 * 1000;

      for (const scheduleId of schedulesToRequeue) {
        const schedule = await scheduleStore.getById(scheduleId);
        if (!schedule) continue;

        // Send notification about recovery
        notificationService
          .notify({
            type: 'job_recovered',
            scheduleName: schedule.name,
            jobType: schedule.jobType,
            timestamp: new Date().toISOString(),
            message: `Schedule "${schedule.name}" was interrupted by server restart and will be re-run in 30 seconds`,
          })
          .catch((err) => log.error({ err }, 'Failed to send recovery notification'));

        // Queue the recovery run
        const timeout = setTimeout(async () => {
          log.info({ scheduleId, scheduleName: schedule.name }, 'Executing recovery run');
          await this.executeSchedule(scheduleId, false, 0);
        }, RECOVERY_DELAY_MS);

        // Don't prevent process exit
        if (timeout.unref) {
          timeout.unref();
        }
      }
    } catch (error) {
      log.error({ err: error }, 'Failed to recover interrupted jobs');
    }
  }

  // Reinitialize all schedules with a new timezone
  async reinitializeWithTimezone(timezone: string): Promise<void> {
    log.info({ timezone }, 'Reinitializing scheduler with timezone');
    this.currentTimezone = timezone;

    // Stop all current tasks
    for (const [id, task] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();

    // Reschedule all enabled schedules
    const schedules = await scheduleStore.getAll();
    for (const schedule of schedules) {
      if (schedule.enabled) {
        await this.scheduleJob(schedule);
      }
    }
    log.info({ count: this.scheduledTasks.size }, 'Scheduler reinitialized with active schedules');
  }

  // Get cron expression for a schedule
  // Always use the saved cronExpression if available (built by frontend time picker)
  // Only fall back to preset defaults if no cronExpression was saved
  getCronExpression(schedule: Schedule): string {
    if (schedule.cronExpression) {
      return schedule.cronExpression;
    }
    // Fallback to preset defaults (for backwards compatibility with old schedules)
    return PRESET_CRONS[schedule.schedulePreset];
  }

  // Schedule a job based on its configuration
  async scheduleJob(schedule: Schedule): Promise<void> {
    // Remove existing task if any
    this.unscheduleJob(schedule.id);

    const cronExpr = this.getCronExpression(schedule);

    if (!cron.validate(cronExpr)) {
      log.error({ scheduleId: schedule.id, cronExpr }, 'Invalid cron expression');
      return;
    }

    const task = cron.schedule(
      cronExpr,
      async () => {
        await this.executeSchedule(schedule.id);
      },
      {
        scheduled: true,
        timezone: this.currentTimezone,
      }
    );

    this.scheduledTasks.set(schedule.id, task);

    // Calculate and store next run time
    await this.updateNextRunTime(schedule.id, cronExpr);

    log.info(
      {
        scheduleName: schedule.name,
        scheduleId: schedule.id,
        cronExpr,
        timezone: this.currentTimezone,
      },
      'Scheduled job'
    );
  }

  // Remove a scheduled job
  unscheduleJob(scheduleId: string): void {
    const task = this.scheduledTasks.get(scheduleId);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(scheduleId);
      log.debug({ scheduleId }, 'Unscheduled job');
    }
  }

  // Execute the scheduled job with optional retry tracking
  async executeSchedule(
    scheduleId: string,
    isRetry: boolean = false,
    retryAttempt: number = 0
  ): Promise<string | undefined> {
    // Prevent concurrent runs of the same schedule
    if (this.runningJobs.has(scheduleId)) {
      log.debug({ scheduleId }, 'Schedule is already running, skipping this execution');
      return undefined;
    }

    // Cancel any pending retry for this schedule (we're running now)
    this.cancelPendingRetry(scheduleId);

    let jobId: string | undefined;
    let schedule: Schedule | undefined;
    let startTime: number = Date.now();
    let jobFailed = false;
    let failureError: string | undefined;

    try {
      schedule = await scheduleStore.getById(scheduleId);
      if (!schedule) {
        log.error({ scheduleId }, 'Schedule not found');
        return undefined;
      }

      // Get source connection
      const sourceConn = await savedConnectionStore.getById(schedule.sourceConnectionId);
      if (!sourceConn) {
        log.error(
          { connectionId: schedule.sourceConnectionId, scheduleId },
          'Source connection not found'
        );
        return undefined;
      }

      // Create job
      jobId = jobManager.createJob(schedule.jobType);
      this.runningJobs.set(scheduleId, jobId);

      // Record run start (with retry info if applicable)
      await scheduleStore.recordRunStart(scheduleId, jobId, isRetry, retryAttempt || undefined);
      startTime = Date.now();

      const logContext = {
        scheduleName: schedule.name,
        scheduleId,
        jobId,
        ...(isRetry && { isRetry, retryAttempt }),
      };
      log.info(logContext, isRetry ? 'Retrying schedule' : 'Executing schedule');

      // Send start notification (async, don't wait)
      notificationService
        .notify({
          type: isRetry ? 'job_retry_started' : 'job_started',
          scheduleName: schedule.name,
          jobType: schedule.jobType,
          jobId,
          timestamp: new Date().toISOString(),
          ...(isRetry && { retryAttempt }),
        })
        .catch((err) => log.error({ err }, 'Failed to send start notification'));

      if (schedule.jobType === 'backup') {
        await exportService.export(
          {
            source: {
              url: sourceConn.instanceUrl,
              username: sourceConn.username,
              password: sourceConn.password,
            },
            options: schedule.options,
            dryRun: false,
          },
          jobId
        );

        // Apply retention policy after successful backup
        if (schedule.retentionCount && schedule.retentionCount > 0) {
          await this.applyRetentionPolicy(scheduleId, schedule.retentionCount);
        }
      } else if (schedule.jobType === 'sync') {
        // Get destination connection
        const destConn = await savedConnectionStore.getById(schedule.destinationConnectionId!);
        if (!destConn) {
          throw new Error(`Destination connection ${schedule.destinationConnectionId} not found`);
        }

        await syncService.sync(
          {
            source: {
              url: sourceConn.instanceUrl,
              username: sourceConn.username,
              password: sourceConn.password,
            },
            destination: {
              url: destConn.instanceUrl,
              username: destConn.username,
              password: destConn.password,
            },
            options: schedule.options,
            dryRun: false,
          },
          jobId
        );
      }

      // Record success and reset failure counter
      await scheduleStore.recordRunComplete(scheduleId, jobId, 'completed');
      await scheduleStore.resetConsecutiveFailures(scheduleId);
      log.info({ scheduleName: schedule.name, scheduleId }, 'Schedule completed successfully');

      // Check if job completed with errors
      const jobResult = jobManager.getJob(jobId);
      let totalErrors = 0;

      if (jobResult?.result) {
        // Count errors from all sync/export sections
        for (const key in jobResult.result) {
          const section = jobResult.result[key];
          if (section && typeof section === 'object' && 'errors' in section) {
            totalErrors += section.errors || 0;
          }
        }
      }

      // Send appropriate completion notification (async, don't wait)
      const notificationType = totalErrors > 0 ? 'job_completed_with_errors' : 'job_completed';
      notificationService
        .notify({
          type: notificationType,
          scheduleName: schedule.name,
          jobType: schedule.jobType,
          jobId,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          ...(totalErrors > 0 && { errorCount: totalErrors }),
        })
        .catch((err) => log.error({ err }, 'Failed to send completion notification'));
    } catch (error: any) {
      jobFailed = true;
      failureError = error.message;
      log.error({ err: error, scheduleId, isRetry, retryAttempt }, 'Schedule failed');

      // Record failure and increment failure counter
      if (jobId) {
        await scheduleStore.recordRunComplete(scheduleId, jobId, 'failed', error.message);
      }
      const consecutiveFailures = await scheduleStore.incrementConsecutiveFailures(scheduleId);

      // Determine if we should retry
      if (schedule) {
        const maxRetries = schedule.maxRetries || 0;
        const shouldRetry = maxRetries > 0 && consecutiveFailures <= maxRetries;

        if (shouldRetry) {
          // Schedule retry
          const retryDelayMinutes = Math.min(
            schedule.retryDelayMinutes || DEFAULT_RETRY_DELAY_MINUTES,
            MAX_RETRY_DELAY_MINUTES
          );
          this.scheduleRetry(scheduleId, consecutiveFailures, retryDelayMinutes);

          // Send retry scheduled notification
          notificationService
            .notify({
              type: 'job_retry_scheduled',
              scheduleName: schedule.name,
              jobType: schedule.jobType,
              jobId,
              timestamp: new Date().toISOString(),
              error: error.message,
              duration: Date.now() - startTime,
              retryAttempt: consecutiveFailures,
              maxRetries,
              retryDelayMinutes,
            })
            .catch((err) => log.error({ err }, 'Failed to send retry scheduled notification'));
        } else {
          // Max retries exhausted or no retries configured
          const notificationType = maxRetries > 0 ? 'job_failed_max_retries' : 'job_failed';
          notificationService
            .notify({
              type: notificationType,
              scheduleName: schedule.name,
              jobType: schedule.jobType,
              jobId,
              timestamp: new Date().toISOString(),
              error: error.message,
              duration: Date.now() - startTime,
              ...(maxRetries > 0 && { consecutiveFailures, maxRetries }),
            })
            .catch((err) => log.error({ err }, 'Failed to send failure notification'));
        }
      }
    } finally {
      this.runningJobs.delete(scheduleId);

      // Update next run time (re-fetch in case it was modified)
      const currentSchedule = await scheduleStore.getById(scheduleId);
      if (currentSchedule && currentSchedule.enabled) {
        const cronExpr = this.getCronExpression(currentSchedule);
        await this.updateNextRunTime(scheduleId, cronExpr);
      }
    }

    return jobId;
  }

  // Schedule a retry for a failed job
  private scheduleRetry(scheduleId: string, retryAttempt: number, delayMinutes: number): void {
    // Cancel any existing pending retry
    this.cancelPendingRetry(scheduleId);

    const delayMs = delayMinutes * 60 * 1000;
    log.info(
      { scheduleId, retryAttempt, delayMinutes },
      `Scheduling retry #${retryAttempt} in ${delayMinutes} minutes`
    );

    const timeout = setTimeout(async () => {
      this.pendingRetries.delete(scheduleId);

      // Re-fetch schedule to check if it's still enabled
      const schedule = await scheduleStore.getById(scheduleId);
      if (!schedule || !schedule.enabled) {
        log.info({ scheduleId }, 'Schedule disabled or deleted, skipping retry');
        return;
      }

      // Execute the retry
      await this.executeSchedule(scheduleId, true, retryAttempt);
    }, delayMs);

    // Don't prevent process exit
    if (timeout.unref) {
      timeout.unref();
    }

    this.pendingRetries.set(scheduleId, timeout);
  }

  // Cancel a pending retry
  private cancelPendingRetry(scheduleId: string): void {
    const timeout = this.pendingRetries.get(scheduleId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingRetries.delete(scheduleId);
      log.debug({ scheduleId }, 'Cancelled pending retry');
    }
  }

  // Calculate next run time from cron expression
  private async updateNextRunTime(scheduleId: string, cronExpr: string): Promise<void> {
    try {
      const interval = parser.parseExpression(cronExpr, {
        tz: this.currentTimezone,
      });
      const nextRun = interval.next().toISOString();
      await scheduleStore.updateNextRunTime(scheduleId, nextRun);
    } catch (error) {
      log.error({ err: error, scheduleId }, 'Failed to calculate next run time');
    }
  }

  // Get current timezone
  getTimezone(): string {
    return this.currentTimezone;
  }

  // Trigger manual run of a schedule (works even if disabled)
  async triggerManualRun(scheduleId: string): Promise<string | undefined> {
    const schedule = await scheduleStore.getById(scheduleId);
    if (!schedule) {
      throw new Error('Schedule not found');
    }

    if (this.runningJobs.has(scheduleId)) {
      throw new Error('Schedule is already running');
    }

    return this.executeSchedule(scheduleId);
  }

  // Check if a schedule is currently running
  isRunning(scheduleId: string): boolean {
    return this.runningJobs.has(scheduleId);
  }

  // Get running job ID for a schedule
  getRunningJobId(scheduleId: string): string | undefined {
    return this.runningJobs.get(scheduleId);
  }

  // Validate cron expression
  validateCron(expression: string): boolean {
    return cron.validate(expression);
  }

  // Apply retention policy - delete old backups beyond the retention count
  private async applyRetentionPolicy(scheduleId: string, retentionCount: number): Promise<void> {
    try {
      log.debug({ scheduleId, retentionCount }, 'Applying retention policy');

      // Get all completed backup job IDs for this schedule, sorted newest first
      const completedJobIds = await scheduleStore.getCompletedBackupJobIds(scheduleId);

      if (completedJobIds.length <= retentionCount) {
        log.debug(
          { backupCount: completedJobIds.length, retentionCount },
          'Retention: no cleanup needed'
        );
        return;
      }

      // Get the job IDs to delete (oldest ones beyond retention count)
      const jobIdsToDelete = completedJobIds.slice(retentionCount);

      log.debug({ deleteCount: jobIdsToDelete.length }, 'Retention: Deleting old backups');

      // Delete the backup files
      const result = await exportService.cleanupOldBackups(jobIdsToDelete);

      // Delete the history entries for deleted backups
      if (result.deleted.length > 0) {
        await scheduleStore.deleteHistoryEntries(result.deleted);
        log.info(
          { cleanedUp: result.deleted.length },
          'Retention: Cleaned up old backups and history entries'
        );
      }

      if (result.errors.length > 0) {
        log.error(
          { errorCount: result.errors.length, errors: result.errors },
          'Retention: Encountered errors during cleanup'
        );
      }
    } catch (error) {
      log.error({ err: error, scheduleId }, 'Retention: Failed to apply retention policy');
      // Don't throw - retention failure shouldn't fail the backup job
    }
  }

  // Get human-readable description of preset
  getPresetDescription(preset: SchedulePreset): string {
    const descriptions: Record<SchedulePreset, string> = {
      hourly: 'Every hour at minute 0',
      daily: 'Daily at 2:00 AM',
      weekly: 'Every Sunday at 2:00 AM',
      monthly: 'On the 1st of each month at 2:00 AM',
      custom: 'Custom schedule',
    };
    return descriptions[preset];
  }

  // Shutdown gracefully
  shutdown(): void {
    log.info('Shutting down scheduler service');

    // Stop all scheduled tasks
    for (const [id, task] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();

    // Cancel all pending retries
    for (const [id, timeout] of this.pendingRetries) {
      clearTimeout(timeout);
    }
    this.pendingRetries.clear();

    log.info('Scheduler service shut down');
  }
}

export const schedulerService = new SchedulerService();
