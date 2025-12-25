import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { createLogger } from '../services/logger.js';

const log = createLogger('disk-space');

export interface DiskSpaceInfo {
  available: number; // bytes
  total: number; // bytes
  used: number; // bytes
  percentUsed: number;
}

/**
 * Get disk space info for the directory containing the given path.
 * Uses 'df' command on Unix systems.
 */
export async function getDiskSpace(targetPath: string): Promise<DiskSpaceInfo> {
  // Ensure the path exists or use its parent
  let checkPath = targetPath;
  try {
    await fs.access(targetPath);
  } catch {
    // Path doesn't exist, use parent directory
    checkPath = path.dirname(targetPath);
  }

  try {
    // Use df command to get disk space (works on macOS and Linux)
    // -k for kilobytes, -P for POSIX format (consistent output)
    const output = execSync(`df -kP "${checkPath}"`, { encoding: 'utf8' });
    const lines = output.trim().split('\n');

    if (lines.length < 2) {
      throw new Error('Unexpected df output format');
    }

    // Parse the second line (first line is header)
    // Format: Filesystem 1024-blocks Used Available Capacity Mounted
    const parts = lines[1].split(/\s+/);
    if (parts.length < 5) {
      throw new Error('Unexpected df output format');
    }

    const total = parseInt(parts[1], 10) * 1024; // Convert KB to bytes
    const used = parseInt(parts[2], 10) * 1024;
    const available = parseInt(parts[3], 10) * 1024;
    const percentUsed = Math.round((used / total) * 100);

    return { available, total, used, percentUsed };
  } catch (error) {
    log.error({ err: error, path: checkPath }, 'Failed to get disk space');
    throw new Error('Unable to determine disk space');
  }
}

/**
 * Check if there's enough disk space for an upload.
 * Requires at least the file size + 20% buffer or 100MB minimum free, whichever is larger.
 *
 * @param uploadDir - Directory where uploads will be stored
 * @param requiredBytes - Expected size of the upload in bytes
 * @returns Object with ok status and error message if not ok
 */
export async function checkDiskSpaceForUpload(
  uploadDir: string,
  requiredBytes: number
): Promise<{ ok: boolean; error?: string; available?: number }> {
  try {
    const diskInfo = await getDiskSpace(uploadDir);

    // Require at least the file size + 20% buffer or 100MB minimum free
    const minBuffer = 100 * 1024 * 1024; // 100MB
    const requiredWithBuffer = Math.max(requiredBytes * 1.2, requiredBytes + minBuffer);

    if (diskInfo.available < requiredWithBuffer) {
      const availableMB = Math.round(diskInfo.available / (1024 * 1024));
      const requiredMB = Math.round(requiredWithBuffer / (1024 * 1024));

      return {
        ok: false,
        error: `Insufficient disk space. Available: ${availableMB}MB, Required: ${requiredMB}MB`,
        available: diskInfo.available,
      };
    }

    // Also warn if disk is more than 90% full
    if (diskInfo.percentUsed > 90) {
      log.warn(
        { percentUsed: diskInfo.percentUsed, available: diskInfo.available },
        'Disk usage is high'
      );
    }

    return { ok: true, available: diskInfo.available };
  } catch (error) {
    // If we can't check disk space, log warning but allow the upload
    // Better to try and fail than block legitimate uploads
    log.warn({ err: error }, 'Could not verify disk space, allowing upload');
    return { ok: true };
  }
}
