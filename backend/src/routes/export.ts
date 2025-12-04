import { Router } from 'express';
import { exportService } from '../services/exportService.js';
import { jobManager } from '../services/jobManager.js';
import path from 'path';
import fs from 'fs';
import type { ExportRequest } from '../types/index.js';

export const exportRouter = Router();

// Start a new export job
exportRouter.post('/', async (req, res) => {
  try {
    const request: ExportRequest = req.body;

    // Validate request
    if (!request.source || !request.options) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: source and options are required',
      });
    }

    // Validate connection
    if (!request.source.url || !request.source.username || !request.source.password) {
      return res.status(400).json({
        success: false,
        error: 'Invalid source connection: url, username, and password are required',
      });
    }

    // Create a new job
    const jobId = jobManager.createJob();

    // Start export in background
    exportService
      .export(request, jobId)
      .catch((error) => {
        console.error(`Export job ${jobId} failed:`, error);
      });

    // Return job ID immediately
    res.json({
      success: true,
      data: {
        jobId,
        message: 'Export job started',
      },
    });
  } catch (error: any) {
    console.error('Error starting export:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start export job',
    });
  }
});

// Get export job status
exportRouter.get('/status/:jobId', (req, res) => {
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

// Download exported file
exportRouter.get('/download/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = jobManager.getJob(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    if (status.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Export not completed yet',
      });
    }

    const filePath = status.result?.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Export file not found',
      });
    }

    const fileName = status.result?.fileName || path.basename(filePath);

    // Send file
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to download file',
          });
        }
      }

      // Cleanup file after download
      exportService.cleanup(filePath).catch((error) => {
        console.error('Failed to cleanup file:', error);
      });
    });
  } catch (error: any) {
    console.error('Error downloading file:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to download file',
    });
  }
});
