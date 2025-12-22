import { jobManager } from './jobManager.js';
import { exportService } from './exportService.js';
import { importService } from './importService.js';
import { createLogger } from './logger.js';
import fs from 'fs';
import path from 'path';
import type { SyncRequest, ExportRequest, ImportRequest, ImportOptions } from '../types/index.js';

const log = createLogger('sync');

/**
 * Sync service that internally performs an export from source and import to destination.
 * This ensures sync always has feature parity with backup/restore since it uses the exact same code paths.
 */
export class SyncService {
  private tempDir = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'sync-temp')
    : path.join(process.cwd(), 'data', 'sync-temp');

  /**
   * Throws an error if the job has been cancelled by the user.
   */
  private throwIfCancelled(jobId: string) {
    const job = jobManager.getJob(jobId);
    if (job?.status === 'cancelled') {
      const err: any = new Error('Sync cancelled by user');
      err.cancelled = true;
      throw err;
    }
  }

  /**
   * Perform sync by exporting from source and importing to destination.
   * This guarantees feature parity with backup/restore operations.
   */
  async sync(request: SyncRequest, jobId: string): Promise<void> {
    let exportFilePath: string | undefined;
    let exportJobId: string | undefined;

    try {
      jobManager.startJob(jobId, 'Initializing sync...');
      jobManager.addLog(jobId, 'Sync will export from source and import to destination');
      jobManager.addLog(jobId, 'This ensures full feature parity with backup/restore operations');

      // Ensure temp directory exists
      await fs.promises.mkdir(this.tempDir, { recursive: true });

      // Phase 1: Export from source (0-45%)
      this.throwIfCancelled(jobId);
      jobManager.setProgress(jobId, 5, 'Starting export from source...');

      // Create a sub-job for export to track its progress
      exportJobId = jobManager.createJob('backup');
      jobManager.addLog(jobId, `Created export sub-job: ${exportJobId}`);

      const exportRequest: ExportRequest = {
        source: request.source,
        options: request.options,
        dryRun: request.dryRun,
      };

      // Run export
      jobManager.addLog(jobId, 'Exporting configuration from source instance...');
      exportFilePath = await exportService.export(exportRequest, exportJobId);

      if (request.dryRun) {
        // For dry run, just report what would be synced
        const exportJob = jobManager.getJob(exportJobId);
        jobManager.addLog(jobId, 'Dry run: Export completed, no import performed');
        jobManager.completeJob(jobId, {
          message: 'Dry run completed - no changes made',
          exportSummary: exportJob?.result,
        });
        return;
      }

      // Check export result
      const exportJob = jobManager.getJob(exportJobId);
      if (exportJob?.status !== 'completed' || !exportFilePath) {
        throw new Error(`Export failed: ${exportJob?.error || 'No export file created'}`);
      }

      jobManager.addLog(jobId, `Export completed: ${path.basename(exportFilePath)}`);
      jobManager.setProgress(jobId, 45, 'Export completed, starting import...');

      // Phase 2: Import to destination (45-95%)
      this.throwIfCancelled(jobId);
      jobManager.setProgress(jobId, 50, 'Starting import to destination...');

      // Read the export file
      const fileBuffer = await fs.promises.readFile(exportFilePath);
      const fileName = path.basename(exportFilePath);

      jobManager.addLog(
        jobId,
        `Read export file: ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`
      );

      // Create a sub-job for import
      const importJobId = jobManager.createJob('import');
      jobManager.addLog(jobId, `Created import sub-job: ${importJobId}`);

      // Convert sync options to import options (they're the same shape)
      const importOptions: ImportOptions = { ...request.options };

      const importRequest: ImportRequest = {
        destination: request.destination,
        fileData: fileBuffer,
        fileName,
        options: importOptions,
      };

      // Run import
      jobManager.addLog(jobId, 'Importing configuration to destination instance...');
      await importService.import(importRequest, importJobId);

      // Check import result
      const importJob = jobManager.getJob(importJobId);
      if (importJob?.status !== 'completed') {
        throw new Error(`Import failed: ${importJob?.error || 'Unknown import error'}`);
      }

      jobManager.addLog(jobId, 'Import completed successfully');
      jobManager.setProgress(jobId, 95, 'Sync completed, cleaning up...');

      // Phase 3: Cleanup (95-100%)
      this.throwIfCancelled(jobId);

      // Cleanup export file
      if (exportFilePath) {
        try {
          await fs.promises.unlink(exportFilePath);
          jobManager.addLog(jobId, 'Cleaned up temporary export file');
        } catch (cleanupError) {
          log.warn({ err: cleanupError, file: exportFilePath }, 'Failed to cleanup export file');
        }
      }

      // Build final results from sub-jobs
      const results = {
        synced: {},
        message: 'Sync completed via export/import',
        exportJobId,
        importJobId,
        exportResult: exportJob?.result,
        importResult: importJob?.result,
      };

      // Copy import results to sync results format
      if (importJob?.result && typeof importJob.result === 'object') {
        const importResult = importJob.result as any;
        if (importResult.imported) {
          for (const [key, value] of Object.entries(importResult.imported)) {
            (results.synced as any)[key] = value;
          }
        }
      }

      jobManager.completeJob(jobId, results);
      log.info({ jobId }, 'Sync completed successfully via export/import');
    } catch (error: any) {
      // Cleanup on error
      if (exportFilePath) {
        try {
          await fs.promises.unlink(exportFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }

      if (error?.cancelled) {
        jobManager.addLog(jobId, 'Sync cancelled by user');
      } else {
        log.error({ err: error, jobId }, 'Sync failed');
        jobManager.failJob(jobId, error.message);
      }
      throw error;
    }
  }
}

export const syncService = new SyncService();
