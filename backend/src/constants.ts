/**
 * Centralized constants for backend services.
 * Consolidates magic numbers to improve maintainability.
 */

// HTTP/API timeouts
export const HTTP_TIMEOUT_MS = 120000; // 2 minutes - allow large imports
export const GITHUB_TIMEOUT_MS = 5000; // 5 seconds for GitHub API calls
export const LOGO_TIMEOUT_MS = 15000; // 15 seconds per logo download

// Pagination
export const DEFAULT_PAGE_SIZE = 1000;
export const EPG_PAGE_SIZE = 10000;
export const ERROR_TRUNCATE_LENGTH = 1000;

// Cache/cleanup intervals
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// EPG wait/polling
export const EPG_WAIT_TIMEOUT_MS = 600000; // 10 minutes - EPG downloads and parsing can take time
export const EPG_DATA_APPEARANCE_TIMEOUT_MS = 360000; // 6 minutes to wait for data to appear
export const EPG_MIN_OBSERVATION_TIME_MS = 180000; // 3 minutes minimum observation after first growth
export const EPG_POLL_INTERVAL_MS = 10000; // 10 seconds - less frequent polling

// Stream wait/polling
export const STREAM_WAIT_TIMEOUT_MS = 120000; // 2 minutes
export const STREAM_POLL_INTERVAL_MS = 3000; // 3 seconds

// M3U operations
export const M3U_REFRESH_WAIT_MS = 3000; // 3 seconds between refresh checks
export const POST_REFRESH_DELAY_MS = 1000; // 1 second delay after refresh

// Notifications
export const NOTIFICATION_DURATION_MS = 125000; // 2m 5s for notification summaries

// Job cleanup/archiving
export const JOB_HISTORY_MAX_COUNT = 100; // Maximum number of jobs to keep in history
export const JOB_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const JOB_LOG_MAX_ENTRIES = 1000; // Maximum log entries per job
export const JOB_ARCHIVE_BATCH_SIZE = 50; // Number of jobs to archive at once
