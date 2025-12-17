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
}

export interface ScheduleRunHistoryEntry {
  scheduleId: string;
  jobId: string;
  startedAt: string;
  completedAt?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

// ============================================
// Service Result Interfaces
// ============================================

/**
 * Base result for import operations
 */
export interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
}

/**
 * Import result with ID mapping (for entities that need to track old->new ID mappings)
 */
export interface ImportResultWithIdMap extends ImportResult {
  idMap: Record<string | number, number>;
}

/**
 * Import result with logo mapping
 */
export interface ImportResultWithLogoMap extends ImportResult {
  logoMap: Record<string, number>;
}

/**
 * Base result for sync operations
 */
export interface SyncResult {
  synced: number;
  skipped: number;
  errors: number;
}

/**
 * Sync result with logo mapping
 */
export interface SyncResultWithLogoMap extends SyncResult {
  logoMap: Record<string, number>;
}

/**
 * Result from file inspection before import
 */
export interface InspectResult {
  sections: string[];
  uploadId?: string;
  plugins?: any[];
}

/**
 * Result from archive extraction (zip/tar.gz)
 */
export interface ExtractResult {
  configPath: string;
  baseDir: string;
}

/**
 * Cached file upload data
 */
export interface CachedUpload {
  buffer: Buffer;
  fileName: string;
}

/**
 * Result from backup cleanup operations
 */
export interface CleanupResult {
  deleted: string[];
  errors: string[];
}

/**
 * Logo file data structure
 */
export interface LogoFileData {
  name: string;
  data: string;
  ext: string;
  original_name?: string;
}

/**
 * Result from logo import in simpleLogoImport
 */
export interface SimpleLogoImportResult {
  imported: number;
  errors: number;
  logoMap: Record<string, number>;
}

/**
 * Result for EPG/channel assignment operations
 */
export interface AssignmentResult {
  assigned: number;
  skipped: number;
  errors: number;
}
