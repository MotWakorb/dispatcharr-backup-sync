import { Router } from 'express';
import { importService } from '../services/importService.js';
import { jobManager } from '../services/jobManager.js';
import { DispatcharrClient } from '../services/dispatcharrClient.js';
import { getErrorMessage, getErrorStatus } from '../utils/errorUtils.js';
import multer from 'multer';
import FormData from 'form-data';
import type { ImportRequest, DispatcharrConnection } from '../types/index.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('import-route');

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
    log.debug({ filename: req.file?.originalname }, 'Inspect route received file');
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

    log.debug('Calling importService.inspect');
    const result = await importService.inspect(request);
    log.debug({ sections: Object.keys(result.sections || {}) }, 'Inspect result');
    res.json({ success: true, data: result });
  } catch (error) {
    log.error({ err: error }, 'Error inspecting import file');
    res.status(400).json({
      success: false,
      error: getErrorMessage(error, 'Failed to inspect file'),
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
        log.error({ jobId, err: error }, 'Import job failed');
      });

    // Return job ID immediately
    res.json({
      success: true,
      data: {
        jobId,
        message: 'Import job started',
      },
    });
  } catch (error) {
    log.error({ err: error }, 'Error starting import');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to start import job'),
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
  } catch (error) {
    log.error({ err: error }, 'Error getting job status');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get job status'),
    });
  }
});

// Upload plugin files to destination instance
importRouter.post('/plugins', upload.array('plugins', 20), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one plugin file is required',
      });
    }

    let connection: DispatcharrConnection;
    try {
      connection = JSON.parse(req.body.connection || '{}');
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid connection data',
      });
    }

    if (!connection.url || !connection.username || !connection.password) {
      return res.status(400).json({
        success: false,
        error: 'Connection URL, username, and password are required',
      });
    }

    const client = new DispatcharrClient(connection);
    await client.authenticate();

    const results: { uploaded: number; skipped: string[]; errors: string[] } = {
      uploaded: 0,
      skipped: [],
      errors: [],
    };

    for (const file of files) {
      try {
        // Create form data for plugin import
        const formData = new FormData();
        formData.append('file', file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype || 'application/zip',
        });

        // Upload plugin to the destination instance
        await client.post('/api/plugins/plugins/import/', formData, {
          headers: {
            ...formData.getHeaders(),
          },
        });

        results.uploaded++;
        log.info({ plugin: file.originalname }, 'Successfully uploaded plugin');
      } catch (error) {
        const errorMsg = getErrorMessage(error, 'Unknown error');
        const statusCode = getErrorStatus(error);
        const errorLower = errorMsg.toLowerCase();

        log.debug({ plugin: file.originalname, statusCode, errorMsg }, 'Plugin upload error');

        // Check if this is an "already exists" error - treat as skipped, not error
        // Must be a 409 Conflict OR specifically mention plugin/version already exists
        const isAlreadyExists = statusCode === 409 ||
          errorLower.includes('plugin already exists') ||
          errorLower.includes('already installed') ||
          (errorLower.includes('already exists') && errorLower.includes('plugin'));

        if (isAlreadyExists) {
          results.skipped.push(file.originalname);
          log.info({ plugin: file.originalname }, 'Plugin already installed');
        } else {
          results.errors.push(`${file.originalname}: ${errorMsg}`);
          log.error({ plugin: file.originalname, errorMsg }, 'Failed to upload plugin');
        }
      }
    }

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    log.error({ err: error }, 'Error uploading plugins');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to upload plugins'),
    });
  }
});

// Cancel import job
importRouter.post('/cancel/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const status = jobManager.getJob(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    jobManager.cancelJob(jobId, 'Cancelled by user');

    res.json({
      success: true,
      message: 'Import job cancelled',
    });
  } catch (error) {
    log.error({ err: error }, 'Error cancelling import job');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to cancel import job'),
    });
  }
});
