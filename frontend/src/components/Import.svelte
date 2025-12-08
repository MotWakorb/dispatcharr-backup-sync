<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import JobProgress from './JobProgress.svelte';
  import { startImport, getImportStatus, listSavedConnections, inspectImportFile, getJobLogs } from '../api';
  import type { DispatcharrConnection, ImportOptions, JobStatus, SavedConnection, JobLogEntry } from '../types';

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
  let availableSections: { key: string; label: string; optionKey: keyof ImportOptions }[] = [];
  let importOptions: ImportOptions = {};
  let parseError: string | null = null;
  let parseNotice: string | null = null;
  let parsing = false;
  let dragging = false;
  let detectUploadProgress = 0;
  let importUploadProgress = 0;
  let detectFinished = false;
  let cachedUploadId: string | null = null;
  let logs: JobLogEntry[] = [];
  let showLogs = false;
  let logsLoading = false;
  let logsError: string | null = null;

  const sectionDefinitions: { key: string; label: string; optionKey: keyof ImportOptions }[] = [
    { key: 'channelGroups', label: 'Channel Groups', optionKey: 'syncChannelGroups' },
    { key: 'channelProfiles', label: 'Channel Profiles', optionKey: 'syncChannelProfiles' },
    { key: 'channels', label: 'Channels', optionKey: 'syncChannels' },
    { key: 'm3uSources', label: 'M3U Sources', optionKey: 'syncM3USources' },
    { key: 'streamProfiles', label: 'Stream Profiles', optionKey: 'syncStreamProfiles' },
    { key: 'userAgents', label: 'User Agents', optionKey: 'syncUserAgents' },
    { key: 'coreSettings', label: 'Core Settings', optionKey: 'syncCoreSettings' },
    { key: 'epgSources', label: 'EPG Sources', optionKey: 'syncEPGSources' },
    { key: 'plugins', label: 'Plugins', optionKey: 'syncPlugins' },
    { key: 'dvrRules', label: 'DVR Rules', optionKey: 'syncDVRRules' },
    { key: 'comskipConfig', label: 'Comskip Config', optionKey: 'syncComskipConfig' },
    { key: 'users', label: 'Users', optionKey: 'syncUsers' },
    { key: 'logos', label: 'Logos', optionKey: 'syncLogos' },
  ];

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
      resetDetection();
    }
  }

  function resetDetection() {
    availableSections = [];
    importOptions = {};
    parseError = null;
    parseNotice = null;
    detectUploadProgress = 0;
    detectFinished = false;
    cachedUploadId = null;
    logs = [];
    logsError = null;
    showLogs = false;
  }

  async function inspectSelectedFile(file: File | null) {
    resetDetection();
    if (!file) return;

    parsing = true;
    detectUploadProgress = 0;
    try {
      const { sections, uploadId } = await inspectImportFile(file, (percent) => {
        detectUploadProgress = percent;
      });
      cachedUploadId = uploadId || null;
      const detected = sectionDefinitions.filter((def) => sections.includes(def.key));
      availableSections = detected;
      detected.forEach((def) => {
        importOptions[def.optionKey] = true;
      });
      if (detected.length === 0) {
        parseNotice = 'No importable sections detected in the file.';
      } else {
        parseNotice = `Detected sections: ${detected.map((d) => d.label).join(', ')}`;
      }
    } catch (err: any) {
      parseError = err?.message ? `Failed to read file: ${err.message}` : 'Failed to read file.';
    } finally {
      parsing = false;
      detectUploadProgress = detectUploadProgress || (selectedFile ? 100 : 0);
      detectFinished = true;
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer?.files?.length) {
      selectedFile = event.dataTransfer.files[0];
      resetDetection();
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    dragging = true;
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    dragging = false;
  }

  function handleDropzoneKey(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput?.click();
    }
  }

  function toggleImportSections() {
    const allSelected = availableSections.every((def) => importOptions[def.optionKey] !== false);
    availableSections.forEach((def) => {
      importOptions[def.optionKey] = !allSelected;
    });
  }

  async function handleImport() {
    if (!selectedFile) {
      error = 'Please select a file to import';
      return;
    }

    if (availableSections.length > 0) {
      const anySelected = availableSections.some((def) => importOptions[def.optionKey]);
      if (!anySelected) {
        error = 'Select at least one section to import or deselect the file.';
        return;
      }
    }

    importing = true;
    importUploadProgress = 0;
    error = null;
    currentJob = null;
    logs = [];
    logsError = null;
    showLogs = false;

    try {
      const jobId = await startImport(
        connection,
        cachedUploadId ? null : selectedFile,
        availableSections.length > 0 ? importOptions : undefined,
        (percent) => {
          importUploadProgress = percent;
        },
        cachedUploadId || undefined
      );
      pollJobStatus(jobId);
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to start import';
      importing = false;
      importUploadProgress = 0;
    }
  }

  async function loadLogs() {
    if (!currentJob?.jobId) return;
    logsLoading = true;
    logsError = null;
    try {
      logs = await getJobLogs(currentJob.jobId);
    } catch (err: any) {
      logsError = err?.response?.data?.error || err?.message || 'Failed to load logs';
    } finally {
      logsLoading = false;
    }
  }

  async function openLogs() {
    showLogs = true;
    await loadLogs();
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
  $: importOptionsEnabled = availableSections.length > 0;
  $: allImportOptionsSelected =
    importOptionsEnabled && availableSections.every((def) => importOptions[def.optionKey]);
  $: showUploadPopover = parsing
    || importing
    || (detectUploadProgress > 0 && !detectFinished)
    || importUploadProgress > 0;
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
        <div
          class={`dropzone ${dragging ? 'dragging' : ''}`}
          on:dragover={handleDragOver}
          on:dragleave={handleDragLeave}
          on:drop={handleDrop}
          on:click={() => fileInput?.click()}
          on:keydown={handleDropzoneKey}
          role="button"
          tabindex="0"
        >
          <input
            id="file"
            type="file"
            class="sr-only"
            accept=".yaml,.yml,.json,.zip,.tar.gz,.tgz"
            on:change={handleFileSelect}
            bind:this={fileInput}
          />
          <p class="text-sm">Drag & drop a backup file here, or click to choose.</p>
          <p class="text-xs text-gray">Supports YAML/JSON, .zip, .tar.gz archives.</p>
        </div>
        {#if selectedFile}
          <p class="text-sm text-gray mt-1">
            Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
          </p>
        {/if}
        <div class="actions-row file-actions">
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            on:click={() => inspectSelectedFile(selectedFile)}
            disabled={!selectedFile || parsing}
          >
            {#if parsing}
              <span class="spinner"></span>
              Upload & Detect
            {:else}
              Upload & Detect
            {/if}
          </button>
        </div>
        {#if parseError}
          <div class="alert alert-error mt-2">{parseError}</div>
        {/if}
        {#if parseNotice}
          <div class="alert alert-info mt-2">{parseNotice}</div>
        {/if}
      </div>
    </div>

    {#if importOptionsEnabled}
      <div class="options-form mt-3">
        <div class="flex items-center justify-between mb-2">
          <h3>Import Options (detected)</h3>
          <button class="btn btn-secondary btn-sm" type="button" on:click={toggleImportSections}>
            {allImportOptionsSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        <div class="grid grid-3">
          {#each availableSections as section}
            <div class="checkbox-group">
              <input
                type="checkbox"
                id={`import-${section.key}`}
                class="form-checkbox"
                bind:checked={importOptions[section.optionKey]}
              />
              <label for={`import-${section.key}`}>{section.label}</label>
            </div>
          {/each}
        </div>
      </div>
    {/if}

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

  {#if showUploadPopover}
    <div class="progress-popover" role="status">
      <div class="popover-header">Uploads</div>
      <div class="popover-row">
        <div class="popover-label">Detect upload</div>
        <div class="progress-bar popover-bar">
          <div class="progress-fill" style={`width: ${Math.min(detectUploadProgress || (parsing ? 100 : 0), 100)}%`}></div>
        </div>
        <div class="popover-value">{Math.min(detectUploadProgress || (parsing ? 100 : 0), 100)}%</div>
      </div>
      {#if importUploadProgress > 0 || importing}
        <div class="popover-row">
          <div class="popover-label">Import upload</div>
          <div class="progress-bar popover-bar">
            <div class="progress-fill" style={`width: ${Math.min(importUploadProgress, 100)}%`}></div>
          </div>
          <div class="popover-value">{Math.min(importUploadProgress, 100)}%</div>
        </div>
      {/if}
    </div>
  {/if}

  {#if currentJob}
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Import Progress</h3>
        <button
          class="btn btn-secondary btn-sm"
          type="button"
          on:click={openLogs}
          disabled={!currentJob?.jobId}
        >
          View Logs
        </button>
      </div>
      <JobProgress job={currentJob} />
    </div>
  {/if}

  {#if showLogs}
    <div class="logs-overlay" role="presentation">
      <div class="logs-modal" role="dialog" aria-modal="true">
        <div class="flex justify-between items-center mb-2">
          <h3>Import Logs</h3>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm" type="button" on:click={loadLogs} disabled={logsLoading}>
              {#if logsLoading}
                <span class="spinner"></span>
                Refresh
              {:else}
                Refresh
              {/if}
            </button>
            <button class="btn btn-secondary btn-sm" type="button" on:click={() => showLogs = false}>Close</button>
          </div>
        </div>
        {#if logsError}
          <div class="alert alert-error mb-2">{logsError}</div>
        {/if}
        <div class="logs-body">
          {#if logsLoading}
            <div class="flex items-center gap-2"><span class="spinner"></span><span>Loading logs...</span></div>
          {:else if logs.length === 0}
            <p class="text-sm text-gray">No logs yet.</p>
          {:else}
            {#each logs as log}
              <div class={`log-line ${/error|failed/i.test(log.message) ? 'log-error' : ''}`}>
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

<style>
  .export-card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .options-form {
    padding: 1rem;
    background: var(--gray-50);
    border-radius: 0.5rem;
  }

  .actions-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .file-actions {
    justify-content: flex-end;
    margin-top: 0.5rem;
  }

  .dropzone {
    border: 2px dashed var(--gray-300);
    background: var(--gray-50);
    padding: 1rem;
    border-radius: 0.5rem;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }

  .dropzone.dragging {
    border-color: var(--primary);
    background: #e0ecff;
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

  .log-error .log-msg {
    color: var(--danger);
    font-weight: 600;
  }

  .progress-popover {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    background: #fff;
    border: 1px solid var(--gray-200);
    border-radius: 0.5rem;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    padding: 0.75rem;
    min-width: 260px;
    z-index: 1003;
  }

  .popover-header {
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .popover-row {
    display: grid;
    grid-template-columns: 1fr 2fr auto;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .popover-bar {
    height: 8px;
  }

  .popover-label {
    font-size: 0.8rem;
    color: var(--gray-600);
  }

  .popover-value {
    font-size: 0.8rem;
    color: var(--gray-800);
    min-width: 2.5rem;
    text-align: right;
  }
</style>
