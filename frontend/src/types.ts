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

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  jobType?: 'backup' | 'import' | 'sync' | string;
  progress?: number;
  message?: string;
  result?: any;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface JobLogEntry {
  timestamp: string;
  message: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  version?: string;
  instanceInfo?: any;
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
  settings?: Record<string, any>;
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
}

export interface ScheduleRunHistoryEntry {
  scheduleId: string;
  jobId: string;
  startedAt: string;
  completedAt?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

// App settings
export type TimeFormat = '12h' | '24h';

export interface AppSettings {
  timezone: string;
  timeFormat: TimeFormat;
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
  notifyOnFailure: boolean;
  includeLogsInEmail: boolean;
}
