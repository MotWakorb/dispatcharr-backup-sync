import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock fs module before importing jobManager
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
}));

// Set test data directory
process.env.DATA_DIR = '/tmp/dispatcharr-test-data';

describe('JobManager', () => {
  let jobManager: any;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();

    // Reset modules to get fresh jobManager instance
    vi.resetModules();

    // Import fresh instance
    const module = await import('../src/services/jobManager.js');
    jobManager = module.jobManager;
  });

  afterEach(() => {
    // Shutdown the cleanup interval
    if (jobManager?.shutdown) {
      jobManager.shutdown();
    }
  });

  describe('createJob', () => {
    it('should create a new job with pending status', () => {
      const jobId = jobManager.createJob('backup');

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(jobId.length).toBeGreaterThan(0);

      const job = jobManager.getJob(jobId);
      expect(job).toBeDefined();
      expect(job.status).toBe('pending');
      expect(job.progress).toBe(0);
      expect(job.jobType).toBe('backup');
    });

    it('should create job with unique IDs', async () => {
      const jobId1 = jobManager.createJob('backup');
      // Add small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));
      const jobId2 = jobManager.createJob('sync');

      expect(jobId1).not.toBe(jobId2);
    });

    it('should create job without jobType if not provided', () => {
      const jobId = jobManager.createJob();
      const job = jobManager.getJob(jobId);

      expect(job).toBeDefined();
      expect(job.jobType).toBeUndefined();
    });
  });

  describe('updateJob', () => {
    it('should update job status', () => {
      const jobId = jobManager.createJob('backup');

      jobManager.updateJob(jobId, { status: 'running', progress: 50 });

      const job = jobManager.getJob(jobId);
      expect(job.status).toBe('running');
      expect(job.progress).toBe(50);
    });

    it('should set completedAt when job completes', () => {
      const jobId = jobManager.createJob('backup');

      jobManager.updateJob(jobId, { status: 'completed' });

      const job = jobManager.getJob(jobId);
      expect(job.completedAt).toBeDefined();
      expect(job.completedAt).toBeInstanceOf(Date);
    });

    it('should set completedAt when job fails', () => {
      const jobId = jobManager.createJob('backup');

      jobManager.updateJob(jobId, { status: 'failed', error: 'Test error' });

      const job = jobManager.getJob(jobId);
      expect(job.completedAt).toBeDefined();
      expect(job.error).toBe('Test error');
    });

    it('should not update non-existent job', () => {
      jobManager.updateJob('non-existent', { status: 'running' });

      const job = jobManager.getJob('non-existent');
      expect(job).toBeUndefined();
    });
  });

  describe('startJob', () => {
    it('should set job status to running', () => {
      const jobId = jobManager.createJob('backup');

      jobManager.startJob(jobId, 'Starting backup');

      const job = jobManager.getJob(jobId);
      expect(job.status).toBe('running');
      expect(job.progress).toBe(0);
      expect(job.message).toBe('Starting backup');
    });
  });

  describe('completeJob', () => {
    it('should set job status to completed with 100% progress', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.startJob(jobId);

      jobManager.completeJob(jobId, { fileName: 'test.zip' });

      const job = jobManager.getJob(jobId);
      expect(job.status).toBe('completed');
      expect(job.progress).toBe(100);
      expect(job.result).toEqual({ fileName: 'test.zip' });
    });
  });

  describe('failJob', () => {
    it('should set job status to failed with error message', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.startJob(jobId);

      jobManager.failJob(jobId, 'Connection failed');

      const job = jobManager.getJob(jobId);
      expect(job.status).toBe('failed');
      expect(job.error).toBe('Connection failed');
    });
  });

  describe('cancelJob', () => {
    it('should set job status to cancelled', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.startJob(jobId);

      jobManager.cancelJob(jobId, 'User requested cancellation');

      const job = jobManager.getJob(jobId);
      expect(job.status).toBe('cancelled');
      expect(job.message).toBe('User requested cancellation');
    });

    it('should use default message if not provided', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.startJob(jobId);

      jobManager.cancelJob(jobId);

      const job = jobManager.getJob(jobId);
      expect(job.message).toBe('Cancelled by user');
    });
  });

  describe('setProgress', () => {
    it('should update job progress', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.startJob(jobId);

      jobManager.setProgress(jobId, 50, 'Processing items');

      const job = jobManager.getJob(jobId);
      expect(job.progress).toBe(50);
      expect(job.message).toBe('Processing items');
    });
  });

  describe('getAllJobs', () => {
    it('should return pending jobs', () => {
      const jobId = jobManager.createJob('backup');

      const activeJobs = jobManager.getAllJobs();

      expect(activeJobs.length).toBe(1);
      expect(activeJobs[0].jobId).toBe(jobId);
      expect(activeJobs[0].status).toBe('pending');
    });

    it('should return running jobs', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.startJob(jobId);

      const activeJobs = jobManager.getAllJobs();

      expect(activeJobs.length).toBe(1);
      expect(activeJobs[0].status).toBe('running');
    });

    it('should not return completed jobs', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.completeJob(jobId);

      const activeJobs = jobManager.getAllJobs();

      expect(activeJobs.length).toBe(0);
    });

    it('should not return failed jobs', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.failJob(jobId, 'Test error');

      const activeJobs = jobManager.getAllJobs();

      expect(activeJobs.length).toBe(0);
    });
  });

  describe('addLog and getLogs', () => {
    it('should add log entries to job', () => {
      const jobId = jobManager.createJob('backup');

      jobManager.addLog(jobId, 'First log message');
      jobManager.addLog(jobId, 'Second log message');

      const logs = jobManager.getLogs(jobId);

      expect(logs.length).toBe(2);
      expect(logs[0].message).toBe('First log message');
      expect(logs[1].message).toBe('Second log message');
      expect(logs[0].timestamp).toBeDefined();
    });

    it('should return empty array for non-existent job logs', () => {
      const logs = jobManager.getLogs('non-existent');

      expect(logs).toEqual([]);
    });
  });

  describe('getHistory', () => {
    it('should record completed jobs in history', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.startJob(jobId);
      jobManager.completeJob(jobId);

      const history = jobManager.getHistory();

      expect(history.length).toBe(1);
      expect(history[0].jobId).toBe(jobId);
      expect(history[0].status).toBe('completed');
    });

    it('should record failed jobs in history', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.startJob(jobId);
      jobManager.failJob(jobId, 'Test error');

      const history = jobManager.getHistory();

      expect(history.length).toBe(1);
      expect(history[0].status).toBe('failed');
    });
  });

  describe('clearHistory', () => {
    it('should clear all history', () => {
      const jobId = jobManager.createJob('backup');
      jobManager.completeJob(jobId);

      expect(jobManager.getHistory().length).toBe(1);

      jobManager.clearHistory();

      expect(jobManager.getHistory().length).toBe(0);
    });
  });
});
