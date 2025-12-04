<script lang="ts">
  import { onDestroy } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import OptionsForm from './OptionsForm.svelte';
  import JobProgress from './JobProgress.svelte';
  import { startExport, getExportStatus, getExportDownloadUrl } from '../api';
  import type { DispatcharrConnection, ExportOptions, JobStatus } from '../types';

  let connection: DispatcharrConnection = {
    url: '',
    username: '',
    password: ''
  };

  let options: ExportOptions = {
    syncChannelGroups: true,
    syncChannelProfiles: true,
    syncChannels: true,
    format: 'yaml',
    compress: 'none',
    downloadLogos: false,
  };

  let dryRun = false;
  let exporting = false;
  let currentJob: JobStatus | null = null;
  let error: string | null = null;
  let pollInterval: number | null = null;

  async function handleExport() {
    exporting = true;
    error = null;
    currentJob = null;

    try {
      const jobId = await startExport(connection, options, dryRun);
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

      if (job.status === 'running' || job.status === 'pending') {
        pollInterval = window.setTimeout(() => pollJobStatus(jobId), 1000);
      } else {
        exporting = false;
      }
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to get job status';
      exporting = false;
    }
  }

  function handleDownload() {
    if (currentJob?.jobId) {
      const url = getExportDownloadUrl(currentJob.jobId);
      window.location.href = url;
    }
  }

  onDestroy(() => {
    if (pollInterval) {
      clearTimeout(pollInterval);
    }
  });

  $: isValid = connection.url && connection.username && connection.password;
  $: canDownload = currentJob?.status === 'completed' && !dryRun;
</script>

<div>
  <div class="card">
    <div class="card-header">
      <h2 class="card-title">Export Configuration</h2>
      <p class="text-sm text-gray">Export Dispatcharr configuration to a file</p>
    </div>

    <ConnectionForm bind:connection label="Source Instance" />

    <div class="mt-3">
      <OptionsForm bind:options />
    </div>

    <div class="grid grid-2 mt-3">
      <div class="form-group">
        <label class="form-label" for="format">Export Format</label>
        <select id="format" class="form-select" bind:value={options.format}>
          <option value="yaml">YAML</option>
          <option value="json">JSON</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="compress">Compression</label>
        <select id="compress" class="form-select" bind:value={options.compress}>
          <option value="none">None</option>
          <option value="zip">ZIP</option>
          <option value="targz">TAR.GZ</option>
        </select>
      </div>
    </div>

    <div class="flex items-center gap-2 mt-2">
      <div class="checkbox-group">
        <input
          type="checkbox"
          id="downloadLogos"
          class="form-checkbox"
          bind:checked={options.downloadLogos}
        />
        <label for="downloadLogos">Download Logos</label>
      </div>

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

    <div class="flex justify-between items-center mt-3">
      <button
        class="btn btn-primary"
        on:click={handleExport}
        disabled={!isValid || exporting}
      >
        {#if exporting}
          <span class="spinner"></span>
          Exporting...
        {:else}
          {dryRun ? 'Preview Export' : 'Start Export'}
        {/if}
      </button>

      {#if canDownload}
        <button class="btn btn-success" on:click={handleDownload}>
          Download Export
        </button>
      {/if}
    </div>
  </div>

  {#if currentJob}
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Export Progress</h3>
      </div>
      <JobProgress job={currentJob} />
    </div>
  {/if}
</div>
