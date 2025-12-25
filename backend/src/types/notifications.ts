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

export interface NotificationData {
  providers: NotificationProvider[];
  globalSettings: NotificationGlobalSettings;
}

export type NotificationEventType =
  | 'job_started'
  | 'job_completed'
  | 'job_completed_with_errors'
  | 'job_failed'
  | 'job_retry_started'
  | 'job_retry_scheduled'
  | 'job_failed_max_retries'
  | 'job_recovered';

export interface NotificationEvent {
  type: NotificationEventType;
  scheduleName: string;
  jobType: 'backup' | 'sync';
  jobId?: string;
  timestamp: string;
  error?: string;
  errorCount?: number;
  duration?: number;
  retryAttempt?: number;
  maxRetries?: number;
  retryDelayMinutes?: number;
  consecutiveFailures?: number;
  message?: string; // Custom message for recovery notifications
}
