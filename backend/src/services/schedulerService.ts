import cron from 'node-cron';
import parser from 'cron-parser';
import { scheduleStore } from './scheduleStore.js';
import { savedConnectionStore } from './savedConnectionStore.js';
import { settingsStore } from './settingsStore.js';
import { exportService } from './exportService.js';
import { syncService } from './syncService.js';
import { jobManager } from './jobManager.js';
import type { Schedule, SchedulePreset } from '../types/index.js';

// Preset cron expressions
const PRESET_CRONS: Record<SchedulePreset, string> = {
  hourly: '0 * * * *',       // At minute 0 of every hour
  daily: '0 2 * * *',        // At 2:00 AM every day
  weekly: '0 2 * * 0',       // At 2:00 AM every Sunday
  monthly: '0 2 1 * *',      // At 2:00 AM on the 1st of each month
  custom: '',                // User-defined
};

class SchedulerService {
  private scheduledTasks: Map<string, cron.ScheduledTask> = new Map();
  private runningJobs: Map<string, string> = new Map(); // scheduleId -> jobId
  private currentTimezone: string = 'UTC';

  // Initialize on startup
  async initialize(): Promise<void> {
    console.log('Initializing scheduler service...');
    try {
      // Load timezone from settings
      this.currentTimezone = await settingsStore.getTimezone();
      console.log(`Scheduler using timezone: ${this.currentTimezone}`);

      const schedules = await scheduleStore.getAll();
      for (const schedule of schedules) {
        if (schedule.enabled) {
          await this.scheduleJob(schedule);
        }
      }
      console.log(`Scheduler initialized with ${this.scheduledTasks.size} active schedules`);
    } catch (error) {
      console.error('Failed to initialize scheduler:', error);
    }
  }

  // Reinitialize all schedules with a new timezone
  async reinitializeWithTimezone(timezone: string): Promise<void> {
    console.log(`Reinitializing scheduler with timezone: ${timezone}`);
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
    console.log(`Scheduler reinitialized with ${this.scheduledTasks.size} active schedules`);
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
      console.error(`Invalid cron expression for schedule ${schedule.id}: ${cronExpr}`);
      return;
    }

    const task = cron.schedule(cronExpr, async () => {
      await this.executeSchedule(schedule.id);
    }, {
      scheduled: true,
      timezone: this.currentTimezone,
    });

    this.scheduledTasks.set(schedule.id, task);

    // Calculate and store next run time
    await this.updateNextRunTime(schedule.id, cronExpr);

    console.log(`Scheduled job "${schedule.name}" (${schedule.id}) with cron: ${cronExpr} (timezone: ${this.currentTimezone})`);
  }

  // Remove a scheduled job
  unscheduleJob(scheduleId: string): void {
    const task = this.scheduledTasks.get(scheduleId);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(scheduleId);
      console.log(`Unscheduled job ${scheduleId}`);
    }
  }

  // Execute the scheduled job
  async executeSchedule(scheduleId: string): Promise<string | undefined> {
    // Prevent concurrent runs of the same schedule
    if (this.runningJobs.has(scheduleId)) {
      console.log(`Schedule ${scheduleId} is already running, skipping this execution`);
      return undefined;
    }

    let jobId: string | undefined;

    try {
      const schedule = await scheduleStore.getById(scheduleId);
      if (!schedule) {
        console.error(`Schedule ${scheduleId} not found`);
        return undefined;
      }

      // Get source connection
      const sourceConn = await savedConnectionStore.getById(schedule.sourceConnectionId);
      if (!sourceConn) {
        console.error(`Source connection ${schedule.sourceConnectionId} not found for schedule ${scheduleId}`);
        return undefined;
      }

      // Create job
      jobId = jobManager.createJob(schedule.jobType);
      this.runningJobs.set(scheduleId, jobId);

      // Record run start
      await scheduleStore.recordRunStart(scheduleId, jobId);

      console.log(`Executing schedule "${schedule.name}" (${scheduleId}), job ${jobId}`);

      if (schedule.jobType === 'backup') {
        await exportService.export({
          source: {
            url: sourceConn.instanceUrl,
            username: sourceConn.username,
            password: sourceConn.password,
          },
          options: schedule.options,
          dryRun: false,
        }, jobId);

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

        await syncService.sync({
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
        }, jobId);
      }

      // Record success
      await scheduleStore.recordRunComplete(scheduleId, jobId, 'completed');
      console.log(`Schedule "${schedule.name}" completed successfully`);

    } catch (error: any) {
      console.error(`Schedule ${scheduleId} failed:`, error);
      // Record failure
      if (jobId) {
        await scheduleStore.recordRunComplete(scheduleId, jobId, 'failed', error.message);
      }
    } finally {
      this.runningJobs.delete(scheduleId);

      // Update next run time
      const schedule = await scheduleStore.getById(scheduleId);
      if (schedule && schedule.enabled) {
        const cronExpr = this.getCronExpression(schedule);
        await this.updateNextRunTime(scheduleId, cronExpr);
      }
    }

    return jobId;
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
      console.error(`Failed to calculate next run time for ${scheduleId}:`, error);
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
      console.log(`Applying retention policy for schedule ${scheduleId}: keeping ${retentionCount} backups`);

      // Get all completed backup job IDs for this schedule, sorted newest first
      const completedJobIds = await scheduleStore.getCompletedBackupJobIds(scheduleId);

      if (completedJobIds.length <= retentionCount) {
        console.log(`Retention: ${completedJobIds.length} backups exist, retention count is ${retentionCount}, no cleanup needed`);
        return;
      }

      // Get the job IDs to delete (oldest ones beyond retention count)
      const jobIdsToDelete = completedJobIds.slice(retentionCount);

      console.log(`Retention: Deleting ${jobIdsToDelete.length} old backups`);

      // Delete the backup files
      const result = await exportService.cleanupOldBackups(jobIdsToDelete);

      // Delete the history entries for deleted backups
      if (result.deleted.length > 0) {
        await scheduleStore.deleteHistoryEntries(result.deleted);
        console.log(`Retention: Cleaned up ${result.deleted.length} old backups and history entries`);
      }

      if (result.errors.length > 0) {
        console.error(`Retention: Encountered ${result.errors.length} errors during cleanup:`, result.errors);
      }
    } catch (error) {
      console.error(`Retention: Failed to apply retention policy for schedule ${scheduleId}:`, error);
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
    console.log('Shutting down scheduler service...');
    for (const [id, task] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();
    console.log('Scheduler service shut down');
  }
}

export const schedulerService = new SchedulerService();
