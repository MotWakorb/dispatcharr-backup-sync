import { Router } from 'express';
import { jobManager } from '../services/jobManager.js';
import { createLogger } from '../services/logger.js';
import { getErrorMessage } from '../utils/errorUtils.js';
import type { ApiResponse, JobStatus, JobLogEntry } from '../types/index.js';

const log = createLogger('jobs-route');

export const jobsRouter = Router();

jobsRouter.get('/', (_req, res) => {
  try {
    const jobs = jobManager.getAllJobs();
    log.debug({ count: jobs.length }, 'Listed active jobs');
    res.json({
      success: true,
      data: jobs,
    } as ApiResponse<JobStatus[]>);
  } catch (error) {
    log.error({ err: error }, 'Failed to list jobs');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to list jobs'),
    } as ApiResponse);
  }
});

// Get logs for a job
jobsRouter.get('/:jobId/logs', (req, res) => {
  try {
    const { jobId } = req.params;
    const logs = jobManager.getLogs(jobId);
    log.debug({ jobId, logCount: logs.length }, 'Retrieved job logs');

    res.json({
      success: true,
      data: logs,
    } as ApiResponse<JobLogEntry[]>);
  } catch (error) {
    log.error({ err: error, jobId: req.params.jobId }, 'Failed to get job logs');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get job logs'),
    } as ApiResponse);
  }
});

// Get all logs from all jobs (combined view)
jobsRouter.get('/logs/all', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 500;
    const jobType = req.query.jobType as string | undefined;
    const search = req.query.search as string | undefined;

    const allLogs = jobManager.getAllLogs({ limit, jobType, search });
    log.debug({ count: allLogs.length, limit, jobType, search }, 'Retrieved all logs');

    res.json({
      success: true,
      data: allLogs,
    } as ApiResponse<Array<JobLogEntry & { jobId: string; jobType?: string; jobStatus?: string }>>);
  } catch (error) {
    log.error({ err: error }, 'Failed to get all logs');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get all logs'),
    } as ApiResponse);
  }
});

// Get job history
jobsRouter.get('/history/list', (_req, res) => {
  try {
    const history = jobManager.getHistory();
    log.debug({ count: history.length }, 'Retrieved job history');
    res.json({
      success: true,
      data: history,
    } as ApiResponse<JobStatus[]>);
  } catch (error) {
    log.error({ err: error }, 'Failed to get job history');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get job history'),
    } as ApiResponse);
  }
});

// Clear job history
jobsRouter.delete('/history', (_req, res) => {
  try {
    jobManager.clearHistory();
    log.info('Job history cleared');
    res.json({
      success: true,
      message: 'History cleared',
    } as ApiResponse);
  } catch (error) {
    log.error({ err: error }, 'Failed to clear history');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to clear history'),
    } as ApiResponse);
  }
});
