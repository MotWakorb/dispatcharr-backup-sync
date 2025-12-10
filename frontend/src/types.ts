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
  jobType?: 'export' | 'import' | 'sync' | string;
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
  destinationConnectionId?: string;
  options: SyncOptions;
  schedulePreset: SchedulePreset;
  cronExpression?: string;
  enabled: boolean;
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
