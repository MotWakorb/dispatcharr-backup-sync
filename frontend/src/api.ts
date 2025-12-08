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
): Promise<{ sections: string[]; uploadId?: string; fileName?: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<ApiResponse<{ sections: string[]; uploadId?: string; fileName?: string }>>(
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
