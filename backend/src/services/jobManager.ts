import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import type { JobStatus, JobLogEntry } from '../types/index.js';

const DATA_DIR = process.env.DATA_DIR || '/tmp/dispatcharr-manager';
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

class JobManager {
  private jobs: Map<string, JobStatus> = new Map();
  private logs: Map<string, JobLogEntry[]> = new Map();
  private history: JobStatus[] = [];

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // Load jobs
      if (fs.existsSync(JOBS_FILE)) {
        const data = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));

        // Restore jobs map
        if (data.jobs && Array.isArray(data.jobs)) {
          for (const job of data.jobs) {
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
        if (data.history && Array.isArray(data.history)) {
          for (const job of data.history) {
            if (job.startedAt) job.startedAt = new Date(job.startedAt);
            if (job.completedAt) job.completedAt = new Date(job.completedAt);
            // Avoid duplicates
            if (!this.history.find(h => h.jobId === job.jobId)) {
              this.history.push(job);
            }
          }
        }

        console.log(`Loaded ${this.jobs.size} jobs and ${this.history.length} history entries from disk`);
      }

      // Load logs
      if (fs.existsSync(LOGS_FILE)) {
        const logsData = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
        if (logsData && typeof logsData === 'object') {
          for (const [jobId, entries] of Object.entries(logsData)) {
            this.logs.set(jobId, entries as JobLogEntry[]);
          }
        }
        console.log(`Loaded logs for ${this.logs.size} jobs from disk`);
      }
    } catch (error) {
      console.error('Failed to load jobs from disk:', error);
    }
  }

  private saveToDisk(): void {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // Save jobs and history
      const jobsData = {
        jobs: Array.from(this.jobs.values()),
        history: this.history,
      };
      fs.writeFileSync(JOBS_FILE, JSON.stringify(jobsData, null, 2));

      // Save logs
      const logsData: Record<string, JobLogEntry[]> = {};
      for (const [jobId, entries] of this.logs.entries()) {
        logsData[jobId] = entries;
      }
      fs.writeFileSync(LOGS_FILE, JSON.stringify(logsData, null, 2));
    } catch (error) {
      console.error('Failed to save jobs to disk:', error);
    }
  }

  createJob(jobType?: JobStatus['jobType']): string {
    const jobId = uuidv4();
    const job: JobStatus = {
      jobId,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
      ...(jobType ? { jobType } : {}),
    };
    this.jobs.set(jobId, job);
    this.logs.set(jobId, []);
    this.saveToDisk();
    return jobId;
  }

  updateJob(jobId: string, updates: Partial<JobStatus>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      if (
        updates.status === 'completed' ||
        updates.status === 'failed' ||
        updates.status === 'cancelled'
      ) {
        job.completedAt = new Date();
        this.recordHistory(job);
      }
      this.saveToDisk();
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
    this.updateJob(jobId, {
      status: 'completed',
      progress: 100,
      message: 'Completed',
      result,
    });
    this.addLog(jobId, 'Job completed');
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

  // Clean up old jobs (completed > 1 hour ago)
  cleanup(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let cleaned = false;
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt < oneHourAgo) {
        this.jobs.delete(jobId);
        this.logs.delete(jobId);
        cleaned = true;
      }
    }
    if (cleaned) {
      this.saveToDisk();
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
    // Mirror to console for docker logs visibility
    const shortId = jobId.slice(0, 8);
    console.log(`[${timestamp}] [${shortId}] ${message}`);
    // Save logs periodically (every 10 entries to reduce I/O)
    if (log.length % 10 === 0) {
      this.saveToDisk();
    }
  }

  getLogs(jobId: string): JobLogEntry[] {
    return this.logs.get(jobId) || [];
  }

  private recordHistory(job: JobStatus): void {
    // store a shallow copy to preserve snapshot
    const snapshot: JobStatus = { ...job };
    this.history = this.history.filter((j) => j.jobId !== job.jobId);
    this.history.push(snapshot);
    // keep latest 100
    if (this.history.length > 100) {
      this.history = this.history.slice(this.history.length - 100);
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
    this.saveToDisk();
  }
}

// Singleton instance
export const jobManager = new JobManager();

// Run cleanup every hour
setInterval(() => jobManager.cleanup(), 60 * 60 * 1000);
