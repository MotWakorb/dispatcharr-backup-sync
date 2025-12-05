import { v4 as uuidv4 } from 'uuid';
import type { JobStatus, JobLogEntry } from '../types/index.js';

class JobManager {
  private jobs: Map<string, JobStatus> = new Map();
  private logs: Map<string, JobLogEntry[]> = new Map();
  private history: JobStatus[] = [];

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
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt < oneHourAgo) {
        this.jobs.delete(jobId);
        this.logs.delete(jobId);
      }
    }
  }

  addLog(jobId: string, message: string): void {
    const log = this.logs.get(jobId);
    if (!log) return;
    log.push({
      timestamp: new Date().toISOString(),
      message,
    });
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
}

// Singleton instance
export const jobManager = new JobManager();

// Run cleanup every hour
setInterval(() => jobManager.cleanup(), 60 * 60 * 1000);
