<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listJobs, getExportDownloadUrl, getExportLogosDownloadUrl, cancelExport, getJobHistory } from '../api';
  import type { JobStatus } from '../types';

  let jobs: JobStatus[] = [];
  let history: JobStatus[] = [];
  let loading = false;
  let loadingHistory = false;
  let error: string | null = null;
  let pollInterval: number | null = null;
  let initialized = false;
  let toast: { message: string; job?: JobStatus } | null = null;

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
      // Check for completions compared to previous snapshot (implicit via current jobs removal + history update)
      const completedExports = history.filter(
        (j) => j.jobType === 'export' && j.status === 'completed'
      );
      if (completedExports.length > 0) {
        const latest = completedExports[completedExports.length - 1];
        toast = { message: 'Export completed', job: latest };
      }
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
      <button class="btn btn-secondary btn-sm" on:click={loadHistory} disabled={loadingHistory}>
        {#if loadingHistory}
          <span class="spinner"></span>
          Loading...
        {:else}
          Refresh history
        {/if}
      </button>
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
              <th>Message</th>
              <th>Finished</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each history.slice().reverse() as job (job.jobId)}
              <tr>
                <td class="mono">{job.jobId}</td>
                <td>{job.jobType || 'unknown'}</td>
                <td><span class="badge badge-{job.status}">{job.status}</span></td>
                <td class="text-sm text-gray">{job.message || job.error || '-'}</td>
                <td class="text-sm">
                  {job.completedAt ? new Date(job.completedAt).toLocaleString() : '-'}
                </td>
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
              </td>
            </tr>
          {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

{#if toast}
  {@const toastJob = toast?.job}
  <div class="toast">
    <span>{toast.message}</span>
    {#if toastJob && toastJob.jobType === 'export'}
      <div class="toast-actions">
        {#if toastJob.result?.fileName}
          <button class="btn btn-success btn-sm" on:click={() => toastJob && download(toastJob)}>
            Download
          </button>
        {/if}
        {#if toastJob.result?.logosFileName}
          <button class="btn btn-secondary btn-sm" on:click={() => toastJob && downloadLogos(toastJob)}>
            Logos
          </button>
        {/if}
      </div>
    {/if}
    <button class="btn btn-secondary btn-sm" on:click={() => toast = null}>Dismiss</button>
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
    display: flex;
    gap: 0.5rem;
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

  .jobs-actions {
    display: flex;
    gap: 0.5rem;
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

  .toast {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: #111827;
    color: #fff;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    z-index: 2000;
  }

  .toast-actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
