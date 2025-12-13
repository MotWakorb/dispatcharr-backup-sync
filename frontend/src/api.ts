import axios from 'axios';
import type {
  DispatcharrConnection,
  SyncOptions,
  ExportOptions,
  JobStatus,
  TestConnectionResponse,
  ApiResponse,
  SavedConnection,
  SavedConnectionInput,
  JobLogEntry,
  ImportOptions,
  PluginInfo,
  Schedule,
  ScheduleInput,
  ScheduleRunHistoryEntry,
  AppSettings,
  NotificationProvider,
  NotificationProviderInput,
  NotificationGlobalSettings,
  VersionInfo,
} from './types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Connection APIs
export async function testConnection(
  connection: DispatcharrConnection
): Promise<TestConnectionResponse> {
  const response = await api.post<ApiResponse<TestConnectionResponse>>(
    '/connections/test',
    connection
  );
  return response.data.data!;
}

export async function getInstanceInfo(
  connection: DispatcharrConnection
): Promise<any> {
  const response = await api.post<ApiResponse>('/connections/info', connection);
  return response.data.data;
}

// Saved connection APIs
export async function listSavedConnections(): Promise<SavedConnection[]> {
  const response = await api.get<ApiResponse<SavedConnection[]>>('/saved-connections');
  return response.data.data || [];
}

export async function createSavedConnection(
  input: SavedConnectionInput
): Promise<SavedConnection> {
  const response = await api.post<ApiResponse<SavedConnection>>('/saved-connections', input);
  return response.data.data!;
}

export async function updateSavedConnection(
  id: string,
  input: SavedConnectionInput
): Promise<SavedConnection> {
  const response = await api.put<ApiResponse<SavedConnection>>(
    `/saved-connections/${id}`,
    input
  );
  return response.data.data!;
}

export async function deleteSavedConnection(id: string): Promise<void> {
  await api.delete<ApiResponse>(`/saved-connections/${id}`);
}

// Sync APIs
export async function comparePlugins(
  source: DispatcharrConnection,
  destination: DispatcharrConnection
): Promise<{
  sourcePlugins: PluginInfo[];
  destPlugins: PluginInfo[];
  missingPlugins: PluginInfo[];
}> {
  const response = await api.post<
    ApiResponse<{
      sourcePlugins: PluginInfo[];
      destPlugins: PluginInfo[];
      missingPlugins: PluginInfo[];
    }>
  >('/sync/compare-plugins', { source, destination });
  return response.data.data!;
}

export async function startSync(
  source: DispatcharrConnection,
  destination: DispatcharrConnection,
  options: SyncOptions,
  dryRun: boolean = false
): Promise<string> {
  const response = await api.post<ApiResponse<{ jobId: string; message: string }>>(
    '/sync',
    {
      source,
      destination,
      options,
      dryRun,
    }
  );
  return response.data.data!.jobId;
}

export async function getSyncStatus(jobId: string): Promise<JobStatus> {
  const response = await api.get<ApiResponse<JobStatus>>(`/sync/status/${jobId}`);
  return response.data.data!;
}

export async function getAllSyncJobs(): Promise<JobStatus[]> {
  const response = await api.get<ApiResponse<JobStatus[]>>('/sync/jobs');
  return response.data.data!;
}

// Export APIs
export async function startExport(
  source: DispatcharrConnection,
  options: ExportOptions,
  dryRun: boolean = false
): Promise<string> {
  const response = await api.post<ApiResponse<{ jobId: string; message: string }>>(
    '/export',
    {
      source,
      options,
      dryRun,
    }
  );
  return response.data.data!.jobId;
}

export async function getExportStatus(jobId: string): Promise<JobStatus> {
  const response = await api.get<ApiResponse<JobStatus>>(`/export/status/${jobId}`);
  return response.data.data!;
}

export function getExportDownloadUrl(jobId: string): string {
  return `/api/export/download/${jobId}`;
}

export function getExportLogosDownloadUrl(jobId: string): string {
  return `/api/export/download/${jobId}/logos`;
}

export async function cancelExport(jobId: string): Promise<void> {
  await api.post<ApiResponse>(`/export/cancel/${jobId}`);
}

// Jobs
export async function listJobs(): Promise<JobStatus[]> {
  const response = await api.get<ApiResponse<JobStatus[]>>('/jobs');
  return response.data.data || [];
}

export async function getJobLogs(jobId: string): Promise<JobLogEntry[]> {
  const response = await api.get<ApiResponse<JobLogEntry[]>>(`/jobs/${jobId}/logs`);
  return response.data.data || [];
}

export async function getJobHistory(): Promise<JobStatus[]> {
  const response = await api.get<ApiResponse<JobStatus[]>>('/jobs/history/list');
  return response.data.data || [];
}

export async function clearJobHistory(): Promise<void> {
  await api.delete<ApiResponse>('/jobs/history');
}

// Import APIs
export async function startImport(
  destination: DispatcharrConnection,
  file: File | null,
  options?: ImportOptions,
  onUploadProgress?: (percent: number) => void,
  uploadId?: string
): Promise<string> {
  const formData = new FormData();
  if (uploadId) {
    formData.append('uploadId', uploadId);
  } else if (file) {
    formData.append('file', file);
  }

  formData.append('destination', JSON.stringify(destination));
  if (options) {
    formData.append('options', JSON.stringify(options));
  }

  const response = await api.post<ApiResponse<{ jobId: string; message: string }>>(
    '/import',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (evt) => {
        if (evt.total && onUploadProgress) {
          const percent = Math.round((evt.loaded / evt.total) * 100);
          onUploadProgress(percent);
        }
      },
    }
  );
  return response.data.data!.jobId;
}

export async function getImportStatus(jobId: string): Promise<JobStatus> {
  const response = await api.get<ApiResponse<JobStatus>>(`/import/status/${jobId}`);
  return response.data.data!;
}

export async function inspectImportFile(
  file: File,
  onUploadProgress?: (percent: number) => void
): Promise<{ sections: string[]; uploadId?: string; fileName?: string; plugins?: PluginInfo[] }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<ApiResponse<{ sections: string[]; uploadId?: string; fileName?: string; plugins?: PluginInfo[] }>>(
    '/import/inspect',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (evt) => {
        if (evt.total && onUploadProgress) {
          const percent = Math.round((evt.loaded / evt.total) * 100);
          onUploadProgress(percent);
        }
      },
    }
  );

  return response.data.data || { sections: [] };
}

// Plugin upload for import
export async function uploadPluginFiles(
  connection: DispatcharrConnection,
  files: File[],
  onUploadProgress?: (percent: number) => void
): Promise<{ uploaded: number; skipped?: string[]; errors: string[] }> {
  const formData = new FormData();
  formData.append('connection', JSON.stringify(connection));
  files.forEach((file) => {
    formData.append('plugins', file);
  });

  const response = await api.post<ApiResponse<{ uploaded: number; skipped?: string[]; errors: string[] }>>(
    '/import/plugins',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (evt) => {
        if (evt.total && onUploadProgress) {
          const percent = Math.round((evt.loaded / evt.total) * 100);
          onUploadProgress(percent);
        }
      },
    }
  );

  return response.data.data || { uploaded: 0, errors: [] };
}

// Schedule APIs
export async function listSchedules(): Promise<Schedule[]> {
  const response = await api.get<ApiResponse<Schedule[]>>('/schedules');
  return response.data.data || [];
}

export async function getSchedule(id: string): Promise<Schedule> {
  const response = await api.get<ApiResponse<Schedule>>(`/schedules/${id}`);
  return response.data.data!;
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule> {
  const response = await api.post<ApiResponse<Schedule>>('/schedules', input);
  return response.data.data!;
}

export async function updateSchedule(id: string, input: Partial<ScheduleInput>): Promise<Schedule> {
  const response = await api.put<ApiResponse<Schedule>>(`/schedules/${id}`, input);
  return response.data.data!;
}

export async function deleteSchedule(id: string): Promise<void> {
  await api.delete<ApiResponse>(`/schedules/${id}`);
}

export async function toggleSchedule(id: string): Promise<Schedule> {
  const response = await api.post<ApiResponse<Schedule>>(`/schedules/${id}/toggle`);
  return response.data.data!;
}

export async function triggerScheduleRun(id: string): Promise<void> {
  await api.post<ApiResponse>(`/schedules/${id}/run`);
}

export async function getScheduleHistory(id: string, limit?: number): Promise<ScheduleRunHistoryEntry[]> {
  const params = limit ? `?limit=${limit}` : '';
  const response = await api.get<ApiResponse<ScheduleRunHistoryEntry[]>>(`/schedules/${id}/history${params}`);
  return response.data.data || [];
}

export async function validateCronExpression(expression: string): Promise<boolean> {
  const response = await api.post<ApiResponse<{ valid: boolean }>>('/schedules/validate-cron', { expression });
  return response.data.data?.valid || false;
}

// Settings APIs
export async function getSettings(): Promise<AppSettings> {
  const response = await api.get<ApiResponse<AppSettings>>('/settings');
  return response.data.data!;
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const response = await api.put<ApiResponse<AppSettings>>('/settings', settings);
  return response.data.data!;
}

export async function getTimezones(): Promise<string[]> {
  const response = await api.get<ApiResponse<string[]>>('/settings/timezones');
  return response.data.data || [];
}

// Notification APIs
export async function listNotificationProviders(): Promise<NotificationProvider[]> {
  const response = await api.get<ApiResponse<NotificationProvider[]>>('/notifications/providers');
  return response.data.data || [];
}

export async function getNotificationProvider(id: string): Promise<NotificationProvider> {
  const response = await api.get<ApiResponse<NotificationProvider>>(`/notifications/providers/${id}`);
  return response.data.data!;
}

export async function createNotificationProvider(input: NotificationProviderInput): Promise<NotificationProvider> {
  const response = await api.post<ApiResponse<NotificationProvider>>('/notifications/providers', input);
  return response.data.data!;
}

export async function updateNotificationProvider(id: string, input: NotificationProviderInput): Promise<NotificationProvider> {
  const response = await api.put<ApiResponse<NotificationProvider>>(`/notifications/providers/${id}`, input);
  return response.data.data!;
}

export async function deleteNotificationProvider(id: string): Promise<void> {
  await api.delete<ApiResponse>(`/notifications/providers/${id}`);
}

export async function testNotificationProvider(id: string): Promise<{ success: boolean; message: string }> {
  const response = await api.post<ApiResponse<{ success: boolean; message: string }>>(`/notifications/providers/${id}/test`);
  return { success: response.data.success, message: response.data.message || '' };
}

export async function testNotificationProviderConfig(input: NotificationProviderInput): Promise<{ success: boolean; message: string }> {
  const response = await api.post<ApiResponse<{ success: boolean; message: string }>>('/notifications/providers/test-config', input);
  return { success: response.data.success, message: response.data.message || '' };
}

export async function getNotificationSettings(): Promise<NotificationGlobalSettings> {
  const response = await api.get<ApiResponse<NotificationGlobalSettings>>('/notifications/settings');
  return response.data.data!;
}

export async function updateNotificationSettings(settings: Partial<NotificationGlobalSettings>): Promise<NotificationGlobalSettings> {
  const response = await api.put<ApiResponse<NotificationGlobalSettings>>('/notifications/settings', settings);
  return response.data.data!;
}

// Version info API
export async function getVersionInfo(): Promise<VersionInfo> {
  const response = await api.get<ApiResponse<VersionInfo>>('/info');
  return response.data.data!;
}
