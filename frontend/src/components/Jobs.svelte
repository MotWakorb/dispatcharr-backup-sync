<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listJobs, getExportDownloadUrl, getExportLogosDownloadUrl, cancelExport, getJobHistory, getJobLogs, clearJobHistory } from '../api';
  import type { JobStatus, JobLogEntry } from '../types';

  let jobs: JobStatus[] = [];
  let history: JobStatus[] = [];
  let loading = false;
  let loadingHistory = false;
  let clearingHistory = false;
  let error: string | null = null;
  let pollInterval: number | null = null;
  let initialized = false;

  // Logs modal state
  let showLogsModal = false;
  let logsModalJob: JobStatus | null = null;
  let logs: JobLogEntry[] = [];
  let logsLoading = false;
  let logsError: string | null = null;

  onMount(() => {
    loadJobs(true);
    loadHistory();
    pollInterval = window.setInterval(() => loadJobs(false), 3000);
  });

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });

  async function loadJobs(manual: boolean = false) {
    const shouldShowLoading = manual || !initialized;
    if (shouldShowLoading) loading = true;
    error = null;
    try {
      jobs = await listJobs();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to load jobs';
    } finally {
      if (shouldShowLoading) loading = false;
      initialized = true;
    }
  }

  async function loadHistory() {
    loadingHistory = true;
    try {
      history = await getJobHistory();
    } catch (err: any) {
      // ignore history errors for now
    } finally {
      loadingHistory = false;
    }
  }

  function download(job: JobStatus) {
    if (job.jobType === 'export' && job.status === 'completed' && job.result?.fileName) {
      const url = getExportDownloadUrl(job.jobId);
      window.location.href = url;
    }
  }

  function downloadLogos(job: JobStatus) {
    if (job.jobType === 'export' && job.status === 'completed' && job.result?.logosFileName) {
      const url = getExportLogosDownloadUrl(job.jobId);
      window.location.href = url;
    }
  }

  async function cancel(job: JobStatus) {
    if (job.jobType !== 'export' || job.status !== 'running') return;
    try {
      await cancelExport(job.jobId);
      await loadJobs();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to cancel job';
    }
  }

  const statusLabel = (status: JobStatus['status']) => status;

  async function viewLogs(job: JobStatus) {
    logsModalJob = job;
    showLogsModal = true;
    logsLoading = true;
    logsError = null;
    logs = [];
    try {
      logs = await getJobLogs(job.jobId);
    } catch (err: any) {
      logsError = err?.response?.data?.error || err?.message || 'Failed to load logs';
    } finally {
      logsLoading = false;
    }
  }

  async function refreshLogs() {
    if (!logsModalJob) return;
    logsLoading = true;
    logsError = null;
    try {
      logs = await getJobLogs(logsModalJob.jobId);
    } catch (err: any) {
      logsError = err?.response?.data?.error || err?.message || 'Failed to load logs';
    } finally {
      logsLoading = false;
    }
  }

  function closeLogsModal() {
    showLogsModal = false;
    logsModalJob = null;
    logs = [];
    logsError = null;
  }

  async function handleClearHistory() {
    if (!confirm('Are you sure you want to clear all job history?')) return;
    clearingHistory = true;
    try {
      await clearJobHistory();
      history = [];
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to clear history';
    } finally {
      clearingHistory = false;
    }
  }
</script>

<div class="jobs-stack">
  <div class="card">
    <div class="card-header jobs-header">
      <h2 class="card-title">Jobs</h2>
      <div class="jobs-actions">
        <button class="btn btn-secondary btn-sm" on:click={() => loadJobs(true)} disabled={loading}>
          {#if loading}
            <span class="spinner"></span>
            Refreshing...
          {:else}
            Refresh
          {/if}
        </button>
        <button class="btn btn-secondary btn-sm" on:click={() => { loadJobs(true); loadHistory(); }}>
          Force Reload
        </button>
      </div>
    </div>

    {#if error}
      <div class="alert alert-error mb-2">{error}</div>
    {/if}

    {#if loading && jobs.length === 0}
      <p>Loading jobs...</p>
    {:else if jobs.length === 0}
      <p class="text-gray">No jobs yet.</p>
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
              <tr>
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
                {#if job.jobType === 'export' && job.status === 'completed' && job.result?.fileName}
                  <button class="btn btn-success btn-sm" on:click={() => download(job)}>
                    Download
                  </button>
                  {#if job.result?.logosFileName}
                    <button class="btn btn-secondary btn-sm" on:click={() => downloadLogos(job)}>
                      Logos
                    </button>
                  {/if}
                {/if}
                {#if job.jobType === 'export' && job.status === 'running'}
                  <button class="btn btn-secondary btn-sm" on:click={() => cancel(job)}>
                    Cancel
                  </button>
                  {/if}
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
            Loading...
          {:else}
            Refresh
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

    {#if loadingHistory && history.length === 0}
      <p>Loading history...</p>
    {:else if history.length === 0}
      <p class="text-gray">No history yet.</p>
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
                <td><span class="badge badge-{job.status}">{job.status}</span></td>
                <td class="text-sm">
                  {job.completedAt ? new Date(job.completedAt).toLocaleString() : '-'}
                </td>
                <td class="actions">
                  <button class="btn btn-secondary btn-sm" on:click={() => viewLogs(job)}>
                    Logs
                  </button>
                  {#if job.jobType === 'export' && job.status === 'completed' && job.result?.fileName}
                    <button class="btn btn-success btn-sm" on:click={() => download(job)}>
                      Download
                    </button>
                    {#if job.result?.logosFileName}
                      <button class="btn btn-secondary btn-sm" on:click={() => downloadLogos(job)}>
                        Logos
                      </button>
                    {/if}
                  {/if}
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
    <div class="logs-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <h3>Job Logs</h3>
          <p class="text-sm text-gray">{logsModalJob?.jobType} - {logsModalJob?.jobId}</p>
        </div>
        <div class="modal-actions">
          {#if logsModalJob?.status === 'running' || logsModalJob?.status === 'pending'}
            <button class="btn btn-secondary btn-sm" type="button" on:click={refreshLogs} disabled={logsLoading}>
              {#if logsLoading}
                <span class="spinner"></span>
              {/if}
              Refresh
            </button>
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
          <div class="flex items-center gap-2"><span class="spinner"></span><span>Loading logs...</span></div>
        {:else if logs.length === 0}
          <p class="text-sm text-gray">No logs available.</p>
        {:else}
          {#each logs as log}
            <div class="log-line {/error|failed/i.test(log.message) ? 'log-error' : ''}">
              <span class="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span class="log-msg">{log.message}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}


<style>
  .table-wrapper {
    overflow-x: auto;
  }
  .table {
    width: 100%;
    border-collapse: collapse;
  }
  th, td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--gray-200);
  }
  .actions {
    display: inline-flex;
    gap: 0.5rem;
    white-space: nowrap;
    vertical-align: middle;
  }
  th:last-child,
  td:last-child {
    white-space: nowrap;
  }
  .badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 0.5rem;
    font-size: 0.75rem;
    text-transform: capitalize;
  }
  .badge-running { background: #dbeafe; color: var(--primary); }
  .badge-pending { background: var(--gray-200); color: var(--gray-700); }
  .badge-completed { background: #d1fae5; color: var(--success); }
  .badge-failed { background: #fee2e2; color: var(--danger); }
  .badge-cancelled { background: #e5e7eb; color: #6b7280; }
  .mono { font-family: Menlo, Monaco, Consolas, monospace; font-size: 0.8rem; }

  .jobs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .jobs-actions,
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
    background: var(--gray-200);
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
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1001;
    padding: 1rem;
  }

  .logs-modal {
    width: min(800px, 95%);
    max-height: 85vh;
    background: #fff;
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
    border-bottom: 1px solid var(--gray-200);
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
    color: var(--gray-800);
  }

  .logs-body {
    padding: 1rem 1.25rem;
    overflow-y: auto;
    flex: 1;
    background: var(--gray-50);
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 0.85rem;
    max-height: 60vh;
  }

  .log-line {
    display: flex;
    gap: 0.75rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--gray-200);
  }

  .log-line:last-child {
    border-bottom: none;
  }

  .log-time {
    color: var(--gray-500);
    min-width: 5rem;
    flex-shrink: 0;
  }

  .log-msg {
    color: var(--gray-800);
    word-break: break-word;
  }

  .log-error .log-msg {
    color: var(--danger);
    font-weight: 600;
  }

  .text-right {
    text-align: right;
  }

</style>
