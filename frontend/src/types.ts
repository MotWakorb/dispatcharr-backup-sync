export interface DispatcharrConnection {
  url: string;
  username: string;
  password: string;
}

export interface SavedConnectionInput {
  name: string;
  instanceUrl: string;
  username: string;
  password: string;
}

export interface SavedConnection extends SavedConnectionInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncOptions {
  syncChannelGroups?: boolean;
  syncChannelProfiles?: boolean;
  syncChannels?: boolean;
  syncM3USources?: boolean;
  syncStreamProfiles?: boolean;
  syncUserAgents?: boolean;
  syncCoreSettings?: boolean;
  syncLogos?: boolean;
  syncPlugins?: boolean;
  syncDVRRules?: boolean;
  syncComskipConfig?: boolean;
  syncUsers?: boolean;
  syncEPGSources?: boolean;
}

export type ExportOptions = SyncOptions;

export type ImportOptions = SyncOptions;

/**
 * Result from export/backup job
 */
export interface ExportJobResult {
  filePath?: string;
  fileName?: string;
  logosFilePath?: string;
  logosFileName?: string;
  checksumPath?: string;
}

/**
 * Checksum response from API
 */
export interface ChecksumResponse {
  algorithm: string;
  checksum: string;
  fileName: string;
}

/**
 * Result from import job
 */
export interface ImportJobResult {
  totalImported?: number;
  totalSkipped?: number;
  totalErrors?: number;
}

/**
 * Result from sync job
 */
export interface SyncJobResult {
  totalSynced?: number;
  totalSkipped?: number;
  totalErrors?: number;
}

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled';
  jobType?: 'backup' | 'import' | 'sync' | string;
  progress?: number;
  message?: string;
  result?: ExportJobResult | ImportJobResult | SyncJobResult;
  error?: string;
  warnings?: string[];
  startedAt: Date;
  completedAt?: Date;
}

export interface JobLogEntry {
  timestamp: string;
  message: string;
}

export interface CombinedLogEntry extends JobLogEntry {
  jobId: string;
  jobType?: string;
  jobStatus?: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  version?: string;
  instanceInfo?: Record<string, unknown>;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PluginInfo {
  key: string;
  name?: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

// Schedule types
export type SchedulePreset = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type ScheduledJobType = 'backup' | 'sync';

export interface ScheduleInput {
  name: string;
  jobType: ScheduledJobType;
  sourceConnectionId: string;
  sourceConnectionName?: string; // Cached name in case connection is deleted
  destinationConnectionId?: string;
  destinationConnectionName?: string; // Cached name in case connection is deleted
  options: SyncOptions;
  schedulePreset: SchedulePreset;
  cronExpression?: string;
  enabled: boolean;
  retentionCount?: number; // Number of backups to keep (only for backup jobs)
  maxRetries?: number; // Maximum number of retry attempts on failure (0 = no retries)
  retryDelayMinutes?: number; // Delay between retry attempts in minutes (default: 5)
}

export interface Schedule extends ScheduleInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunJobId?: string;
  lastRunStatus?: 'completed' | 'failed' | 'cancelled';
  nextRunAt?: string;
  isRunning?: boolean;
  runningJobId?: string;
  consecutiveFailures?: number; // Count of consecutive failures for retry logic
}

export interface ScheduleRunHistoryEntry {
  scheduleId: string;
  jobId: string;
  startedAt: string;
  completedAt?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  isRetry?: boolean; // True if this run was a retry attempt
  retryAttempt?: number; // Which retry attempt this was (1, 2, 3, etc.)
}

// App settings
export type TimeFormat = '12h' | '24h';
export type Theme = 'light' | 'dark' | 'auto';

export interface AppSettings {
  timezone: string;
  timeFormat: TimeFormat;
  theme: Theme;
}

// Notification types
export type NotificationProviderType = 'smtp' | 'telegram' | 'discord' | 'slack';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  fromAddress: string;
  toAddress: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface DiscordConfig {
  webhookUrl: string;
}

export interface SlackConfig {
  webhookUrl: string;
}

export type ProviderConfig = SmtpConfig | TelegramConfig | DiscordConfig | SlackConfig;

export interface NotificationProvider {
  id: string;
  name: string;
  type: NotificationProviderType;
  enabled: boolean;
  config: ProviderConfig;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationProviderInput {
  name: string;
  type: NotificationProviderType;
  enabled: boolean;
  config: ProviderConfig;
}

export interface NotificationGlobalSettings {
  notifyOnStart: boolean;
  notifyOnComplete: boolean;
  notifyOnCompleteWithErrors: boolean;
  notifyOnFailure: boolean;
  notifyOnRetry: boolean;
  includeLogsInEmail: boolean;
}

// Version info
export interface VersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}
