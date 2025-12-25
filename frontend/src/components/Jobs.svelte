<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listJobs, getExportDownloadUrl, getExportLogosDownloadUrl, getExportChecksumDownloadUrl, getExportChecksum, cancelExport, cancelSync, cancelImport, getJobHistory, getJobLogs, clearJobHistory } from '../api';
  import type { JobStatus, JobLogEntry, ExportJobResult, ChecksumResponse } from '../types';
  import { ERRORS, LABELS, STATUS, CONFIRM, getErrorMessage, JOB_POLL_INTERVAL_MS } from '../constants';
  import { toastStore } from '../stores/toastStore';
  import Skeleton from './Skeleton.svelte';

  let jobs: JobStatus[] = [];
  let history: JobStatus[] = [];
  let loading = false;
  let loadingHistory = false;
  let clearingHistory = false;
  let error: string | null = null;
  let historyError: string | null = null;
  let pollInterval: number | null = null;
  let initialized = false;

  // Logs modal state
  let showLogsModal = false;
  let logsModalJob: JobStatus | null = null;
  let logs: JobLogEntry[] = [];
  let logsLoading = false;
  let logsError: string | null = null;
  let logsAutoRefreshInterval: number | null = null;
  const LOGS_REFRESH_INTERVAL_MS = 2000; // Auto-refresh logs every 2 seconds for running jobs

  // Job completion tracking
  let previousJobStatuses: Map<string, string> = new Map();

  // Checksum modal state
  let showChecksumModal = false;
  let checksumModalJob: JobStatus | null = null;
  let checksumData: ChecksumResponse | null = null;
  let checksumLoading = false;
  let checksumError: string | null = null;

  onMount(() => {
    loadJobs(true);
    loadHistory();
    pollInterval = window.setInterval(() => loadJobs(false), JOB_POLL_INTERVAL_MS);
  });

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
    if (logsAutoRefreshInterval) {
      clearInterval(logsAutoRefreshInterval);
    }
  });

  function checkForCompletions(newJobs: JobStatus[]) {
    for (const job of newJobs) {
      const prevStatus = previousJobStatuses.get(job.jobId);
      if (prevStatus && prevStatus !== job.status) {
        if (job.status === 'completed') {
          toastStore.success(`${job.jobType} job completed successfully`);
          loadHistory();
        } else if (job.status === 'completed_with_warnings') {
          const warningCount = job.warnings?.length || 0;
          toastStore.warning(`${job.jobType} job completed with ${warningCount} warning(s)`);
          loadHistory();
        } else if (job.status === 'failed') {
          toastStore.error(`${job.jobType} job failed: ${job.error || 'Unknown error'}`);
          loadHistory();
        }
      }
    }
    // Update tracked statuses - only track active jobs (pending/running)
    // Completed/failed/cancelled jobs won't change status, so no need to track them
    previousJobStatuses = new Map(
      newJobs
        .filter(j => j.status === 'pending' || j.status === 'running')
        .map(j => [j.jobId, j.status])
    );
  }

  async function loadJobs(manual: boolean = false) {
    const shouldShowLoading = manual || !initialized;
    if (shouldShowLoading) loading = true;
    error = null;
    try {
      const newJobs = await listJobs();
      if (initialized) {
        checkForCompletions(newJobs);
      } else {
        // Initial load - only track active jobs (pending/running)
        previousJobStatuses = new Map(
          newJobs
            .filter(j => j.status === 'pending' || j.status === 'running')
            .map(j => [j.jobId, j.status])
        );
      }
      jobs = newJobs;
    } catch (err: unknown) {
      error = getErrorMessage(err, ERRORS.LOAD_JOBS);
    } finally {
      if (shouldShowLoading) loading = false;
      initialized = true;
    }
  }

  async function loadHistory() {
    loadingHistory = true;
    historyError = null;
    try {
      history = await getJobHistory();
    } catch (err: unknown) {
      historyError = getErrorMessage(err, ERRORS.LOAD_HISTORY);
    } finally {
      loadingHistory = false;
    }
  }

  function download(job: JobStatus) {
    const isSuccess = job.status === 'completed' || job.status === 'completed_with_warnings';
    const result = job.result as ExportJobResult | undefined;
    if (job.jobType === 'backup' && isSuccess && result?.fileName) {
      const url = getExportDownloadUrl(job.jobId);
      window.location.href = url;
    }
  }

  function downloadLogos(job: JobStatus) {
    const isSuccess = job.status === 'completed' || job.status === 'completed_with_warnings';
    const result = job.result as ExportJobResult | undefined;
    if (job.jobType === 'backup' && isSuccess && result?.logosFileName) {
      const url = getExportLogosDownloadUrl(job.jobId);
      window.location.href = url;
    }
  }

  function downloadChecksum(job: JobStatus) {
    const isSuccess = job.status === 'completed' || job.status === 'completed_with_warnings';
    const result = job.result as ExportJobResult | undefined;
    if (job.jobType === 'backup' && isSuccess && result?.checksumPath) {
      const url = getExportChecksumDownloadUrl(job.jobId);
      window.location.href = url;
    }
  }

  async function viewChecksum(job: JobStatus) {
    checksumModalJob = job;
    showChecksumModal = true;
    checksumLoading = true;
    checksumError = null;
    checksumData = null;

    try {
      checksumData = await getExportChecksum(job.jobId);
    } catch (err: unknown) {
      checksumError = getErrorMessage(err, 'Failed to load checksum');
    } finally {
      checksumLoading = false;
    }
  }

  function closeChecksumModal() {
    showChecksumModal = false;
    checksumModalJob = null;
    checksumData = null;
    checksumError = null;
  }

  function copyChecksum() {
    if (checksumData?.checksum) {
      navigator.clipboard.writeText(checksumData.checksum);
      toastStore.success('Checksum copied to clipboard');
    }
  }

  async function cancel(event: Event, job: JobStatus) {
    event.stopPropagation(); // Prevent row click from triggering
    if (job.status !== 'running' && job.status !== 'pending') return;
    try {
      if (job.jobType === 'backup') {
        await cancelExport(job.jobId);
      } else if (job.jobType === 'sync') {
        await cancelSync(job.jobId);
      } else if (job.jobType === 'restore') {
        await cancelImport(job.jobId);
      }
      toastStore.info(`${job.jobType} job cancelled`);
      await loadJobs();
    } catch (err: unknown) {
      error = getErrorMessage(err, ERRORS.CANCEL_JOB);
    }
  }

  const statusLabel = (status: JobStatus['status']) => status;

  function getExportResult(job: JobStatus): ExportJobResult | undefined {
    return job.jobType === 'backup' ? (job.result as ExportJobResult | undefined) : undefined;
  }

  async function viewLogs(job: JobStatus) {
    logsModalJob = job;
    showLogsModal = true;
    logsLoading = true;
    logsError = null;
    logs = [];

    // Clear any existing auto-refresh
    if (logsAutoRefreshInterval) {
      clearInterval(logsAutoRefreshInterval);
      logsAutoRefreshInterval = null;
    }

    try {
      logs = await getJobLogs(job.jobId);
    } catch (err: unknown) {
      logsError = getErrorMessage(err, ERRORS.LOAD_LOGS);
    } finally {
      logsLoading = false;
    }

    // Start auto-refresh if job is still running
    if (job.status === 'running' || job.status === 'pending') {
      logsAutoRefreshInterval = window.setInterval(async () => {
        // Check if job is still active by finding it in the jobs list
        const currentJob = jobs.find(j => j.jobId === job.jobId);
        if (!currentJob || (currentJob.status !== 'running' && currentJob.status !== 'pending')) {
          // Job completed or no longer active, stop auto-refresh and do one final refresh
          if (logsAutoRefreshInterval) {
            clearInterval(logsAutoRefreshInterval);
            logsAutoRefreshInterval = null;
          }
          // Update the modal job status
          if (currentJob) {
            logsModalJob = currentJob;
          }
        }
        // Silently refresh logs (don't show loading spinner for auto-refresh)
        try {
          logs = await getJobLogs(job.jobId);
        } catch {
          // Silently ignore errors during auto-refresh
        }
      }, LOGS_REFRESH_INTERVAL_MS);
    }
  }

  async function refreshLogs() {
    if (!logsModalJob) return;
    logsLoading = true;
    logsError = null;
    try {
      logs = await getJobLogs(logsModalJob.jobId);
    } catch (err: unknown) {
      logsError = getErrorMessage(err, ERRORS.LOAD_LOGS);
    } finally {
      logsLoading = false;
    }
  }

  function closeLogsModal() {
    // Stop auto-refresh when closing modal
    if (logsAutoRefreshInterval) {
      clearInterval(logsAutoRefreshInterval);
      logsAutoRefreshInterval = null;
    }
    showLogsModal = false;
    logsModalJob = null;
    logs = [];
    logsError = null;
  }

  async function handleClearHistory() {
    if (!confirm(CONFIRM.CLEAR_HISTORY)) return;
    clearingHistory = true;
    try {
      await clearJobHistory();
      history = [];
    } catch (err: unknown) {
      error = getErrorMessage(err, ERRORS.CLEAR_HISTORY);
    } finally {
      clearingHistory = false;
    }
  }
</script>

<div class="jobs-stack">
  <div class="card">
    <div class="card-header">
      <h2 class="card-title">Jobs</h2>
    </div>

    {#if error}
      <div class="alert alert-error mb-2">{error}</div>
    {/if}

    {#if loading && jobs.length === 0}
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Message</th>
              <th>Progress</th>
              <th>Started</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <Skeleton variant="table-row" columns={7} />
            <Skeleton variant="table-row" columns={7} />
          </tbody>
        </table>
      </div>
    {:else if jobs.length === 0}
      <p class="text-gray">{LABELS.NO_JOBS_RUNNING}</p>
    {:else}
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Message</th>
              <th>Progress</th>
              <th>Started</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each jobs.slice().reverse() as job (job.jobId)}
              <tr class="job-row" on:click={() => viewLogs(job)} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && viewLogs(job)}>
                <td class="mono">{job.jobId}</td>
                <td>{job.jobType || 'unknown'}</td>
                <td>
                  <span class="badge badge-{job.status}">{statusLabel(job.status)}</span>
                </td>
                <td class="text-sm text-gray">{job.message || job.error || '-'}</td>
                <td class="progress-cell">
                  {#if job.progress !== undefined}
                    {#if job.progress !== undefined}
                      <div class="progress-bar">
                        <div
                          class="progress-fill"
                          style={`width: ${Math.round(job.progress)}%;`}
                        >
                          <span class="progress-label">{Math.round(job.progress)}%</span>
                        </div>
                      </div>
                    {/if}
                  {:else}
                    -
                  {/if}
                </td>
                <td class="text-sm">{new Date(job.startedAt).toLocaleString()}</td>
                <td class="actions">
                  {#if job.status === 'running' || job.status === 'pending'}
                    <button
                      class="btn btn-danger btn-sm"
                      on:click={(e) => cancel(e, job)}
                      title="Cancel job"
                    >
                      Cancel
                    </button>
                  {/if}
                  <button
                    class="btn btn-secondary btn-sm"
                    on:click={(e) => { e.stopPropagation(); viewLogs(job); }}
                    title="View logs"
                  >
                    Logs
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <div class="card history-card">
    <div class="card-header jobs-header">
      <div>
        <h3 class="card-title">History</h3>
        <p class="text-sm text-gray">Recent completed/failed jobs</p>
      </div>
      <div class="history-actions">
        <button class="btn btn-secondary btn-sm" on:click={loadHistory} disabled={loadingHistory}>
          {#if loadingHistory}
            <span class="spinner"></span>
            {STATUS.LOADING}
          {:else}
            {LABELS.REFRESH}
          {/if}
        </button>
        {#if history.length > 0}
          <button class="btn btn-danger btn-sm" on:click={handleClearHistory} disabled={clearingHistory}>
            {#if clearingHistory}
              <span class="spinner"></span>
              Clearing...
            {:else}
              Clear History
            {/if}
          </button>
        {/if}
      </div>
    </div>

    {#if historyError}
      <div class="alert alert-error">{historyError}</div>
    {:else if loadingHistory && history.length === 0}
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Finished</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <Skeleton variant="table-row" columns={5} />
            <Skeleton variant="table-row" columns={5} />
            <Skeleton variant="table-row" columns={5} />
          </tbody>
        </table>
      </div>
    {:else if history.length === 0}
      <p class="text-gray">{LABELS.NO_HISTORY}</p>
    {:else}
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Finished</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each history.slice().reverse() as job (job.jobId)}
              <tr>
                <td class="mono">{job.jobId}</td>
                <td>{job.jobType || 'unknown'}</td>
                <td><span class="badge badge-{job.status}">{job.status === 'completed_with_warnings' ? 'warnings' : job.status}</span></td>
                <td class="text-sm">
                  {job.completedAt ? new Date(job.completedAt).toLocaleString() : '-'}
                </td>
                <td class="actions">
                  {#if job.jobType === 'backup' && (job.status === 'completed' || job.status === 'completed_with_warnings') && getExportResult(job)?.fileName}
                    <button class="btn btn-success btn-sm" on:click={() => download(job)}>
                      Download
                    </button>
                    {#if getExportResult(job)?.logosFileName}
                      <button class="btn btn-secondary btn-sm" on:click={() => downloadLogos(job)}>
                        Logos
                      </button>
                    {/if}
                    {#if getExportResult(job)?.checksumPath}
                      <button class="btn btn-secondary btn-sm" on:click={() => viewChecksum(job)} title="View SHA-256 checksum">
                        SHA256
                      </button>
                    {/if}
                  {/if}
                  <button class="btn btn-secondary btn-sm" on:click={() => viewLogs(job)}>
                    Logs
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<!-- Logs Modal -->
{#if showLogsModal}
  <div class="modal-overlay" role="presentation">
    <div class="logs-modal" role="dialog" aria-modal="true" aria-labelledby="jobs-logs-title">
      <div class="modal-header">
        <div>
          <h3 id="jobs-logs-title">Job Logs</h3>
          <p class="text-sm text-gray">{logsModalJob?.jobType} - {logsModalJob?.jobId}</p>
        </div>
        <div class="modal-actions">
          {#if logsModalJob?.status === 'running' || logsModalJob?.status === 'pending'}
            <span class="auto-refresh-indicator">
              <span class="pulse-dot"></span>
              Auto-refreshing
            </span>
          {/if}
          <button class="close-btn" type="button" on:click={closeLogsModal} aria-label="Close">
            &times;
          </button>
        </div>
      </div>
      {#if logsError}
        <div class="alert alert-error mb-2">{logsError}</div>
      {/if}
      <div class="logs-body">
        {#if logsLoading && logs.length === 0}
          <div class="flex items-center gap-2"><span class="spinner"></span><span>{STATUS.LOADING}</span></div>
        {:else if logs.length === 0}
          <p class="text-sm text-gray">{LABELS.NO_LOGS}</p>
        {:else}
          {#each logs as log}
            <div class="log-line {/error|failed/i.test(log.message) ? 'log-error' : ''} {/^WARNING:/i.test(log.message) ? 'log-warning' : ''}">
              <span class="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span class="log-msg">{log.message}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Checksum Modal -->
{#if showChecksumModal}
  <div class="modal-overlay" role="presentation">
    <div class="checksum-modal" role="dialog" aria-modal="true" aria-labelledby="checksum-modal-title">
      <div class="modal-header">
        <div>
          <h3 id="checksum-modal-title">Backup Checksum</h3>
          <p class="text-sm text-gray">{checksumModalJob?.jobId}</p>
        </div>
        <button class="close-btn" type="button" on:click={closeChecksumModal} aria-label="Close">
          &times;
        </button>
      </div>
      {#if checksumError}
        <div class="alert alert-error mb-2">{checksumError}</div>
      {/if}
      <div class="checksum-body">
        {#if checksumLoading}
          <div class="flex items-center gap-2"><span class="spinner"></span><span>{STATUS.LOADING}</span></div>
        {:else if checksumData}
          <div class="checksum-info">
            <div class="checksum-row">
              <span class="checksum-label">File:</span>
              <span class="checksum-value">{checksumData.fileName}</span>
            </div>
            <div class="checksum-row">
              <span class="checksum-label">Algorithm:</span>
              <span class="checksum-value">{checksumData.algorithm.toUpperCase()}</span>
            </div>
            <div class="checksum-row checksum-hash-row">
              <span class="checksum-label">Checksum:</span>
              <code class="checksum-hash">{checksumData.checksum}</code>
            </div>
          </div>
          <div class="checksum-actions">
            <button class="btn btn-primary btn-sm" on:click={copyChecksum}>
              Copy Checksum
            </button>
            <button class="btn btn-secondary btn-sm" on:click={() => checksumModalJob && downloadChecksum(checksumModalJob)}>
              Download .sha256
            </button>
          </div>
          <p class="checksum-hint text-sm text-gray">
            Verify with: <code>sha256sum -c {checksumData.fileName}.sha256</code>
          </p>
        {:else}
          <p class="text-sm text-gray">No checksum available</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .table-wrapper {
    overflow-x: auto;
    width: 100%;
  }
  .table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
  }
  th:nth-last-child(2),
  td:nth-last-child(2) {
    width: 100%;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    white-space: nowrap;
    justify-content: flex-end;
  }
  .badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 0.5rem;
    font-size: 0.75rem;
    text-transform: capitalize;
  }
  .badge-running { background: var(--bg-info); color: var(--primary); }
  .badge-pending { background: var(--border-color); color: var(--text-secondary); }
  .badge-completed { background: var(--bg-success); color: var(--success); }
  .badge-completed_with_warnings { background: var(--bg-warning, #fef3c7); color: var(--warning, #d97706); }
  .badge-failed { background: var(--bg-error); color: var(--danger); }
  .badge-cancelled { background: var(--border-color); color: var(--text-secondary); }
  .mono { font-family: Menlo, Monaco, Consolas, monospace; font-size: 0.8rem; }

  .jobs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .history-actions {
    display: flex;
    gap: 0.5rem;
  }

  .btn-danger {
    background: var(--danger);
    color: white;
    border-color: var(--danger);
  }

  .btn-danger:hover {
    background: #b91c1c;
    border-color: #b91c1c;
  }

  .jobs-stack {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .progress-cell {
    min-width: 160px;
  }

  .progress-bar {
    width: 100%;
    background: var(--border-color);
    border-radius: 0.4rem;
    overflow: hidden;
    height: 0.9rem;
    position: relative;
  }

  .progress-fill {
    background: var(--primary);
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.7rem;
    font-weight: 600;
    transition: width 0.2s ease;
  }

  .progress-label {
    padding: 0 0.25rem;
  }

  .history-card {
    margin-top: 1rem;
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1001;
    padding: 1rem;
  }

  .logs-modal {
    width: min(800px, 95%);
    max-height: 85vh;
    background: var(--bg-card);
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-color);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.125rem;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--gray-500);
    line-height: 1;
    padding: 0.25rem;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .logs-body {
    padding: 1rem 1.25rem;
    overflow-y: auto;
    flex: 1;
    background: var(--bg-hover);
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 0.85rem;
    max-height: 60vh;
  }

  .log-line {
    display: flex;
    gap: 0.75rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .log-line:last-child {
    border-bottom: none;
  }

  .log-time {
    color: var(--text-muted);
    min-width: 5rem;
    flex-shrink: 0;
  }

  .log-msg {
    color: var(--text-primary);
    word-break: break-word;
  }

  .log-error .log-msg {
    color: var(--danger);
    font-weight: 600;
  }

  .log-warning .log-msg {
    color: var(--warning, #d97706);
    font-weight: 500;
  }

  .text-right {
    text-align: right;
  }

  .auto-refresh-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    background: var(--success);
    border-radius: 50%;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(0.8);
    }
  }

  .job-row {
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .job-row:hover {
    background-color: var(--gray-100);
  }

  .job-row:focus {
    outline: 2px solid var(--primary);
    outline-offset: -2px;
  }

  /* Checksum modal styles */
  .checksum-modal {
    width: min(500px, 95%);
    background: var(--bg-card);
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .checksum-body {
    padding: 1.25rem;
  }

  .checksum-info {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .checksum-row {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
  }

  .checksum-label {
    font-weight: 600;
    color: var(--text-secondary);
    min-width: 5rem;
    flex-shrink: 0;
  }

  .checksum-value {
    color: var(--text-primary);
  }

  .checksum-hash-row {
    flex-direction: column;
    gap: 0.5rem;
  }

  .checksum-hash {
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 0.85rem;
    background: var(--bg-hover);
    padding: 0.75rem;
    border-radius: 0.5rem;
    word-break: break-all;
    display: block;
    user-select: all;
  }

  .checksum-actions {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .checksum-hint {
    margin: 0;
  }

  .checksum-hint code {
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 0.8rem;
    background: var(--bg-hover);
    padding: 0.2rem 0.4rem;
    border-radius: 0.25rem;
  }
</style>
