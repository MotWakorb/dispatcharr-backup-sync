<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import JobProgress from './JobProgress.svelte';
  import { startImport, getImportStatus, listSavedConnections, inspectImportFile, getJobLogs, uploadPluginFiles } from '../api';
  import type { DispatcharrConnection, ImportOptions, JobStatus, SavedConnection, JobLogEntry, PluginInfo } from '../types';

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
  let parsing = false;
  let dragging = false;
  let detectUploadProgress = 0;
  let importUploadProgress = 0;
  let cachedUploadId: string | null = null;
  let logs: JobLogEntry[] = [];
  let showLogs = false;
  let logsPoll: number | null = null;
  let detectedPlugins: PluginInfo[] = [];
  let showImportModal = false;
  let pluginDragging = false;
  let pluginFiles: File[] = [];
  let pluginUploading = false;
  let pluginUploadProgress = 0;
  let pluginUploadResult: { uploaded: number; skipped?: string[]; errors: string[] } | null = null;
  let pluginUploadError: string | null = null;

  // Overlay state
  let showOverlay = false;
  let overlayMessage = 'Import in progress...';

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
    // Logos disabled for v1.0 release - code remains in backend
    // { key: 'logos', label: 'Logos', optionKey: 'syncLogos' },
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
      const file = target.files[0];
      selectedFile = file;
      // Auto-trigger inspection when file is selected
      inspectSelectedFile(file);
    }
  }

  function resetDetection() {
    availableSections = [];
    importOptions = {};
    parseError = null;
    detectUploadProgress = 0;
    cachedUploadId = null;
    logs = [];
    showLogs = false;
    detectedPlugins = [];
    showImportModal = false;
    pluginUploadResult = null;
    pluginUploadError = null;
  }

  async function inspectSelectedFile(file: File | null) {
    resetDetection();
    if (!file) return;

    parsing = true;
    detectUploadProgress = 0;
    try {
      const { sections, uploadId, plugins } = await inspectImportFile(file, (percent) => {
        detectUploadProgress = percent;
      });
      cachedUploadId = uploadId || null;
      detectedPlugins = plugins || [];
      const detected = sectionDefinitions.filter((def) => sections.includes(def.key));
      availableSections = detected;
      detected.forEach((def) => {
        importOptions[def.optionKey] = true;
      });
      if (detected.length === 0) {
        parseError = 'No importable sections detected in the file.';
      } else {
        // Show the import modal after successful inspection
        showImportModal = true;
      }
    } catch (err: any) {
      parseError = err?.message ? `Failed to read file: ${err.message}` : 'Failed to read file.';
    } finally {
      parsing = false;
      detectUploadProgress = detectUploadProgress || (selectedFile ? 100 : 0);
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer?.files?.length) {
      const file = event.dataTransfer.files[0];
      selectedFile = file;
      // Auto-trigger inspection when file is dropped
      inspectSelectedFile(file);
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
    importOptions = importOptions; // Trigger Svelte reactivity
  }

  function toggleImportOption(optionKey: keyof ImportOptions) {
    importOptions[optionKey] = !importOptions[optionKey];
    importOptions = importOptions; // Trigger Svelte reactivity
  }

  function closeImportModal() {
    showImportModal = false;
    selectedFile = null;
    resetDetection();
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

    // Plugin uploads are now handled inline in the import modal, so proceed directly
    await executeImport();
  }

  async function executeImport() {
    importing = true;
    importUploadProgress = 0;
    error = null;
    currentJob = null;
    logs = [];
    showLogs = false;
    showImportModal = false; // Close config modal so progress overlay shows
    overlayMessage = 'Import in progress...';
    showOverlay = true;
    stopLogPolling();

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
      startLogPolling(jobId);
      pollJobStatus(jobId);
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to start import';
      importing = false;
      importUploadProgress = 0;
      showOverlay = false;
    }
  }

  let pluginFileInput: HTMLInputElement;

  // Plugin drop zone handlers
  function handlePluginDrop(event: DragEvent) {
    event.preventDefault();
    pluginDragging = false;
    if (!connection.url || !connection.username || !connection.password) return;

    if (event.dataTransfer?.files?.length) {
      const files = Array.from(event.dataTransfer.files).filter(f =>
        f.name.endsWith('.zip') || f.type === 'application/zip'
      );
      if (files.length > 0) {
        // Auto-upload immediately
        uploadPluginFilesNow(files);
      }
    }
  }

  function handlePluginFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!connection.url || !connection.username || !connection.password) return;

    if (target.files && target.files.length > 0) {
      const files = Array.from(target.files).filter(f =>
        f.name.endsWith('.zip') || f.type === 'application/zip'
      );
      if (files.length > 0) {
        // Auto-upload immediately
        uploadPluginFilesNow(files);
      }
      // Reset file input so the same file can be selected again
      target.value = '';
    }
  }

  function handlePluginDragOver(event: DragEvent) {
    event.preventDefault();
    if (connection.url && connection.username && connection.password) {
      pluginDragging = true;
    }
  }

  function handlePluginDragLeave(event: DragEvent) {
    event.preventDefault();
    pluginDragging = false;
  }

  async function uploadPluginFilesNow(files: File[]) {
    if (files.length === 0) return;

    pluginUploading = true;
    pluginUploadProgress = 0;
    pluginUploadError = null;
    pluginUploadResult = null;
    pluginFiles = files; // Show which files are being uploaded

    try {
      const result = await uploadPluginFiles(connection, files, (percent) => {
        pluginUploadProgress = percent;
      });
      pluginUploadResult = result;
      // Clear files list after upload completes
      pluginFiles = [];
    } catch (err: any) {
      pluginUploadError = err.response?.data?.error || err.message || 'Failed to upload plugins';
      pluginFiles = [];
    } finally {
      pluginUploading = false;
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

  async function pollJobStatus(jobId: string) {
    try {
      const job = await getImportStatus(jobId);
      currentJob = job;

      if (job.status === 'running' || job.status === 'pending') {
        pollInterval = window.setTimeout(() => pollJobStatus(jobId), 1000);
      } else {
        if (pollInterval) {
          clearTimeout(pollInterval);
          pollInterval = null;
        }
        // Keep overlay visible when job completes so user can see results and click Close
        if (job.status === 'cancelled') {
          overlayMessage = 'Import cancelled';
        }
        if (job.status === 'failed') {
          error = job.error || job.message || 'Import failed';
        }
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          stopLogPolling();
          await loadLogs(job.jobId);
        }
        importing = false;
      }
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to get job status';
      importing = false;
    }
  }

  function handleImportComplete() {
    importing = false;
    currentJob = null;
    showImportModal = false;
    showOverlay = false;
    selectedFile = null;
    resetDetection();
  }

  onDestroy(() => {
    if (pollInterval) {
      clearTimeout(pollInterval);
    }
    stopLogPolling();
  });

  $: isConnectionValid = connection.url && connection.username && connection.password;
  $: importOptionsEnabled = availableSections.length > 0;
  $: allImportOptionsSelected =
    importOptionsEnabled && availableSections.every((def) => importOptions[def.optionKey]);
  $: overlayVisible = showOverlay && currentJob;
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
          class={`dropzone ${dragging ? 'dragging' : ''} ${!isConnectionValid ? 'disabled' : ''}`}
          on:dragover={handleDragOver}
          on:dragleave={handleDragLeave}
          on:drop={isConnectionValid ? handleDrop : undefined}
          on:click={() => isConnectionValid && fileInput?.click()}
          on:keydown={isConnectionValid ? handleDropzoneKey : undefined}
          role="button"
          tabindex={isConnectionValid ? 0 : -1}
        >
          <input
            id="file"
            type="file"
            class="sr-only"
            accept=".json,.zip"
            on:change={handleFileSelect}
            bind:this={fileInput}
          />
          {#if parsing}
            <p class="text-sm">
              <span class="spinner inline-spinner"></span>
              Uploading and inspecting file...
            </p>
          {:else}
            <p class="text-sm">Drag & drop a backup file here, or click to choose.</p>
            <p class="text-xs text-gray">Supports JSON and .zip archives.</p>
          {/if}
        </div>
        {#if !isConnectionValid}
          <p class="text-xs text-warning mt-1">
            Select a destination instance above to enable file upload.
          </p>
        {/if}
        {#if parseError}
          <div class="alert alert-error mt-2">{parseError}</div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Import Configuration Modal -->
  {#if showImportModal}
    <div class="modal-overlay" role="presentation">
      <div class="modal import-modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3>Import Configuration</h3>
            <p class="text-sm text-gray">{selectedFile?.name}</p>
          </div>
          <button class="close-btn" type="button" on:click={closeImportModal} aria-label="Close">
            &times;
          </button>
        </div>

        <div class="modal-body">
          {#if importOptionsEnabled}
            <div class="options-form">
              <div class="flex items-center justify-between mb-2">
                <h4>Import Options</h4>
                <button class="btn btn-secondary btn-sm" type="button" on:click={toggleImportSections}>
                  {allImportOptionsSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div class="toggle-buttons">
                {#each availableSections as section}
                  <button
                    type="button"
                    class="toggle-btn {importOptions[section.optionKey] ? 'selected' : ''}"
                    on:click={() => toggleImportOption(section.optionKey)}
                  >
                    {section.label}
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          {#if detectedPlugins.length > 0}
            <div
              class="plugins-info-box mt-3 {pluginDragging ? 'plugin-dragging' : ''}"
              on:dragover={handlePluginDragOver}
              on:dragleave={handlePluginDragLeave}
              on:drop={handlePluginDrop}
              role="region"
            >
              <div class="plugins-header">
                <h4>Plugins in Backup ({detectedPlugins.length})</h4>
              </div>
              <p class="text-sm text-gray mb-2">
                These plugins must be installed on the destination instance before their settings can be restored.
                Upload plugin .zip files below to automatically install them.
              </p>
              <div class="plugin-chips">
                {#each detectedPlugins as plugin}
                  <span class="plugin-chip">
                    {plugin.name || plugin.key}
                  </span>
                {/each}
              </div>

              <div
                class="plugin-dropzone mt-3"
                on:click={() => pluginFileInput?.click()}
                on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && pluginFileInput?.click()}
                role="button"
                tabindex="0"
              >
                <input
                  type="file"
                  class="sr-only"
                  accept=".zip"
                  multiple
                  on:change={handlePluginFileSelect}
                  bind:this={pluginFileInput}
                />
                <p class="text-sm">
                  {#if pluginUploading}
                    <span class="spinner inline-spinner"></span>
                    Uploading {pluginFiles.length} plugin{pluginFiles.length > 1 ? 's' : ''}... {pluginUploadProgress}%
                  {:else if pluginDragging}
                    Drop plugin .zip files here
                  {:else}
                    Drag & drop plugin .zip files here, or click to choose
                  {/if}
                </p>
              </div>

              {#if pluginUploadError}
                <div class="alert alert-error mt-2">{pluginUploadError}</div>
              {/if}

              {#if pluginUploadResult}
                <div class="alert {pluginUploadResult.errors.length > 0 ? 'alert-warning' : 'alert-success'} mt-2">
                  {#if pluginUploadResult.uploaded > 0}
                    <p>Successfully uploaded {pluginUploadResult.uploaded} plugin(s).</p>
                  {/if}
                  {#if pluginUploadResult.skipped && pluginUploadResult.skipped.length > 0}
                    <p>{pluginUploadResult.skipped.length} plugin(s) already installed.</p>
                  {/if}
                  {#if pluginUploadResult.errors.length > 0}
                    <p>Errors:</p>
                    <ul class="error-list">
                      {#each pluginUploadResult.errors as err}
                        <li>{err}</li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}

          <div class="alert alert-warning mt-3">
            <strong>Warning:</strong> Importing will overwrite existing configuration in the destination instance.
            Make sure you have a backup before proceeding.
          </div>

          {#if error}
            <div class="alert alert-error mt-2">
              {error}
            </div>
          {/if}
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" type="button" on:click={closeImportModal}>
            Cancel
          </button>
          <button
            class="btn btn-primary"
            on:click={handleImport}
            disabled={importing}
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
    </div>
  {/if}

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
              <button class="btn btn-secondary btn-sm" on:click={() => { showOverlay = false; }}>
                Run in background
              </button>
            {:else}
              <button class="btn btn-secondary btn-sm" on:click={handleImportComplete}>
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
            <span>Preparing import...</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showLogs}
    <div class="logs-overlay" role="presentation">
      <button class="sr-only" on:click={() => showLogs = false}>Close logs</button>
      <div class="logs-modal" role="dialog" aria-modal="true">
        <div class="flex justify-between items-center mb-2">
          <h3>Job Logs</h3>
          <button class="btn btn-secondary btn-sm" on:click={() => showLogs = false}>Close</button>
        </div>
        <div class="logs-body">
          {#if logs.length === 0}
            <p class="text-sm text-gray">No logs yet.</p>
          {:else}
            {#each logs as log (log.timestamp + log.message)}
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

  .options-form h4 {
    margin: 0;
    font-size: 0.95rem;
  }

  .dropzone {
    border: 2px dashed var(--gray-300);
    background: var(--gray-50);
    padding: 1.5rem;
    border-radius: 0.5rem;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }

  .dropzone.dragging {
    border-color: var(--primary);
    background: #e0ecff;
  }

  .dropzone.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dropzone:not(.disabled):hover {
    border-color: var(--gray-400);
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

  .modal {
    width: min(700px, 95%);
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

  .modal-body {
    padding: 1.25rem;
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--gray-200);
  }

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
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
    padding: 1.25rem;
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

  .plugins-info-box {
    padding: 1rem;
    background: #fffbeb;
    border: 2px solid #f59e0b;
    border-radius: 0.5rem;
    transition: border-color 0.2s, background-color 0.2s;
  }

  .plugins-info-box.plugin-dragging {
    border-color: #d97706;
    background: #fef3c7;
    border-style: dashed;
  }

  .plugins-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .plugins-header h4 {
    margin: 0;
    font-size: 0.95rem;
    color: #92400e;
  }

  .plugin-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .plugin-chip {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    background: #fef3c7;
    border: 1px solid #fbbf24;
    border-radius: 1rem;
    font-size: 0.85rem;
    color: #78350f;
  }

  .text-warning {
    color: #b45309;
  }

  .plugin-dropzone {
    border: 2px dashed #fbbf24;
    background: #fefce8;
    padding: 1rem;
    border-radius: 0.5rem;
    text-align: center;
    color: #92400e;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }

  .plugin-dropzone:hover {
    border-color: #d97706;
    background: #fef3c7;
  }

  .error-list {
    margin: 0.25rem 0 0 1rem;
    padding: 0;
    font-size: 0.85rem;
  }

  .alert-success {
    background: #d1fae5;
    border: 1px solid #10b981;
    color: #065f46;
  }

  .inline-spinner {
    display: inline-block;
    vertical-align: middle;
    margin-right: 0.25rem;
  }

  .text-primary {
    color: var(--primary);
  }
</style>
