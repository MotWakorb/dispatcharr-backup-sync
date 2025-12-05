import { Router } from 'express';
import { syncService } from '../services/syncService.js';
import { jobManager } from '../services/jobManager.js';
import type { SyncRequest } from '../types/index.js';

export const syncRouter = Router();

// Start a new sync job
syncRouter.post('/', async (req, res) => {
  try {
    const request: SyncRequest = req.body;

    // Validate request
    if (!request.source || !request.destination || !request.options) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: source, destination, and options are required',
      });
    }

    // Validate connections
    if (!request.source.url || !request.source.username || !request.source.password) {
      return res.status(400).json({
        success: false,
        error: 'Invalid source connection: url, username, and password are required',
      });
    }

    if (
      !request.destination.url ||
      !request.destination.username ||
      !request.destination.password
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid destination connection: url, username, and password are required',
      });
    }

    // Create a new job
    const jobId = jobManager.createJob('sync');

    // Start sync in background
    syncService
      .sync(request, jobId)
      .catch((error) => {
        console.error(`Sync job ${jobId} failed:`, error);
      });

    // Return job ID immediately
    res.json({
      success: true,
      data: {
        jobId,
        message: 'Sync job started',
      },
    });
  } catch (error: any) {
    console.error('Error starting sync:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start sync job',
    });
  }
});

// Get sync job status
syncRouter.get('/status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const status = jobManager.getJob(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    console.error('Error getting job status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job status',
    });
  }
});

// Get all jobs
syncRouter.get('/jobs', (req, res) => {
  try {
    const jobs = jobManager.getAllJobs();
    res.json({
      success: true,
      data: jobs,
    });
  } catch (error: any) {
    console.error('Error getting jobs:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get jobs',
    });
  }
});
