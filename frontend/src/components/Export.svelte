<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import OptionsForm from './OptionsForm.svelte';
  import JobProgress from './JobProgress.svelte';
  import {
    startExport,
    getExportStatus,
    getExportDownloadUrl,
    listSavedConnections,
    cancelExport,
    getJobLogs,
  } from '../api';
  import type {
    DispatcharrConnection,
    ExportOptions,
    JobStatus,
    SavedConnection,
  } from '../types';

  let connection: DispatcharrConnection = {
    url: '',
    username: '',
    password: ''
  };

  let options: ExportOptions = {
    syncChannelGroups: true,
    syncChannelProfiles: true,
    syncChannels: true,
    syncM3USources: true,
    syncStreamProfiles: true,
    syncUserAgents: true,
    syncCoreSettings: true,
    syncEPGSources: true,
    syncPlugins: true,
    syncDVRRules: true,
    syncComskipConfig: true,
    syncUsers: true,
    syncLogos: true,
  };

  let dryRun = false;
  let exporting = false;
  let currentJob: JobStatus | null = null;
  let error: string | null = null;
  let pollInterval: number | null = null;
  let savedConnections: SavedConnection[] = [];
  let loadingSavedConnections = false;
  let savedConnectionsError: string | null = null;
  let overlayMessage = 'Export in progress...';
  let showOverlay = false;
  let backgroundJobId: string | null = null;
  let showLogs = false;
  let logs: { timestamp: string; message: string }[] = [];
  let logsPoll: number | null = null;
  let showBackgroundModal = false;

  onMount(loadSavedConnections);

  async function loadSavedConnections() {
    loadingSavedConnections = true;
    savedConnectionsError = null;
    try {
      savedConnections = await listSavedConnections();
    } catch (err: any) {
      savedConnectionsError =
        err.response?.data?.error || err.message || 'Failed to load saved accounts';
    } finally {
      loadingSavedConnections = false;
    }
  }

  async function handleExport() {
    exporting = true;
    error = null;
    currentJob = null;
    overlayMessage = 'Export in progress...';
    showOverlay = true;
    backgroundJobId = null;
    logs = [];
    showLogs = false;
    stopLogPolling();

    try {
      const jobId = await startExport(connection, options, dryRun);
      startLogPolling(jobId);
      pollJobStatus(jobId);
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to start export';
      exporting = false;
    }
  }

  async function pollJobStatus(jobId: string) {
    try {
      const job = await getExportStatus(jobId);
      currentJob = job;
      if (!showOverlay && !backgroundJobId) {
        backgroundJobId = job.jobId;
      }

      if (job.status === 'running' || job.status === 'pending') {
        pollInterval = window.setTimeout(() => pollJobStatus(jobId), 1000);
      } else {
        if (pollInterval) {
          clearTimeout(pollInterval);
          pollInterval = null;
        }
        // Keep overlay visible when job completes so user can see results and click Close
        if (job.status === 'cancelled') {
          overlayMessage = 'Export cancelled';
        }
        if (job.status === 'failed') {
          error = job.error || job.message || 'Export failed';
        }
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          stopLogPolling();
          await loadLogs(job.jobId);
        }
      }
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to get job status';
      exporting = false;
    }
  }

  async function handleCancel() {
    if (!currentJob?.jobId) return;
    overlayMessage = 'Cancelling export...';
    if (pollInterval) {
      clearTimeout(pollInterval);
      pollInterval = null;
    }
    stopLogPolling();
    try {
      await cancelExport(currentJob.jobId);
      currentJob = { ...currentJob, status: 'cancelled', message: 'Cancelled by user' };
      overlayMessage = 'Export cancelled';
      await loadLogs(currentJob.jobId);
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to cancel export';
    } finally {
      exporting = false;
    }
  }

  async function loadLogs(jobId: string) {
    try {
      logs = await getJobLogs(jobId);
    } catch (err: any) {
      // ignore log load errors for now
    }
  }

  function startLogPolling(jobId: string) {
    stopLogPolling();
    loadLogs(jobId);
    logsPoll = window.setInterval(() => loadLogs(jobId), 1000);
  }

  function stopLogPolling() {
    if (logsPoll) {
      clearInterval(logsPoll);
      logsPoll = null;
    }
  }

  function handleDownload() {
    if (currentJob?.jobId) {
      const url = getExportDownloadUrl(currentJob.jobId);
      window.location.href = url;
    }
  }

  function handleDownloadFromId(id: string) {
    const url = getExportDownloadUrl(id);
    window.location.href = url;
  }

  function closeOverlay() {
    showOverlay = false;
    currentJob = null;
    exporting = false;
  }

  function runInBackground() {
    backgroundJobId = currentJob?.jobId || backgroundJobId;
    showOverlay = false;
    currentJob = null;
    exporting = false;
    showBackgroundModal = true;
  }

  onDestroy(() => {
    if (pollInterval) {
      clearTimeout(pollInterval);
    }
    stopLogPolling();
  });

  $: isValid = connection.url && connection.username && connection.password;
  $: canDownload = currentJob?.status === 'completed' && !dryRun;
  $: overlayVisible = showOverlay && currentJob;
</script>

<div>
  <div class="card export-card">
    <div class="card-header">
      <h2 class="card-title">Export Configuration</h2>
      <p class="text-sm text-gray">Export Dispatcharr configuration to a file</p>
    </div>

    <ConnectionForm
      bind:connection
      label="Source Instance"
      {savedConnections}
      allowManualEntry={false}
      allowSave={false}
      showSelectedSummary={false}
      testable={false}
      loadingSaved={loadingSavedConnections}
      savedError={savedConnectionsError}
    />

    <div class="mt-3">
      <OptionsForm bind:options title="Export Options" />
    </div>

    <div class="flex items-center gap-2 mt-3">
      <div class="checkbox-group">
        <input
          type="checkbox"
          id="dryRun"
          class="form-checkbox"
          bind:checked={dryRun}
        />
        <label for="dryRun">Dry Run (preview without creating file)</label>
      </div>
    </div>

    {#if error}
      <div class="alert alert-error mt-2">
        {error}
      </div>
    {/if}

    {#if !exporting && !canDownload}
      <div class="actions-row">
        <button
          class="btn btn-primary"
          on:click={handleExport}
          disabled={!isValid}
        >
          {dryRun ? 'Preview Export' : 'Start Export'}
        </button>
      </div>
    {/if}
  </div>

  {#if overlayVisible}
    <div class="overlay">
      <div class="overlay-card">
          <div class="flex justify-between items-center mb-2">
            <div>
              <p class="text-sm text-gray">{overlayMessage}</p>
              {#if currentJob}
                <p class="text-xs text-gray">Job ID: {currentJob.jobId}</p>
              {/if}
            </div>
            <div class="flex gap-2">
              {#if currentJob}
                <button class="btn btn-secondary btn-sm" on:click={() => showLogs = true}>
                  View logs
                </button>
              {/if}
              {#if currentJob?.status === 'running' || currentJob?.status === 'pending'}
                <button class="btn btn-secondary btn-sm" on:click={runInBackground}>
                  Run in background
                </button>
                <button class="btn btn-secondary btn-sm" on:click={handleCancel} disabled={!currentJob}>
                  Cancel
                </button>
              {:else}
                {#if canDownload}
                  <button class="btn btn-success btn-sm" on:click={handleDownload}>
                    Download
                  </button>
                {/if}
                <button class="btn btn-secondary btn-sm" on:click={closeOverlay}>
                  Close
                </button>
              {/if}
          </div>
        </div>
        {#if currentJob}
          <JobProgress job={currentJob} />
        {:else}
          <div class="flex items-center gap-2">
            <span class="spinner"></span>
            <span>Preparing export...</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}


  {#if showLogs}
    <div class="logs-overlay" role="presentation">
      <button class="sr-only" on:click={() => showLogs = false}>Close logs</button>
      <div
        class="logs-modal"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex justify-between items-center mb-2">
          <h3>Job Logs</h3>
          <button class="btn btn-secondary btn-sm" on:click={() => showLogs = false}>Close</button>
        </div>
        <div class="logs-body">
          {#if logs.length === 0}
            <p class="text-sm text-gray">No logs yet.</p>
          {:else}
            {#each logs as log (log.timestamp + log.message)}
              <div class="log-line">
                <span class="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span class="log-msg">{log.message}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if showBackgroundModal}
    <div class="overlay">
      <div class="overlay-card" style="max-width: 400px;">
        <h3 class="mb-2">Running in Background</h3>
        <p class="text-sm text-gray mb-3">
          Your export is running in the background. You can view progress, logs, and download the file from the <strong>Jobs</strong> page.
        </p>
        <div class="flex justify-end">
          <button class="btn btn-primary btn-sm" on:click={() => showBackgroundModal = false}>
            OK
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .overlay-card {
    width: min(700px, 100%);
    background: #fff;
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    padding: 1rem;
  }


  .logs-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1002;
    padding: 1rem;
  }

  .logs-modal {
    width: min(800px, 100%);
    max-height: 80vh;
    background: #fff;
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .logs-body {
    background: var(--gray-50);
    border: 1px solid var(--gray-200);
    border-radius: 0.5rem;
    padding: 0.75rem;
    overflow-y: auto;
    max-height: 60vh;
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 0.85rem;
  }

  .log-line {
    display: flex;
    gap: 0.5rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--gray-200);
  }

  .log-line:last-child {
    border-bottom: none;
  }

  .log-time {
    color: var(--gray-500);
    min-width: 4.5rem;
  }

  .log-msg {
    color: var(--gray-800);
  }

  .export-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .actions-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
  }
</style>
