import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../services/logger.js';
import { fileURLToPath } from 'url';

const log = createLogger('compression');

// Get the current file's directory for worker path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CompressionOptions {
  /** Compression level 0-9 (default: 6 for balanced speed/size) */
  level?: number;
  /** Use worker thread for compression (default: true for large files) */
  useWorker?: boolean;
  /** Threshold in bytes above which to use worker thread (default: 10MB) */
  workerThreshold?: number;
  /** Callback for progress updates */
  onProgress?: (progress: CompressionProgress) => void;
}

export interface CompressionProgress {
  /** Bytes processed so far */
  bytesProcessed: number;
  /** Total bytes (if known) */
  totalBytes?: number;
  /** Percentage complete (0-100) */
  percentage?: number;
  /** Current file being processed */
  currentFile?: string;
}

export interface CompressionResult {
  /** Path to the created zip file */
  zipPath: string;
  /** Total size of the zip file in bytes */
  size: number;
  /** Time taken in milliseconds */
  duration: number;
  /** Number of files compressed */
  fileCount: number;
}

/**
 * Compress a directory to a ZIP file using streaming.
 * Uses a worker thread for large directories to avoid blocking the event loop.
 */
export async function compressDirectory(
  sourceDir: string,
  outputPath: string,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const {
    level = 6, // Default to balanced compression (faster than 9, smaller than 1)
    useWorker = true,
    workerThreshold = 10 * 1024 * 1024, // 10MB
    onProgress,
  } = options;

  const startTime = Date.now();

  // Check if directory is large enough to warrant worker thread
  const dirSize = await getDirectorySize(sourceDir);

  if (useWorker && dirSize > workerThreshold) {
    log.debug(
      { sourceDir, dirSize, threshold: workerThreshold },
      'Using worker thread for compression'
    );
    return compressInWorker(sourceDir, outputPath, level, dirSize, onProgress);
  }

  // For smaller directories, compress in main thread
  log.debug({ sourceDir, dirSize }, 'Compressing in main thread');
  return compressStreaming(sourceDir, outputPath, level, onProgress);
}

/**
 * Get the total size of a directory recursively
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  async function walkDir(currentPath: string): Promise<void> {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const stats = await fs.promises.stat(fullPath);
        totalSize += stats.size;
      }
    }
  }

  await walkDir(dirPath);
  return totalSize;
}

/**
 * Compress directory using streaming in the current thread
 */
async function compressStreaming(
  sourceDir: string,
  outputPath: string,
  level: number,
  onProgress?: (progress: CompressionProgress) => void
): Promise<CompressionResult> {
  const startTime = Date.now();
  let fileCount = 0;
  let bytesProcessed = 0;

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level },
    });

    output.on('close', () => {
      const stats = fs.statSync(outputPath);
      resolve({
        zipPath: outputPath,
        size: stats.size,
        duration: Date.now() - startTime,
        fileCount,
      });
    });

    archive.on('error', (err) => {
      log.error({ err }, 'Archive error');
      reject(err);
    });

    archive.on('entry', (entry) => {
      fileCount++;
      if (onProgress) {
        onProgress({
          bytesProcessed: archive.pointer(),
          currentFile: entry.name,
        });
      }
    });

    archive.on('progress', (progress) => {
      bytesProcessed = progress.fs.processedBytes;
      if (onProgress) {
        onProgress({
          bytesProcessed,
          totalBytes: progress.fs.totalBytes,
          percentage: progress.fs.totalBytes
            ? Math.round((bytesProcessed / progress.fs.totalBytes) * 100)
            : undefined,
        });
      }
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Compress directory in a worker thread to avoid blocking the event loop
 */
async function compressInWorker(
  sourceDir: string,
  outputPath: string,
  level: number,
  totalSize: number,
  onProgress?: (progress: CompressionProgress) => void
): Promise<CompressionResult> {
  return new Promise((resolve, reject) => {
    // Create worker with inline code since ES modules don't support worker_threads well
    const workerCode = `
      const { parentPort, workerData } = require('worker_threads');
      const archiver = require('archiver');
      const fs = require('fs');

      const { sourceDir, outputPath, level } = workerData;

      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level } });
      let fileCount = 0;

      output.on('close', () => {
        const stats = fs.statSync(outputPath);
        parentPort.postMessage({
          type: 'complete',
          result: {
            zipPath: outputPath,
            size: stats.size,
            fileCount,
          },
        });
      });

      archive.on('error', (err) => {
        parentPort.postMessage({ type: 'error', error: err.message });
      });

      archive.on('entry', () => {
        fileCount++;
      });

      archive.on('progress', (progress) => {
        parentPort.postMessage({
          type: 'progress',
          progress: {
            bytesProcessed: progress.fs.processedBytes,
            totalBytes: progress.fs.totalBytes,
          },
        });
      });

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    `;

    const startTime = Date.now();

    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { sourceDir, outputPath, level },
    });

    worker.on('message', (message) => {
      if (message.type === 'complete') {
        resolve({
          ...message.result,
          duration: Date.now() - startTime,
        });
      } else if (message.type === 'error') {
        reject(new Error(message.error));
      } else if (message.type === 'progress' && onProgress) {
        onProgress({
          bytesProcessed: message.progress.bytesProcessed,
          totalBytes: message.progress.totalBytes,
          percentage: message.progress.totalBytes
            ? Math.round((message.progress.bytesProcessed / message.progress.totalBytes) * 100)
            : undefined,
        });
      }
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}
