import { Router } from 'express';
import { exportService } from '../services/exportService.js';
import { jobManager } from '../services/jobManager.js';
import { getErrorMessage } from '../utils/errorUtils.js';
import path from 'path';
import { promises as fsp } from 'fs';
import type { ExportRequest, ExportJobResult } from '../types/index.js';
import type { ApiResponse } from '../types/index.js';
import { createLogger } from '../services/logger.js';
import { validateConnection } from '../schemas/index.js';
import { readChecksumFile, getChecksumPath } from '../utils/checksum.js';

const log = createLogger('export-route');

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

    // Validate connection using shared validation
    const sourceValidation = validateConnection(request.source, 'source connection');
    if (!sourceValidation.success) {
      return res.status(400).json({
        success: false,
        error: sourceValidation.error,
      });
    }

    // Create a new job
    const jobId = jobManager.createJob('backup');

    // Start export in background
    exportService.export(request, jobId).catch((error) => {
      log.error({ jobId, err: error }, 'Export job failed');
    });

    // Return job ID immediately
    res.json({
      success: true,
      data: {
        jobId,
        message: 'Export job started',
      },
    });
  } catch (error) {
    log.error({ err: error }, 'Error starting export');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to start export job'),
    });
  }
});

// Cancel export job
exportRouter.post('/cancel/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const status = jobManager.getJob(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      } as ApiResponse);
    }

    jobManager.cancelJob(jobId, 'Cancelled by user');

    res.json({
      success: true,
      message: 'Export job cancelled',
    } as ApiResponse);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to cancel export job'),
    } as ApiResponse);
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
  } catch (error) {
    log.error({ err: error }, 'Error getting job status');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get job status'),
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

    const exportResult = status.result as ExportJobResult | undefined;
    const filePath = exportResult?.filePath;
    if (!filePath) {
      return res.status(404).json({
        success: false,
        error: 'Export file not found',
      });
    }

    // Check if file exists
    try {
      await fsp.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Export file not found',
      });
    }

    const fileName = exportResult?.fileName || path.basename(filePath);

    // Add checksum header if available
    const checksum = await readChecksumFile(filePath);
    if (checksum) {
      res.setHeader('X-Checksum-SHA256', checksum);
    }

    // Send file
    res.download(filePath, fileName, (err) => {
      if (err) {
        log.error({ err }, 'Error sending file');
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to download file',
          });
        }
      }

      // Cleanup file after download
      exportService.cleanup(filePath).catch((error) => {
        log.error({ err: error }, 'Failed to cleanup file');
      });
    });
  } catch (error) {
    log.error({ err: error }, 'Error downloading file');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to download file'),
    });
  }
});

// Download logos zip
exportRouter.get('/download/:jobId/logos', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = jobManager.getJob(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      } as ApiResponse);
    }

    if (status.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Export not completed yet',
      } as ApiResponse);
    }

    const exportResult = status.result as ExportJobResult | undefined;
    const filePath = exportResult?.logosFilePath;
    if (!filePath) {
      return res.status(404).json({
        success: false,
        error: 'Logos archive not found',
      } as ApiResponse);
    }

    // Check if file exists
    try {
      await fsp.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Logos archive not found',
      } as ApiResponse);
    }

    const fileName = exportResult?.logosFileName || path.basename(filePath);

    res.download(filePath, fileName, (err) => {
      if (err) {
        log.error({ err }, 'Error sending logos file');
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to download logos',
          } as ApiResponse);
        }
      }
    });
  } catch (error) {
    log.error({ err: error }, 'Error downloading logos');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to download logos'),
    } as ApiResponse);
  }
});

// Download checksum file
exportRouter.get('/download/:jobId/checksum', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = jobManager.getJob(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      } as ApiResponse);
    }

    if (status.status !== 'completed' && status.status !== 'completed_with_warnings') {
      return res.status(400).json({
        success: false,
        error: 'Export not completed yet',
      } as ApiResponse);
    }

    const exportResult = status.result as ExportJobResult | undefined;
    const backupFilePath = exportResult?.filePath;
    if (!backupFilePath) {
      return res.status(404).json({
        success: false,
        error: 'Export file not found',
      } as ApiResponse);
    }

    const checksumPath = getChecksumPath(backupFilePath);

    // Check if checksum file exists
    try {
      await fsp.access(checksumPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Checksum file not found',
      } as ApiResponse);
    }

    const fileName = path.basename(checksumPath);
    res.download(checksumPath, fileName, (err) => {
      if (err) {
        log.error({ err }, 'Error sending checksum file');
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Failed to download checksum',
          } as ApiResponse);
        }
      }
    });
  } catch (error) {
    log.error({ err: error }, 'Error downloading checksum');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to download checksum'),
    } as ApiResponse);
  }
});

// Get checksum value (JSON response)
exportRouter.get('/checksum/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = jobManager.getJob(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      } as ApiResponse);
    }

    if (status.status !== 'completed' && status.status !== 'completed_with_warnings') {
      return res.status(400).json({
        success: false,
        error: 'Export not completed yet',
      } as ApiResponse);
    }

    const exportResult = status.result as ExportJobResult | undefined;
    const backupFilePath = exportResult?.filePath;
    if (!backupFilePath) {
      return res.status(404).json({
        success: false,
        error: 'Export file not found',
      } as ApiResponse);
    }

    const checksum = await readChecksumFile(backupFilePath);
    if (!checksum) {
      return res.status(404).json({
        success: false,
        error: 'Checksum not available',
      } as ApiResponse);
    }

    res.json({
      success: true,
      data: {
        algorithm: 'sha256',
        checksum,
        fileName: exportResult?.fileName || path.basename(backupFilePath),
      },
    } as ApiResponse);
  } catch (error) {
    log.error({ err: error }, 'Error getting checksum');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get checksum'),
    } as ApiResponse);
  }
});
