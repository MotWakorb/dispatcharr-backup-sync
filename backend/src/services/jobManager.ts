import fs from 'fs';
import path from 'path';
import type { JobStatus, JobLogEntry } from '../types/index.js';
import { createLogger } from './logger.js';
import {
  CLEANUP_INTERVAL_MS,
  JOB_HISTORY_MAX_COUNT,
  JOB_HISTORY_MAX_AGE_MS,
  JOB_LOG_MAX_ENTRIES,
} from '../constants.js';

const logger = createLogger('jobs');
const DATA_DIR = process.env.DATA_DIR || '/tmp/dispatcharr-manager';
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'jobs-archive.json');

class JobManager {
  private jobs: Map<string, JobStatus> = new Map();
  private logs: Map<string, JobLogEntry[]> = new Map();
  private warnings: Map<string, string[]> = new Map();
  private history: JobStatus[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private initialized: Promise<void>;

  // Write queue to serialize async writes and prevent race conditions
  private saveQueue: Promise<void> = Promise.resolve();
  private pendingSave = false;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 100; // Debounce rapid saves

  constructor() {
    // Start async initialization
    this.initialized = this.initializeAsync();
  }

  /**
   * Async initialization - loads data from disk and starts cleanup interval
   */
  private async initializeAsync(): Promise<void> {
    await this.loadFromDiskAsync();
    this.startCleanupInterval();
  }

  /**
   * Ensure initialization is complete before accessing data
   * Call this at the start of any public method that needs data
   */
  async ensureInitialized(): Promise<void> {
    await this.initialized;
  }

  /**
   * Start the periodic cleanup interval (every hour)
   */
  private startCleanupInterval(): void {
    // Clear any existing interval first (safety for hot-reload scenarios)
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cleanupInterval = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Ensure the interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop the periodic cleanup interval (call on shutdown)
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.debug('JobManager cleanup interval stopped');
    }
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    // Force a final save on shutdown
    this.saveToDiskAsync().catch((err) => {
      logger.error({ err }, 'Failed to save jobs on shutdown');
    });
  }

  /**
   * Load jobs and logs from disk asynchronously
   */
  private async loadFromDiskAsync(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.promises.mkdir(DATA_DIR, { recursive: true });

      // Load jobs
      try {
        const data = await fs.promises.readFile(JOBS_FILE, 'utf-8');
        const parsed = JSON.parse(data);

        // Restore jobs map
        if (parsed.jobs && Array.isArray(parsed.jobs)) {
          for (const job of parsed.jobs) {
            // Convert date strings back to Date objects
            if (job.startedAt) job.startedAt = new Date(job.startedAt);
            if (job.completedAt) job.completedAt = new Date(job.completedAt);

            // Mark interrupted jobs as failed
            if (job.status === 'running' || job.status === 'pending') {
              job.status = 'failed';
              job.error = 'Job was interrupted by server restart';
              job.completedAt = new Date();
              this.history.push({ ...job });
            }

            this.jobs.set(job.jobId, job);
          }
        }

        // Restore history
        if (parsed.history && Array.isArray(parsed.history)) {
          for (const job of parsed.history) {
            if (job.startedAt) job.startedAt = new Date(job.startedAt);
            if (job.completedAt) job.completedAt = new Date(job.completedAt);
            // Avoid duplicates
            if (!this.history.find((h) => h.jobId === job.jobId)) {
              this.history.push(job);
            }
          }
        }

        logger.debug(
          { jobCount: this.jobs.size, historyCount: this.history.length },
          'Loaded jobs from disk'
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.error({ err: error }, 'Failed to load jobs file');
        }
      }

      // Load logs
      try {
        const logsData = await fs.promises.readFile(LOGS_FILE, 'utf-8');
        const parsed = JSON.parse(logsData);
        if (parsed && typeof parsed === 'object') {
          for (const [jobId, entries] of Object.entries(parsed)) {
            this.logs.set(jobId, entries as JobLogEntry[]);
          }
        }
        logger.debug({ logCount: this.logs.size }, 'Loaded job logs from disk');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.error({ err: error }, 'Failed to load logs file');
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize jobs from disk');
    }
  }

  /**
   * Save jobs and logs to disk asynchronously with write queue serialization
   * Uses atomic write pattern (write to temp, then rename) to prevent corruption
   */
  private async saveToDiskAsync(): Promise<void> {
    // Add to queue to serialize writes
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        // Ensure data directory exists
        await fs.promises.mkdir(DATA_DIR, { recursive: true });

        // Save jobs and history using atomic write
        const jobsData = {
          jobs: Array.from(this.jobs.values()),
          history: this.history,
        };
        const jobsTempPath = `${JOBS_FILE}.tmp`;
        await fs.promises.writeFile(jobsTempPath, JSON.stringify(jobsData, null, 2));
        await fs.promises.rename(jobsTempPath, JOBS_FILE);

        // Save logs using atomic write
        const logsData: Record<string, JobLogEntry[]> = {};
        for (const [jobId, entries] of this.logs.entries()) {
          logsData[jobId] = entries;
        }
        const logsTempPath = `${LOGS_FILE}.tmp`;
        await fs.promises.writeFile(logsTempPath, JSON.stringify(logsData, null, 2));
        await fs.promises.rename(logsTempPath, LOGS_FILE);
      } catch (error) {
        logger.error({ err: error }, 'Failed to save jobs to disk');
      }
    });
    return this.saveQueue;
  }

  /**
   * Debounced save - schedules a save after a short delay
   * Multiple rapid calls will only trigger one save
   */
  private scheduleSave(): void {
    if (this.pendingSave) return;
    this.pendingSave = true;

    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(() => {
      this.pendingSave = false;
      this.saveDebounceTimer = null;
      this.saveToDiskAsync().catch((err) => {
        logger.error({ err }, 'Debounced save failed');
      });
    }, this.SAVE_DEBOUNCE_MS);
  }

  createJob(jobType?: JobStatus['jobType']): string {
    const now = new Date();
    const jobId =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0') +
      String(now.getMilliseconds()).padStart(3, '0').slice(0, 2);
    const job: JobStatus = {
      jobId,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
      warnings: [],
      ...(jobType ? { jobType } : {}),
    };
    this.jobs.set(jobId, job);
    this.logs.set(jobId, []);
    this.warnings.set(jobId, []);
    this.scheduleSave();
    return jobId;
  }

  updateJob(jobId: string, updates: Partial<JobStatus>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      if (
        updates.status === 'completed' ||
        updates.status === 'completed_with_warnings' ||
        updates.status === 'failed' ||
        updates.status === 'cancelled'
      ) {
        job.completedAt = new Date();
        this.recordHistory(job);
      }
      this.scheduleSave();
    }
  }

  getJob(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): JobStatus[] {
    // Only return active jobs (pending/running) for the live jobs list
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === 'pending' || job.status === 'running'
    );
  }

  cancelJob(jobId: string, message?: string): void {
    this.updateJob(jobId, {
      status: 'cancelled',
      message: message || 'Cancelled by user',
      completedAt: new Date(),
    } as any);
  }

  startJob(jobId: string, message?: string): void {
    this.updateJob(jobId, {
      status: 'running',
      progress: 0,
      message,
    });
    this.addLog(jobId, message || 'Job started');
  }

  completeJob(jobId: string, result?: any): void {
    const jobWarnings = this.warnings.get(jobId) || [];
    const hasWarnings = jobWarnings.length > 0;
    const job = this.jobs.get(jobId);

    this.updateJob(jobId, {
      status: hasWarnings ? 'completed_with_warnings' : 'completed',
      progress: 100,
      message: hasWarnings ? `Completed with ${jobWarnings.length} warning(s)` : 'Completed',
      warnings: hasWarnings ? jobWarnings : undefined,
      result,
    });

    if (hasWarnings) {
      this.addLog(jobId, `Job completed with ${jobWarnings.length} warning(s)`);
    } else {
      this.addLog(jobId, 'Job completed');
    }
  }

  /**
   * Add a warning to a job. Warnings are tracked separately and will cause
   * the job to complete with 'completed_with_warnings' status instead of 'completed'.
   */
  addWarning(jobId: string, warning: string): void {
    const warnings = this.warnings.get(jobId);
    if (warnings) {
      warnings.push(warning);
      // Also log the warning
      this.addLog(jobId, `WARNING: ${warning}`);
      logger.warn({ jobId: jobId.slice(0, 8), warning }, 'Job warning');
    }
  }

  /**
   * Get all warnings for a job
   */
  getWarnings(jobId: string): string[] {
    return this.warnings.get(jobId) || [];
  }

  /**
   * Check if a job has any warnings
   */
  hasWarnings(jobId: string): boolean {
    const warnings = this.warnings.get(jobId);
    return warnings !== undefined && warnings.length > 0;
  }

  failJob(jobId: string, error: string): void {
    this.updateJob(jobId, {
      status: 'failed',
      error,
    });
    this.addLog(jobId, `Job failed: ${error}`);
  }

  setProgress(jobId: string, progress: number, message?: string): void {
    this.updateJob(jobId, {
      progress,
      message,
    });
    if (message) {
      this.addLog(jobId, `${message} (${Math.round(progress)}%)`);
    }
  }

  /**
   * Clean up old jobs and archive history
   * - Removes completed jobs from active list after 1 hour
   * - Archives jobs older than 30 days
   * - Trims history to max count
   * - Cleans up orphaned logs
   */
  cleanup(): void {
    const oneHourAgo = new Date(Date.now() - CLEANUP_INTERVAL_MS);
    const archiveThreshold = new Date(Date.now() - JOB_HISTORY_MAX_AGE_MS);
    let cleaned = false;

    // Remove completed jobs from active jobs map after 1 hour
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt < oneHourAgo) {
        this.jobs.delete(jobId);
        cleaned = true;
      }
    }

    // Archive jobs older than 30 days from history
    const jobsToArchive = this.history.filter(
      (job) => job.completedAt && job.completedAt < archiveThreshold
    );

    if (jobsToArchive.length > 0) {
      this.archiveJobsAsync(jobsToArchive).catch((err) => {
        logger.error({ err }, 'Failed to archive jobs during cleanup');
      });
      this.history = this.history.filter(
        (job) => !job.completedAt || job.completedAt >= archiveThreshold
      );
      cleaned = true;
      logger.info({ count: jobsToArchive.length }, 'Archived old jobs');
    }

    // Trim history to max count (keeping most recent)
    if (this.history.length > JOB_HISTORY_MAX_COUNT) {
      const removed = this.history.length - JOB_HISTORY_MAX_COUNT;
      this.history = this.history.slice(-JOB_HISTORY_MAX_COUNT);
      cleaned = true;
      logger.debug({ removed }, 'Trimmed history to max count');
    }

    // Clean up orphaned logs (logs for jobs no longer in active or history)
    const activeJobIds = new Set([...this.jobs.keys(), ...this.history.map((j) => j.jobId)]);
    for (const jobId of this.logs.keys()) {
      if (!activeJobIds.has(jobId)) {
        this.logs.delete(jobId);
        cleaned = true;
      }
    }

    if (cleaned) {
      this.scheduleSave();
    }
  }

  /**
   * Archive jobs to a separate file for long-term storage
   */
  private async archiveJobsAsync(jobs: JobStatus[]): Promise<void> {
    try {
      let archive: JobStatus[] = [];

      // Load existing archive
      try {
        const data = await fs.promises.readFile(ARCHIVE_FILE, 'utf-8');
        archive = JSON.parse(data);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn({ err: error }, 'Failed to load existing archive');
        }
      }

      // Add new jobs to archive
      archive.push(...jobs);

      // Keep archive file manageable (last 1000 jobs)
      if (archive.length > 1000) {
        archive = archive.slice(-1000);
      }

      // Atomic write
      const tempPath = `${ARCHIVE_FILE}.tmp`;
      await fs.promises.writeFile(tempPath, JSON.stringify(archive, null, 2));
      await fs.promises.rename(tempPath, ARCHIVE_FILE);
      logger.debug({ count: jobs.length, total: archive.length }, 'Jobs archived');
    } catch (error) {
      logger.error({ err: error }, 'Failed to archive jobs');
    }
  }

  /**
   * Get archived jobs (for admin/debugging purposes)
   */
  async getArchivedJobsAsync(): Promise<JobStatus[]> {
    try {
      const data = await fs.promises.readFile(ARCHIVE_FILE, 'utf-8');
      const archive = JSON.parse(data);
      // Convert dates
      for (const job of archive) {
        if (job.startedAt) job.startedAt = new Date(job.startedAt);
        if (job.completedAt) job.completedAt = new Date(job.completedAt);
      }
      return archive;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error({ err: error }, 'Failed to load archived jobs');
      }
    }
    return [];
  }

  // Sync version for backwards compatibility (uses cached data)
  getArchivedJobs(): JobStatus[] {
    // For backwards compatibility, try sync read
    // This is only used rarely for admin purposes
    try {
      if (fs.existsSync(ARCHIVE_FILE)) {
        const data = fs.readFileSync(ARCHIVE_FILE, 'utf-8');
        const archive = JSON.parse(data);
        for (const job of archive) {
          if (job.startedAt) job.startedAt = new Date(job.startedAt);
          if (job.completedAt) job.completedAt = new Date(job.completedAt);
        }
        return archive;
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load archived jobs');
    }
    return [];
  }

  /**
   * Clear archived jobs
   */
  async clearArchiveAsync(): Promise<void> {
    try {
      await fs.promises.unlink(ARCHIVE_FILE);
      logger.info('Archive cleared');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error({ err: error }, 'Failed to clear archive');
      }
    }
  }

  // Sync version for backwards compatibility
  clearArchive(): void {
    try {
      if (fs.existsSync(ARCHIVE_FILE)) {
        fs.unlinkSync(ARCHIVE_FILE);
        logger.info('Archive cleared');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to clear archive');
    }
  }

  addLog(jobId: string, message: string): void {
    const log = this.logs.get(jobId);
    if (!log) return;
    const timestamp = new Date().toISOString();
    log.push({
      timestamp,
      message,
    });

    // Enforce max log entries per job to prevent memory bloat
    if (log.length > JOB_LOG_MAX_ENTRIES) {
      // Keep first 10 entries (job start context) and last (max - 10) entries
      const keepStart = 10;
      const keepEnd = JOB_LOG_MAX_ENTRIES - keepStart;
      const trimmedLog = [...log.slice(0, keepStart), ...log.slice(-keepEnd)];
      this.logs.set(jobId, trimmedLog);
    }

    // Mirror to structured logs for docker logs visibility
    const shortId = jobId.slice(0, 8);
    logger.debug({ jobId: shortId, message }, 'Job log entry');
    // Save logs periodically (every 10 entries to reduce I/O)
    if (log.length % 10 === 0) {
      this.scheduleSave();
    }
  }

  getLogs(jobId: string): JobLogEntry[] {
    return this.logs.get(jobId) || [];
  }

  /**
   * Get all logs from all jobs combined, sorted by timestamp (newest first).
   * Supports filtering by job type and search term.
   */
  getAllLogs(options?: {
    limit?: number;
    jobType?: string;
    search?: string;
  }): Array<JobLogEntry & { jobId: string; jobType?: string; jobStatus?: string }> {
    const limit = options?.limit ?? 500;
    const jobType = options?.jobType?.toLowerCase();
    const search = options?.search?.toLowerCase();

    // Collect all logs with job metadata
    const allLogs: Array<JobLogEntry & { jobId: string; jobType?: string; jobStatus?: string }> =
      [];

    // Get logs from active jobs
    for (const [jobId, job] of this.jobs.entries()) {
      // Filter by job type if specified
      if (jobType && job.jobType?.toLowerCase() !== jobType) {
        continue;
      }

      const logs = this.logs.get(jobId) || [];
      for (const log of logs) {
        // Filter by search term if specified
        if (search && !log.message.toLowerCase().includes(search)) {
          continue;
        }

        allLogs.push({
          ...log,
          jobId,
          jobType: job.jobType,
          jobStatus: job.status,
        });
      }
    }

    // Get logs from history jobs
    for (const job of this.history) {
      // Filter by job type if specified
      if (jobType && job.jobType?.toLowerCase() !== jobType) {
        continue;
      }

      const logs = this.logs.get(job.jobId) || [];
      for (const log of logs) {
        // Filter by search term if specified
        if (search && !log.message.toLowerCase().includes(search)) {
          continue;
        }

        allLogs.push({
          ...log,
          jobId: job.jobId,
          jobType: job.jobType,
          jobStatus: job.status,
        });
      }
    }

    // Sort by timestamp descending (newest first)
    allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply limit
    return allLogs.slice(0, limit);
  }

  private recordHistory(job: JobStatus): void {
    // store a shallow copy to preserve snapshot
    const snapshot: JobStatus = { ...job };
    this.history = this.history.filter((j) => j.jobId !== job.jobId);
    this.history.push(snapshot);
    // keep latest JOB_HISTORY_MAX_COUNT
    if (this.history.length > JOB_HISTORY_MAX_COUNT) {
      this.history = this.history.slice(-JOB_HISTORY_MAX_COUNT);
    }
  }

  getHistory(): JobStatus[] {
    return [...this.history];
  }

  clearHistory(): void {
    // Clear history array
    this.history = [];
    // Also clear logs for completed jobs
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        this.jobs.delete(jobId);
        this.logs.delete(jobId);
      }
    }
    this.scheduleSave();
  }
}

// Singleton instance
export const jobManager = new JobManager();
