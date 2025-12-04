import { Router } from 'express';
import { importService } from '../services/importService.js';
import { jobManager } from '../services/jobManager.js';
import multer from 'multer';
import type { ImportRequest } from '../types/index.js';

export const importRouter = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

// Start a new import job
importRouter.post('/', upload.single('file'), async (req, res) => {
  try {
    // Handle both multipart/form-data and JSON requests
    let request: ImportRequest;

    if (req.file) {
      // Multipart upload
      const destination = JSON.parse(req.body.destination || '{}');
      const format = req.body.format as 'yaml' | 'json' | undefined;

      request = {
        destination,
        fileData: req.file.buffer.toString('base64'),
        fileName: req.file.originalname,
        format,
      };
    } else {
      // JSON body
      request = req.body;
    }

    // Validate request
    if (!request.destination || !request.fileData || !request.fileName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: destination, fileData, and fileName are required',
      });
    }

    // Validate destination connection
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
    const jobId = jobManager.createJob();

    // Start import in background
    importService
      .import(request, jobId)
      .catch((error) => {
        console.error(`Import job ${jobId} failed:`, error);
      });

    // Return job ID immediately
    res.json({
      success: true,
      data: {
        jobId,
        message: 'Import job started',
      },
    });
  } catch (error: any) {
    console.error('Error starting import:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start import job',
    });
  }
});

// Get import job status
importRouter.get('/status/:jobId', (req, res) => {
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
