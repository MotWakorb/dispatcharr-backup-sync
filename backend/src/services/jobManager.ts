import { v4 as uuidv4 } from 'uuid';
import type { JobStatus } from '../types/index.js';

class JobManager {
  private jobs: Map<string, JobStatus> = new Map();

  createJob(): string {
    const jobId = uuidv4();
    const job: JobStatus = {
      jobId,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
    };
    this.jobs.set(jobId, job);
    return jobId;
  }

  updateJob(jobId: string, updates: Partial<JobStatus>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
      if (updates.status === 'completed' || updates.status === 'failed') {
        job.completedAt = new Date();
      }
    }
  }

  getJob(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): JobStatus[] {
    return Array.from(this.jobs.values());
  }

  startJob(jobId: string, message?: string): void {
    this.updateJob(jobId, {
      status: 'running',
      progress: 0,
      message,
    });
  }

  completeJob(jobId: string, result?: any): void {
    this.updateJob(jobId, {
      status: 'completed',
      progress: 100,
      result,
    });
  }

  failJob(jobId: string, error: string): void {
    this.updateJob(jobId, {
      status: 'failed',
      error,
    });
  }

  setProgress(jobId: string, progress: number, message?: string): void {
    this.updateJob(jobId, {
      progress,
      message,
    });
  }

  // Clean up old jobs (completed > 1 hour ago)
  cleanup(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt < oneHourAgo) {
        this.jobs.delete(jobId);
      }
    }
  }
}

// Singleton instance
export const jobManager = new JobManager();

// Run cleanup every hour
setInterval(() => jobManager.cleanup(), 60 * 60 * 1000);
