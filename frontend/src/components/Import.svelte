<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import JobProgress from './JobProgress.svelte';
  import { startImport, getImportStatus, listSavedConnections } from '../api';
  import type { DispatcharrConnection, ImportOptions, JobStatus, SavedConnection } from '../types';
  import { load as parseYaml } from 'js-yaml';

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
      inspectSelectedFile(selectedFile);
    }
  }

  async function inspectSelectedFile(file: File | null) {
    availableSections = [];
    importOptions = {};
    parseError = null;
    parseNotice = null;
    if (!file) return;

    const lower = file.name.toLowerCase();
    const isJson = lower.endsWith('.json');
    const isYaml = lower.endsWith('.yaml') || lower.endsWith('.yml');

    if (!isJson && !isYaml) {
      parseNotice =
        'Section selection is available for YAML/JSON files. Archives will import all sections.';
      return;
    }

    parsing = true;
    try {
      const text = await file.text();
      const parsed = isJson ? JSON.parse(text) : parseYaml(text);
      const data = (parsed as any)?.data || {};
      const detected = sectionDefinitions.filter((def) => Boolean(data?.[def.key]));
      availableSections = detected;
      detected.forEach((def) => {
        importOptions[def.optionKey] = true;
      });
      if (detected.length === 0) {
        parseNotice = 'No importable sections detected in the file.';
      }
    } catch (err: any) {
      parseError = err?.message ? `Failed to read file: ${err.message}` : 'Failed to read file.';
    } finally {
      parsing = false;
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
    error = null;
    currentJob = null;

    try {
      const jobId = await startImport(
        connection,
        selectedFile,
        availableSections.length > 0 ? importOptions : undefined
      );
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
  $: importOptionsEnabled = availableSections.length > 0;
  $: allImportOptionsSelected =
    importOptionsEnabled && availableSections.every((def) => importOptions[def.optionKey]);
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
        {#if parsing}
          <p class="text-sm text-gray mt-1">Detecting sections...</p>
        {/if}
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
</style>
