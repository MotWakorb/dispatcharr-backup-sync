<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import OptionsForm from './OptionsForm.svelte';
  import JobProgress from './JobProgress.svelte';
  import PluginUploadModal from './PluginUploadModal.svelte';
  import { startSync, getSyncStatus, listSavedConnections, comparePlugins, getJobLogs } from '../api';
  import type { DispatcharrConnection, SyncOptions, JobStatus, SavedConnection, PluginInfo } from '../types';

  let sourceConnection: DispatcharrConnection = {
    url: '',
    username: '',
    password: ''
  };

  let destConnection: DispatcharrConnection = {
    url: '',
    username: '',
    password: ''
  };

  let options: SyncOptions = {
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
  let syncing = false;
  let currentJob: JobStatus | null = null;
  let error: string | null = null;
  let pollInterval: number | null = null;
  let savedConnections: SavedConnection[] = [];
  let loadingSavedConnections = false;
  let savedConnectionsError: string | null = null;

  // Plugin comparison state
  let checkingPlugins = false;
  let missingPlugins: PluginInfo[] = [];
  let showPluginUploadModal = false;

  // Modal overlay state
  let showOverlay = false;
  let overlayMessage = 'Sync in progress...';
  let backgroundJobId: string | null = null;
  let showLogs = false;
  let logs: { timestamp: string; message: string }[] = [];
  let logsPoll: number | null = null;

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

  async function handleSyncClick() {
    error = null;

    // If syncPlugins is enabled, check for missing plugins first
    if (options.syncPlugins && !dryRun) {
      checkingPlugins = true;
      try {
        const result = await comparePlugins(sourceConnection, destConnection);
        missingPlugins = result.missingPlugins;

        if (missingPlugins.length > 0) {
          showPluginUploadModal = true;
          checkingPlugins = false;
          return;
        }
      } catch (err: any) {
        error = err.response?.data?.error || err.message || 'Failed to compare plugins';
        checkingPlugins = false;
        return;
      }
      checkingPlugins = false;
    }

    await startSyncJob();
  }

  function handlePluginUploadComplete() {
    showPluginUploadModal = false;
    missingPlugins = [];
    startSyncJob();
  }

  function handlePluginUploadSkip() {
    showPluginUploadModal = false;
    missingPlugins = [];
    startSyncJob();
  }

  async function startSyncJob() {
    syncing = true;
    error = null;
    currentJob = null;
    overlayMessage = 'Sync in progress...';
    showOverlay = true;
    backgroundJobId = null;
    logs = [];
    showLogs = false;
    stopLogPolling();

    try {
      const jobId = await startSync(sourceConnection, destConnection, options, dryRun);
      startLogPolling(jobId);
      pollJobStatus(jobId);
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to start sync';
      syncing = false;
      showOverlay = false;
    }
  }

  async function pollJobStatus(jobId: string) {
    try {
      const job = await getSyncStatus(jobId);
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
          overlayMessage = 'Sync cancelled';
        }
        if (job.status === 'failed') {
          error = job.error || job.message || 'Sync failed';
        }
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          stopLogPolling();
          await loadLogs(job.jobId);
        }
        syncing = false;
      }
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to get job status';
      syncing = false;
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

  onDestroy(() => {
    if (pollInterval) {
      clearTimeout(pollInterval);
    }
    stopLogPolling();
  });

  $: isValid = sourceConnection.url && sourceConnection.username && sourceConnection.password &&
               destConnection.url && destConnection.username && destConnection.password;
  $: overlayVisible = showOverlay && currentJob;
</script>

<div>
  <div class="card sync-card">
    <div class="card-header">
      <h2 class="card-title">Sync Between Instances</h2>
      <p class="text-sm text-gray">Synchronize configuration between two Dispatcharr instances</p>
    </div>

    <div class="grid grid-2 mb-3">
      <ConnectionForm
        bind:connection={sourceConnection}
        label="Source Instance"
        {savedConnections}
        allowManualEntry={false}
        allowSave={false}
        showSelectedSummary={false}
        testable={false}
        loadingSaved={loadingSavedConnections}
        savedError={savedConnectionsError}
      />
      <ConnectionForm
        bind:connection={destConnection}
        label="Destination Instance"
        {savedConnections}
        allowManualEntry={false}
        allowSave={false}
        showSelectedSummary={false}
        testable={false}
        loadingSaved={loadingSavedConnections}
        savedError={savedConnectionsError}
      />
    </div>

    <OptionsForm bind:options />

    <div class="flex items-center gap-2 mt-3">
      <div class="checkbox-group">
        <input
          type="checkbox"
          id="dryRun"
          class="form-checkbox"
          bind:checked={dryRun}
        />
        <label for="dryRun">Dry Run (preview changes without applying)</label>
      </div>
    </div>

    {#if error}
      <div class="alert alert-error mt-2">
        {error}
      </div>
    {/if}

    <div class="actions-row">
      <button
        class="btn btn-primary"
        on:click={handleSyncClick}
        disabled={!isValid || syncing || checkingPlugins}
      >
        {#if checkingPlugins}
          <span class="spinner"></span>
          Checking plugins...
        {:else if syncing}
          <span class="spinner"></span>
          Syncing...
        {:else}
          {dryRun ? 'Preview Sync' : 'Start Sync'}
        {/if}
      </button>
    </div>
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
              <button class="btn btn-secondary btn-sm" on:click={() => { showOverlay = false; backgroundJobId = currentJob?.jobId || backgroundJobId; }}>
                Run in background
              </button>
            {:else}
              <button class="btn btn-secondary btn-sm" on:click={() => showOverlay = false}>
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
            <span>Preparing sync...</span>
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
</div>

{#if showPluginUploadModal}
  <PluginUploadModal
    show={true}
    connection={destConnection}
    plugins={missingPlugins}
    on:uploaded={handlePluginUploadComplete}
    on:skip={handlePluginUploadSkip}
    on:continue={handlePluginUploadComplete}
  />
{/if}

<style>
  .sync-card {
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

  .overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .overlay-card {
    width: min(700px, 100%);
    background: var(--bg-card);
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    padding: 1rem;
  }

  .logs-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1002;
    padding: 1rem;
  }

  .logs-modal {
    width: min(800px, 100%);
    max-height: 80vh;
    background: var(--bg-card);
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .logs-body {
    background: var(--bg-hover);
    border: 1px solid var(--border-color);
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
    border-bottom: 1px solid var(--border-color);
  }

  .log-line:last-child {
    border-bottom: none;
  }

  .log-time {
    color: var(--text-muted);
    min-width: 4.5rem;
  }

  .log-msg {
    color: var(--text-primary);
  }
</style>
