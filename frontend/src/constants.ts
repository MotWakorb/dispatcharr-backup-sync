/**
 * Centralized UI strings to avoid duplication across components.
 * This also makes future i18n easier if needed.
 */

// Generic error messages
export const ERRORS = {
  // Generic fallbacks
  GENERIC: 'An error occurred',
  CONNECTION_FAILED: 'Connection failed',

  // Load errors
  LOAD_CONNECTIONS: 'Failed to load connections',
  LOAD_SAVED_ACCOUNTS: 'Failed to load saved accounts',
  LOAD_SETTINGS: 'Failed to load settings',
  LOAD_JOBS: 'Failed to load jobs',
  LOAD_HISTORY: 'Failed to load history',
  LOAD_LOGS: 'Failed to load logs',
  LOAD_SCHEDULES: 'Failed to load schedules',
  LOAD_NOTIFICATIONS: 'Failed to load notification settings',
  LOAD_DATA: 'Failed to load data',

  // Save/Create errors
  SAVE_CONNECTION: 'Failed to save connection',
  SAVE_SETTINGS: 'Failed to save settings',
  SAVE_SCHEDULE: 'Failed to save schedule',
  CREATE_PROVIDER: 'Failed to create provider',

  // Update errors
  UPDATE_CONNECTION: 'Failed to update connection',
  UPDATE_SETTINGS: 'Failed to update settings',
  UPDATE_PROVIDER: 'Failed to update provider',

  // Delete errors
  DELETE_CONNECTION: 'Failed to delete connection',
  DELETE_SCHEDULE: 'Failed to delete schedule',
  DELETE_PROVIDER: 'Failed to delete provider',
  CLEAR_HISTORY: 'Failed to clear history',

  // Action errors
  START_BACKUP: 'Failed to start backup',
  START_RESTORE: 'Failed to start restore',
  START_SYNC: 'Failed to start sync',
  CANCEL_JOB: 'Failed to cancel job',
  GET_JOB_STATUS: 'Failed to get job status',
  TOGGLE_SCHEDULE: 'Failed to toggle schedule',
  TRIGGER_SCHEDULE: 'Failed to trigger schedule',
  UPLOAD_PLUGINS: 'Failed to upload plugins',
  COMPARE_PLUGINS: 'Failed to compare plugins',
  READ_FILE: 'Failed to read file',
  TEST_FAILED: 'Test failed',
} as const;

// Success messages
export const SUCCESS = {
  SETTINGS_SAVED: 'Settings saved.',
  NOTIFICATION_SETTINGS_SAVED: 'Notification settings saved.',
  SCHEDULE_CREATED: 'Schedule created successfully',
  SCHEDULE_UPDATED: 'Schedule updated successfully',
  SCHEDULE_DELETED: 'Schedule deleted',
  CONNECTION_SAVED: 'Connection saved',
  SAVED_ACCOUNT_APPLIED: 'Saved account applied',
} as const;

// Status messages
export const STATUS = {
  LOADING: 'Loading...',
  SAVING: 'Saving...',
  TESTING: 'Testing...',
  DELETING: 'Deleting...',
  REFRESHING: 'Refreshing...',
  UPLOADING: 'Uploading...',

  // Job statuses
  BACKUP_CANCELLED: 'Backup cancelled',
  BACKUP_FAILED: 'Backup failed',
  BACKUP_IN_PROGRESS: 'Backup in progress...',

  RESTORE_CANCELLED: 'Restore cancelled',
  RESTORE_FAILED: 'Restore failed',
  RESTORE_IN_PROGRESS: 'Restore in progress...',

  SYNC_CANCELLED: 'Sync cancelled',
  SYNC_FAILED: 'Sync failed',
  SYNC_IN_PROGRESS: 'Sync in progress...',

  NOT_SCHEDULED: 'Not scheduled',
} as const;

// UI Labels
export const LABELS = {
  // Dropdowns
  SELECT_SAVED_ACCOUNT: 'Select a saved account',
  SELECT_CONNECTION: 'Select a connection...',
  SELECT_DESTINATION: 'Select a destination instance above to enable file upload.',

  // Buttons
  REFRESH: 'Refresh',
  SAVE: 'Save',
  CANCEL: 'Cancel',
  DELETE: 'Delete',
  CLOSE: 'Close',
  TEST: 'Test',
  CREATE: 'Create',
  EDIT: 'Edit',

  // Placeholders
  FRIENDLY_NAME: 'Friendly name',
  FRIENDLY_LABEL: 'Friendly label',
  APP_PASSWORD: 'App password',

  // Empty states
  NO_JOBS_RUNNING: 'No jobs are currently running.',
  NO_HISTORY: 'No history yet.',
  NO_LOGS: 'No logs available.',
  NO_LOGS_YET: 'No logs yet.',
  NO_SCHEDULES: 'No schedules configured.',
  NO_PROVIDERS: 'No notification providers configured.',
  NO_CONNECTIONS: 'No saved connections.',
  NO_SECTIONS_DETECTED: 'No restorable sections detected in the file.',
} as const;

// Validation messages
export const VALIDATION = {
  NAME_REQUIRED: 'Name is required',
  INVALID_TIME: 'Invalid time',
  SELECT_ONE_SECTION: 'Select at least one section to restore or deselect the file.',
} as const;

// Confirmation messages
export const CONFIRM = {
  DELETE_CONNECTION: 'Are you sure you want to delete this connection?',
  DELETE_SCHEDULE: 'Are you sure you want to delete this schedule?',
  DELETE_PROVIDER: 'Are you sure you want to delete this provider?',
  CLEAR_HISTORY: 'Are you sure you want to clear all job history?',
} as const;

// Warning messages
export const WARNINGS = {
  RESTORE_OVERWRITE: 'Restoring will overwrite existing configuration in the destination instance. Make sure you have a backup before proceeding.',
} as const;

/**
 * Helper to get error message from API response or use fallback
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const response = e.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    return (data?.error as string) || (data?.detail as string) || (e.message as string) || fallback;
  }
  return fallback;
}
