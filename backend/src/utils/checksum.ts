import { createHash } from 'crypto';
import { createReadStream, promises as fsp } from 'fs';
import path from 'path';
import { createLogger } from '../services/logger.js';

const log = createLogger('checksum');

// ============ Backup Integrity Verification ============
//
// This module provides SHA-256 checksum utilities for backup files.
//
// Features:
// - Calculate checksums for files (streaming for large files)
// - Create checksum manifest files alongside backups
// - Verify backup integrity before import
//
// Checksum file format: <filename>.sha256
// Content: <hash>  <filename>
//
// ========================================================

const ALGORITHM = 'sha256';
const CHECKSUM_EXTENSION = '.sha256';

/**
 * Calculate SHA-256 checksum for a file using streaming.
 * Efficient for large files as it doesn't load entire file into memory.
 */
export async function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(ALGORITHM);
    const stream = createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Calculate SHA-256 checksum for a buffer.
 */
export function calculateBufferChecksum(buffer: Buffer): string {
  return createHash(ALGORITHM).update(buffer).digest('hex');
}

/**
 * Create a checksum file for a backup file.
 * The checksum file is created alongside the original file with .sha256 extension.
 *
 * @param filePath - Path to the backup file
 * @returns Path to the created checksum file
 */
export async function createChecksumFile(filePath: string): Promise<string> {
  const checksum = await calculateFileChecksum(filePath);
  const fileName = path.basename(filePath);
  const checksumPath = `${filePath}${CHECKSUM_EXTENSION}`;

  // Write in standard checksum format: <hash>  <filename>
  const content = `${checksum}  ${fileName}\n`;
  await fsp.writeFile(checksumPath, content, 'utf-8');

  log.debug({ filePath, checksumPath, checksum }, 'Created checksum file');
  return checksumPath;
}

/**
 * Verify a backup file against its checksum file.
 *
 * @param filePath - Path to the backup file
 * @returns Verification result with details
 */
export async function verifyChecksumFile(filePath: string): Promise<{
  valid: boolean;
  expectedChecksum?: string;
  actualChecksum?: string;
  error?: string;
}> {
  const checksumPath = `${filePath}${CHECKSUM_EXTENSION}`;

  try {
    // Check if checksum file exists
    try {
      await fsp.access(checksumPath);
    } catch {
      return {
        valid: false,
        error: 'Checksum file not found',
      };
    }

    // Read and parse checksum file
    const content = await fsp.readFile(checksumPath, 'utf-8');
    const match = content.trim().match(/^([a-f0-9]{64})\s+/i);
    if (!match) {
      return {
        valid: false,
        error: 'Invalid checksum file format',
      };
    }

    const expectedChecksum = match[1].toLowerCase();

    // Calculate actual checksum
    const actualChecksum = await calculateFileChecksum(filePath);

    const valid = expectedChecksum === actualChecksum;
    if (!valid) {
      log.warn(
        { filePath, expectedChecksum, actualChecksum },
        'Checksum verification failed - file may be corrupted'
      );
    } else {
      log.debug({ filePath }, 'Checksum verification passed');
    }

    return {
      valid,
      expectedChecksum,
      actualChecksum,
    };
  } catch (error) {
    log.error({ err: error, filePath }, 'Error verifying checksum');
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get the checksum file path for a backup file.
 */
export function getChecksumPath(filePath: string): string {
  return `${filePath}${CHECKSUM_EXTENSION}`;
}

/**
 * Check if a checksum file exists for a backup file.
 */
export async function hasChecksumFile(filePath: string): Promise<boolean> {
  try {
    await fsp.access(getChecksumPath(filePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the checksum from a checksum file without verification.
 */
export async function readChecksumFile(filePath: string): Promise<string | null> {
  const checksumPath = getChecksumPath(filePath);
  try {
    const content = await fsp.readFile(checksumPath, 'utf-8');
    const match = content.trim().match(/^([a-f0-9]{64})\s+/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}
