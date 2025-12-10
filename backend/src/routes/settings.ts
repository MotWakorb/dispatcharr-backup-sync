import { Router } from 'express';
import { settingsStore, type AppSettings } from '../services/settingsStore.js';
import { schedulerService } from '../services/schedulerService.js';
import type { ApiResponse } from '../types/index.js';

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
    res.json({
      success: true,
      data: settings,
    } as ApiResponse<AppSettings>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get settings',
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
        return res.status(400).json({
          success: false,
          error: 'Invalid timezone',
        } as ApiResponse);
      }
    }

    const settings = await settingsStore.update(updates);

    // If timezone changed, reschedule all jobs with new timezone
    if (updates.timezone) {
      await schedulerService.reinitializeWithTimezone(updates.timezone);
    }

    res.json({
      success: true,
      data: settings,
      message: 'Settings updated',
    } as ApiResponse<AppSettings>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update settings',
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
