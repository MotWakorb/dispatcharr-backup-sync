import { Router } from 'express';
import { importService } from '../services/importService.js';
import { jobManager } from '../services/jobManager.js';
import { DispatcharrClient } from '../services/dispatcharrClient.js';
import { getErrorMessage, getErrorStatus } from '../utils/errorUtils.js';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs/promises';
import path from 'path';
import type { ImportRequest, DispatcharrConnection } from '../types/index.js';
import { createLogger } from '../services/logger.js';
import { validateConnection } from '../schemas/index.js';

const log = createLogger('import-route');

export const importRouter = Router();

// Configure multer for disk storage to avoid OOM with large files
const UPLOAD_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'uploads')
  : path.join(process.cwd(), 'temp', 'uploads');

// Ensure upload directory exists
fs.mkdir(UPLOAD_DIR, { recursive: true }).catch((err) => {
  log.error({ err }, 'Failed to create upload directory');
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      // Use timestamp + original name to avoid collisions
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024, // 10GB
  },
});

/**
 * Helper to read uploaded file from disk and clean up after.
 * Used for small operations like inspect where we need the buffer.
 */
async function readUploadedFile(filePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(filePath);
  } finally {
    // Clean up immediately after reading
    fs.unlink(filePath).catch((err) => {
      log.debug({ filePath, err }, 'Failed to cleanup uploaded file');
    });
  }
}

/**
 * Helper to clean up uploaded file (used when we're done with it)
 */
async function cleanupUploadedFile(filePath: string | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    log.debug({ filePath, err }, 'Failed to cleanup uploaded file');
  }
}

// Inspect an uploaded backup file
importRouter.post('/inspect', upload.single('file'), async (req, res) => {
  const uploadedFilePath = req.file?.path;
  try {
    log.debug(
      { filename: req.file?.originalname, path: uploadedFilePath },
      'Inspect route received file'
    );
    if (!req.file || !uploadedFilePath) {
      return res.status(400).json({ success: false, error: 'File is required' });
    }

    // Read file from disk (will be cleaned up by readUploadedFile)
    const fileBuffer = await readUploadedFile(uploadedFilePath);

    const format = req.body.format as 'yaml' | 'json' | undefined;
    const request: ImportRequest = {
      destination: { url: '', username: '', password: '' },
      fileData: fileBuffer,
      fileName: req.file.originalname,
      format,
    };

    log.debug('Calling importService.inspect');
    const result = await importService.inspect(request);
    log.debug({ sections: Object.keys(result.sections || {}) }, 'Inspect result');
    res.json({ success: true, data: result });
  } catch (error) {
    // Ensure cleanup on error (readUploadedFile may not have been called)
    await cleanupUploadedFile(uploadedFilePath);
    log.error({ err: error }, 'Error inspecting import file');
    res.status(400).json({
      success: false,
      error: getErrorMessage(error, 'Failed to inspect file'),
    });
  }
});

// Start a new import job
importRouter.post('/', upload.single('file'), async (req, res) => {
  const uploadedFilePath = req.file?.path;
  try {
    // Handle both multipart/form-data and JSON requests
    let request: ImportRequest;

    let options: ImportRequest['options'];

    if (req.body?.options) {
      try {
        options =
          typeof req.body.options === 'string' ? JSON.parse(req.body.options) : req.body.options;
      } catch (err) {
        await cleanupUploadedFile(uploadedFilePath);
        return res.status(400).json({
          success: false,
          error: 'Invalid options payload',
        });
      }
    }

    if (req.file && uploadedFilePath) {
      // Multipart upload - read from disk
      const destination = JSON.parse(req.body.destination || '{}');
      const format = req.body.format as 'yaml' | 'json' | undefined;
      const fileBuffer = await fs.readFile(uploadedFilePath);

      request = {
        destination,
        fileData: fileBuffer,
        fileName: req.file.originalname,
        format,
        options,
      };

      // Clean up the uploaded file now that we have the buffer
      // The import service will handle the buffer from here
      await cleanupUploadedFile(uploadedFilePath);
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

    // Validate destination connection using shared validation
    const destValidation = validateConnection(request.destination, 'destination connection');
    if (!destValidation.success) {
      return res.status(400).json({
        success: false,
        error: destValidation.error,
      });
    }

    // Create a new job
    const jobId = jobManager.createJob('import');

    // Start import in background
    importService.import(request, jobId).catch((error) => {
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
  const files = req.files as Express.Multer.File[];
  const uploadedFilePaths = files?.map((f) => f.path).filter(Boolean) || [];

  // Helper to clean up all uploaded plugin files
  const cleanupAllFiles = async () => {
    for (const filePath of uploadedFilePaths) {
      await cleanupUploadedFile(filePath);
    }
  };

  try {
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
      await cleanupAllFiles();
      return res.status(400).json({
        success: false,
        error: 'Invalid connection data',
      });
    }

    const connValidation = validateConnection(connection, 'connection');
    if (!connValidation.success) {
      await cleanupAllFiles();
      return res.status(400).json({
        success: false,
        error: connValidation.error,
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
        // Read file from disk
        const fileBuffer = await fs.readFile(file.path);

        // Create form data for plugin import
        const formData = new FormData();
        formData.append('file', fileBuffer, {
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
        const isAlreadyExists =
          statusCode === 409 ||
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
      } finally {
        // Clean up this plugin file after processing
        await cleanupUploadedFile(file.path);
      }
    }

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    await cleanupAllFiles();
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
