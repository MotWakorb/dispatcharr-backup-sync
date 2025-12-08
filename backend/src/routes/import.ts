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
    fileSize: 10 * 1024 * 1024 * 1024, // 10GB
  },
});

// Start a new import job
importRouter.post('/inspect', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'File is required' });
    }

    const format = req.body.format as 'yaml' | 'json' | undefined;
    const request: ImportRequest = {
      destination: { url: '', username: '', password: '' },
      fileData: req.file.buffer,
      fileName: req.file.originalname,
      format,
    };

    const result = await importService.inspect(request);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error inspecting import file:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to inspect file',
    });
  }
});

// Start a new import job
importRouter.post('/', upload.single('file'), async (req, res) => {
  try {
    // Handle both multipart/form-data and JSON requests
    let request: ImportRequest;

    let options: ImportRequest['options'];

    if (req.body?.options) {
      try {
        options =
          typeof req.body.options === 'string' ? JSON.parse(req.body.options) : req.body.options;
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: 'Invalid options payload',
        });
      }
    }

    if (req.file) {
      // Multipart upload
      const destination = JSON.parse(req.body.destination || '{}');
      const format = req.body.format as 'yaml' | 'json' | undefined;

      request = {
        destination,
        fileData: req.file.buffer,
        fileName: req.file.originalname,
        format,
        options,
      };
    } else if (req.body?.uploadId) {
      // Use cached upload from previous inspect
      const destination = JSON.parse(req.body.destination || '{}');
      const cached = await importService.getCachedUpload(req.body.uploadId);
      request = {
        destination,
        fileData: cached.buffer,
        fileName: cached.fileName,
        format: req.body.format as 'yaml' | 'json' | undefined,
        options,
        uploadId: req.body.uploadId,
      };
    } else {
      // JSON body
      request = { ...(req.body as ImportRequest), options };
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
    const jobId = jobManager.createJob('import');

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
