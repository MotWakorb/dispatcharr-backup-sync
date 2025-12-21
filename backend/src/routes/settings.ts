import { Router } from 'express';
import { settingsStore, type AppSettings } from '../services/settingsStore.js';
import { schedulerService } from '../services/schedulerService.js';
import { createLogger } from '../services/logger.js';
import { getErrorMessage } from '../utils/errorUtils.js';
import type { ApiResponse } from '../types/index.js';

const log = createLogger('settings-route');

export const settingsRouter = Router();

// Common timezones for easy selection
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Dubai',
  'Australia/Sydney',
  'Australia/Perth',
  'Pacific/Auckland',
];

// Get current settings
settingsRouter.get('/', async (_req, res) => {
  try {
    const settings = await settingsStore.get();
    log.debug({ timezone: settings.timezone }, 'Retrieved settings');
    res.json({
      success: true,
      data: settings,
    } as ApiResponse<AppSettings>);
  } catch (error) {
    log.error({ err: error }, 'Failed to get settings');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get settings'),
    } as ApiResponse);
  }
});

// Update settings
settingsRouter.put('/', async (req, res) => {
  try {
    const updates: Partial<AppSettings> = req.body;

    // Validate timezone if provided
    if (updates.timezone) {
      try {
        // Validate timezone by trying to use it
        Intl.DateTimeFormat(undefined, { timeZone: updates.timezone });
      } catch {
        log.warn({ timezone: updates.timezone }, 'Invalid timezone provided');
        return res.status(400).json({
          success: false,
          error: 'Invalid timezone',
        } as ApiResponse);
      }
    }

    const settings = await settingsStore.update(updates);
    log.info({ updates }, 'Settings updated');

    // If timezone changed, reschedule all jobs with new timezone
    if (updates.timezone) {
      log.info({ timezone: updates.timezone }, 'Reinitializing scheduler with new timezone');
      await schedulerService.reinitializeWithTimezone(updates.timezone);
    }

    res.json({
      success: true,
      data: settings,
      message: 'Settings updated',
    } as ApiResponse<AppSettings>);
  } catch (error) {
    log.error({ err: error }, 'Failed to update settings');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to update settings'),
    } as ApiResponse);
  }
});

// Get list of common timezones
settingsRouter.get('/timezones', (_req, res) => {
  res.json({
    success: true,
    data: COMMON_TIMEZONES,
  } as ApiResponse<string[]>);
});
