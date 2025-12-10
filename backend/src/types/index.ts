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

export interface SyncRequest {
  source: DispatcharrConnection;
  destination: DispatcharrConnection;
  options: SyncOptions;
  dryRun?: boolean;
}

export interface ExportRequest {
  source: DispatcharrConnection;
  options: ExportOptions;
  dryRun?: boolean;
}

export type ImportOptions = SyncOptions;

export interface ImportRequest {
  destination: DispatcharrConnection;
  fileData: string | Buffer; // base64 encoded file or raw Buffer
  fileName: string;
  format?: 'yaml' | 'json';
  options?: ImportOptions;
  uploadId?: string;
}

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
}

export interface ScheduleRunHistoryEntry {
  scheduleId: string;
  jobId: string;
  startedAt: string;
  completedAt?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}
