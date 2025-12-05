<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import JobProgress from './JobProgress.svelte';
  import { startImport, getImportStatus, listSavedConnections } from '../api';
  import type { DispatcharrConnection, JobStatus, SavedConnection } from '../types';

  let connection: DispatcharrConnection = {
    url: '',
    username: '',
    password: ''
  };

  let fileInput: HTMLInputElement;
  let selectedFile: File | null = null;
  let importing = false;
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

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      selectedFile = target.files[0];
    }
  }

  async function handleImport() {
    if (!selectedFile) {
      error = 'Please select a file to import';
      return;
    }

    importing = true;
    error = null;
    currentJob = null;

    try {
      const jobId = await startImport(connection, selectedFile);
      pollJobStatus(jobId);
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to start import';
      importing = false;
    }
  }

  async function pollJobStatus(jobId: string) {
    try {
      const job = await getImportStatus(jobId);
      currentJob = job;

      if (job.status === 'running' || job.status === 'pending') {
        pollInterval = window.setTimeout(() => pollJobStatus(jobId), 1000);
      } else {
        importing = false;
      }
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to get job status';
      importing = false;
    }
  }

  onDestroy(() => {
    if (pollInterval) {
      clearTimeout(pollInterval);
    }
  });

  $: isValid = connection.url && connection.username && connection.password && selectedFile;
</script>

<div>
  <div class="card export-card">
    <div class="card-header">
      <h2 class="card-title">Import Configuration</h2>
      <p class="text-sm text-gray">Import configuration from a backup file</p>
    </div>

    <ConnectionForm
      bind:connection
      label="Destination Instance"
      {savedConnections}
      allowManualEntry={false}
      allowSave={false}
      showSelectedSummary={false}
      testable={false}
      loadingSaved={loadingSavedConnections}
      savedError={savedConnectionsError}
    />

    <div class="mt-3">
      <div class="form-group">
        <label class="form-label" for="file">Configuration File</label>
        <input
          id="file"
          type="file"
          class="form-input"
          accept=".yaml,.yml,.json,.zip,.tar.gz,.tgz"
          on:change={handleFileSelect}
          bind:this={fileInput}
        />
        {#if selectedFile}
          <p class="text-sm text-gray mt-1">
            Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
          </p>
        {/if}
      </div>
    </div>

    <div class="alert alert-warning mt-2">
      <strong>Warning:</strong> Importing will overwrite existing configuration in the destination instance.
      Make sure you have a backup before proceeding.
    </div>

    {#if error}
      <div class="alert alert-error mt-2">
        {error}
      </div>
    {/if}

    <div class="actions-row">
      <button
        class="btn btn-primary"
        on:click={handleImport}
        disabled={!isValid || importing}
      >
        {#if importing}
          <span class="spinner"></span>
          Importing...
        {:else}
          Start Import
        {/if}
      </button>
    </div>
  </div>

  {#if currentJob}
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Import Progress</h3>
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
