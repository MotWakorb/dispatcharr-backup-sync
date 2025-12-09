import { Router } from 'express';
import { syncService } from '../services/syncService.js';
import { jobManager } from '../services/jobManager.js';
import { DispatcharrClient } from '../services/dispatcharrClient.js';
import type { SyncRequest, DispatcharrConnection } from '../types/index.js';

export const syncRouter = Router();

// Compare plugins between source and destination
syncRouter.post('/compare-plugins', async (req, res) => {
  try {
    const { source, destination } = req.body as {
      source: DispatcharrConnection;
      destination: DispatcharrConnection;
    };

    if (!source || !destination) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: source and destination are required',
      });
    }

    const sourceClient = new DispatcharrClient(source);
    const destClient = new DispatcharrClient(destination);

    await sourceClient.authenticate();
    await destClient.authenticate();

    const sourcePluginsResp = await sourceClient.get('/api/plugins/plugins/');
    const destPluginsResp = await destClient.get('/api/plugins/plugins/');

    const sourcePlugins = Array.isArray(sourcePluginsResp)
      ? sourcePluginsResp
      : sourcePluginsResp?.plugins || [];
    const destPlugins = Array.isArray(destPluginsResp)
      ? destPluginsResp
      : destPluginsResp?.plugins || [];

    const destPluginKeys = new Set(destPlugins.map((p: any) => p.key));

    // Find plugins that exist in source but not in destination
    const missingPlugins = sourcePlugins
      .filter((p: any) => p.key && !destPluginKeys.has(p.key))
      .map((p: any) => ({
        key: p.key,
        name: p.name || p.key,
        version: p.version,
        description: p.description,
      }));

    res.json({
      success: true,
      data: {
        sourcePlugins: sourcePlugins.map((p: any) => ({
          key: p.key,
          name: p.name || p.key,
          version: p.version,
        })),
        destPlugins: destPlugins.map((p: any) => ({
          key: p.key,
          name: p.name || p.key,
          version: p.version,
        })),
        missingPlugins,
      },
    });
  } catch (error: any) {
    console.error('Error comparing plugins:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to compare plugins',
    });
  }
});

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
