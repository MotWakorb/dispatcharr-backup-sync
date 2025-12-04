import axios from 'axios';
import type {
  DispatcharrConnection,
  SyncOptions,
  ExportOptions,
  JobStatus,
  TestConnectionResponse,
  ApiResponse,
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

// Import APIs
export async function startImport(
  destination: DispatcharrConnection,
  file: File
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('destination', JSON.stringify(destination));

  const response = await api.post<ApiResponse<{ jobId: string; message: string }>>(
    '/import',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );
  return response.data.data!.jobId;
}

export async function getImportStatus(jobId: string): Promise<JobStatus> {
  const response = await api.get<ApiResponse<JobStatus>>(`/import/status/${jobId}`);
  return response.data.data!;
}
