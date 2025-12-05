import { Router } from 'express';
import { jobManager } from '../services/jobManager.js';
import type { ApiResponse, JobStatus, JobLogEntry } from '../types/index.js';

export const jobsRouter = Router();

jobsRouter.get('/', (_req, res) => {
  try {
    const jobs = jobManager.getAllJobs();
    res.json({
      success: true,
      data: jobs,
    } as ApiResponse<JobStatus[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list jobs',
    } as ApiResponse);
  }
});

// Get logs for a job
jobsRouter.get('/:jobId/logs', (req, res) => {
  try {
    const { jobId } = req.params;
    const logs = jobManager.getLogs(jobId);

    res.json({
      success: true,
      data: logs,
    } as ApiResponse<JobLogEntry[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job logs',
    } as ApiResponse);
  }
});

// Get job history
jobsRouter.get('/history/list', (_req, res) => {
  try {
    const history = jobManager.getHistory();
    res.json({
      success: true,
      data: history,
    } as ApiResponse<JobStatus[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job history',
    } as ApiResponse);
  }
});
