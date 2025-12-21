import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../services/logger.js';

const log = createLogger('migration');

const DATA_DIR = process.env.DATA_DIR || '/data';
const OLD_DATA_DIR = '/app/data';

// Files that should be migrated
const DATA_FILES = [
  'savedConnections.json',
  'jobs.json',
  'logs.json',
  'jobs-archive.json',
  'schedules.json',
  'settings.json',
  'notifications.json',
  '.encryption_key',
];

/**
 * Migrate data from old /app/data location to new DATA_DIR location.
 * This handles upgrades from versions that used hardcoded paths.
 */
export async function migrateDataIfNeeded(): Promise<void> {
  // Skip if DATA_DIR is the same as old location
  if (DATA_DIR === OLD_DATA_DIR) {
    return;
  }

  try {
    // Check if old data directory exists
    await fs.access(OLD_DATA_DIR);
  } catch {
    // Old directory doesn't exist, nothing to migrate
    log.debug('No legacy data directory found, skipping migration');
    return;
  }

  log.info({ from: OLD_DATA_DIR, to: DATA_DIR }, 'Checking for data migration');

  // Ensure new data directory exists
  await fs.mkdir(DATA_DIR, { recursive: true });

  let migratedCount = 0;
  let skippedCount = 0;

  for (const file of DATA_FILES) {
    const oldPath = path.join(OLD_DATA_DIR, file);
    const newPath = path.join(DATA_DIR, file);

    try {
      // Check if old file exists
      await fs.access(oldPath);

      // Check if new file already exists
      try {
        await fs.access(newPath);
        // New file exists, skip (don't overwrite)
        log.debug({ file }, 'File already exists in new location, skipping');
        skippedCount++;
        continue;
      } catch {
        // New file doesn't exist, proceed with migration
      }

      // Copy file to new location
      await fs.copyFile(oldPath, newPath);
      log.info({ file, from: oldPath, to: newPath }, 'Migrated data file');
      migratedCount++;

      // Rename old file to indicate it's been migrated
      await fs.rename(oldPath, `${oldPath}.migrated`);
    } catch (error) {
      // File doesn't exist in old location, skip
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn({ file, err: error }, 'Error checking/migrating file');
      }
    }
  }

  // Also migrate any backup subdirectory if it exists
  const oldBackupDir = path.join(OLD_DATA_DIR, 'backup');
  const newBackupDir = path.join(DATA_DIR, 'backup');

  try {
    await fs.access(oldBackupDir);
    const backupFiles = await fs.readdir(oldBackupDir);

    if (backupFiles.length > 0) {
      await fs.mkdir(newBackupDir, { recursive: true });

      for (const file of backupFiles) {
        const oldFilePath = path.join(oldBackupDir, file);
        const newFilePath = path.join(newBackupDir, file);

        try {
          await fs.access(newFilePath);
          log.debug({ file }, 'Backup file already exists in new location, skipping');
          skippedCount++;
        } catch {
          await fs.copyFile(oldFilePath, newFilePath);
          await fs.rename(oldFilePath, `${oldFilePath}.migrated`);
          log.info({ file }, 'Migrated backup file');
          migratedCount++;
        }
      }
    }
  } catch {
    // No backup directory to migrate
  }

  if (migratedCount > 0) {
    log.info(
      { migratedCount, skippedCount },
      'Data migration complete. Old files renamed with .migrated extension.'
    );
  } else if (skippedCount > 0) {
    log.debug({ skippedCount }, 'No files needed migration (already in new location)');
  }
}
