<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import OptionsForm from './OptionsForm.svelte';
  import JobProgress from './JobProgress.svelte';
  import { startSync, getSyncStatus, listSavedConnections } from '../api';
  import type { DispatcharrConnection, SyncOptions, JobStatus, SavedConnection } from '../types';

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
    syncLogos: false,
  };

  let dryRun = false;
  let syncing = false;
  let currentJob: JobStatus | null = null;
  let error: string | null = null;
  let pollInterval: number | null = null;
  let savedConnections: SavedConnection[] = [];
  let loadingSavedConnections = false;
  let savedConnectionsError: string | null = null;

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

  async function handleSync() {
    syncing = true;
    error = null;
    currentJob = null;

    try {
      const jobId = await startSync(sourceConnection, destConnection, options, dryRun);
      pollJobStatus(jobId);
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to start sync';
      syncing = false;
    }
  }

  async function pollJobStatus(jobId: string) {
    try {
      const job = await getSyncStatus(jobId);
      currentJob = job;

      if (job.status === 'running' || job.status === 'pending') {
        pollInterval = window.setTimeout(() => pollJobStatus(jobId), 1000);
      } else {
        syncing = false;
      }
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to get job status';
      syncing = false;
    }
  }

  onDestroy(() => {
    if (pollInterval) {
      clearTimeout(pollInterval);
    }
  });

  $: isValid = sourceConnection.url && sourceConnection.username && sourceConnection.password &&
               destConnection.url && destConnection.username && destConnection.password;
</script>

<div>
  <div class="card export-card">
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
        on:click={handleSync}
        disabled={!isValid || syncing}
      >
        {#if syncing}
          <span class="spinner"></span>
          Syncing...
        {:else}
          {dryRun ? 'Preview Sync' : 'Start Sync'}
        {/if}
      </button>
    </div>
  </div>

  {#if currentJob}
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Sync Progress</h3>
      </div>
      <JobProgress job={currentJob} />
    </div>
  {/if}
</div>

<style>
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
