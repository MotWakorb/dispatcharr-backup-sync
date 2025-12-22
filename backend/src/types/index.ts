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
  result?: ExportJobResult | ImportJobResult | SyncJobResult;
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
  instanceInfo?: Record<string, unknown>;
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
 * Plugin information from backup file
 */
export interface PluginInfo {
  key: string;
  name?: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

/**
 * Result from file inspection before import
 */
export interface InspectResult {
  sections: string[];
  uploadId?: string;
  plugins?: PluginInfo[];
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
  source_id?: number;
  /** For URL-based logos, the external URL (no data/ext needed) */
  url?: string;
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
 * Deferred auto channel sync settings to be applied after channels/logos are imported
 */
export interface DeferredAutoSyncSettings {
  accountId: number;
  accountName: string;
  groupSettingsPayload: Array<{
    channel_group: number;
    enabled: boolean;
    auto_channel_sync: boolean;
    auto_sync_channel_start?: number;
    custom_properties?: Record<string, unknown>;
  }>;
}

/**
 * Result from M3U import with deferred auto sync settings
 */
export interface M3UImportResult extends ImportResult {
  deferredAutoSyncSettings: DeferredAutoSyncSettings[];
}

/**
 * Result from M3U sync with deferred auto sync settings
 */
export interface M3USyncResult extends SyncResult {
  deferredAutoSyncSettings: DeferredAutoSyncSettings[];
}

/**
 * Result for EPG/channel assignment operations
 */
export interface AssignmentResult {
  assigned: number;
  skipped: number;
  errors: number;
}

/**
 * Result from export/backup job
 */
export interface ExportJobResult {
  filePath?: string;
  fileName?: string;
  logosFilePath?: string;
  logosFileName?: string;
}

/**
 * Result from import job
 */
export interface ImportJobResult {
  totalImported?: number;
  totalSkipped?: number;
  totalErrors?: number;
  sections?: Record<string, ImportResult>;
}

/**
 * Result from sync job
 */
export interface SyncJobResult {
  totalSynced?: number;
  totalSkipped?: number;
  totalErrors?: number;
  sections?: Record<string, SyncResult>;
}

/**
 * Union type for all job results
 */
export type JobResult = ExportJobResult | ImportJobResult | SyncJobResult;
