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
  checksumPath?: string; // Path to SHA-256 checksum file for integrity verification
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

// ============================================
// Dispatcharr API Entity Types
// ============================================

/**
 * Base interface for Dispatcharr entities with an ID
 */
export interface DispatcharrEntity {
  id: number;
  [key: string]: unknown;
}

/**
 * Paginated response from Dispatcharr API
 */
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * Channel Group from Dispatcharr API
 */
export interface ChannelGroup extends DispatcharrEntity {
  name: string;
  enabled?: boolean;
  sort_order?: number;
}

/**
 * Channel Profile from Dispatcharr API
 */
export interface ChannelProfile extends DispatcharrEntity {
  name: string;
  stream_profile?: number;
}

/**
 * Channel from Dispatcharr API
 */
export interface Channel extends DispatcharrEntity {
  name: string;
  channel_number?: string | number;
  channel_group?: number;
  logo?: number;
  logo_id?: number;
  profile?: number;
  epg_channel?: number;
  enabled?: boolean;
  auto_created?: boolean;
}

/**
 * Logo from Dispatcharr API
 */
export interface Logo extends DispatcharrEntity {
  name: string;
  url?: string;
  file?: string;
}

/**
 * M3U Account from Dispatcharr API
 */
export interface M3UAccount extends DispatcharrEntity {
  name: string;
  url?: string;
  username?: string;
  password?: string;
  type?: string;
  enabled?: boolean;
}

/**
 * Stream Profile from Dispatcharr API
 */
export interface StreamProfile extends DispatcharrEntity {
  name: string;
}

/**
 * User Agent from Dispatcharr API
 */
export interface UserAgent extends DispatcharrEntity {
  name: string;
  user_agent?: string;
}

/**
 * EPG Source from Dispatcharr API
 */
export interface EPGSource extends DispatcharrEntity {
  name: string;
  url?: string;
  type?: string;
}

/**
 * EPG Data entry
 */
export interface EPGData extends DispatcharrEntity {
  name?: string;
  channel_id?: string;
}

/**
 * DVR Rule from Dispatcharr API
 */
export interface DVRRule extends DispatcharrEntity {
  name: string;
  enabled?: boolean;
}

/**
 * User from Dispatcharr API
 */
export interface User extends DispatcharrEntity {
  username: string;
  email?: string;
  is_active?: boolean;
  is_staff?: boolean;
}

/**
 * Core Settings from Dispatcharr API
 */
export interface CoreSettings {
  [key: string]: unknown;
}

/**
 * Export data structure for backup files
 */
export interface ExportData {
  exported_at: string;
  source_url: string;
  summary?: ExportSummary;
  data: {
    channelGroups?: ChannelGroup[];
    channelProfiles?: ChannelProfile[];
    channels?: Channel[];
    m3uSources?: M3UAccount[];
    streamProfiles?: StreamProfile[];
    userAgents?: UserAgent[];
    coreSettings?: CoreSettings;
    epgSources?: EPGSource[];
    epgData?: EPGData[];
    dvrRules?: DVRRule[];
    users?: User[];
    logos?: Logo[];
    plugins?: PluginInfo[];
    comskipConfig?: unknown;
  };
}

/**
 * Summary of exported data
 */
export interface ExportSummary {
  [section: string]: number | string;
}
