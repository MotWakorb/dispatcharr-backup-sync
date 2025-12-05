<script lang="ts">
  import { testConnection } from '../api';
  import type { DispatcharrConnection, SavedConnection, SavedConnectionInput } from '../types';

  export let connection: DispatcharrConnection = {
    url: '',
    username: '',
    password: ''
  };
  export let label: string = 'Dispatcharr Instance';
  export let testable: boolean = true;
  export let savedConnections: SavedConnection[] = [];
  export let onSaveConnection: ((payload: SavedConnectionInput) => Promise<SavedConnection>) | null = null;
  export let loadingSaved: boolean = false;
  export let savedError: string | null = null;
  export let allowManualEntry: boolean = true;
  export let allowSave: boolean = true;
  export let showSelectedSummary: boolean = true;

  let testing = false;
  let testResult: { success: boolean; message: string } | null = null;
  let selectedSavedId = '';
  let saving = false;
  let saveFeedback: { success: boolean; message: string } | null = null;
  let saveError: string | null = null;
  let saveName = '';
  let baseId = 'connection';
  let savedSelectId = 'saved-select';
  let saveLabelId = 'save-label';

  $: {
    const sanitized = label ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'connection';
    baseId = sanitized || 'connection';
    savedSelectId = `${baseId}-saved-select`;
    saveLabelId = `${baseId}-save-label`;
  }

  $: if (selectedSavedId && !savedConnections.find((conn) => conn.id === selectedSavedId)) {
    selectedSavedId = '';
  }

  async function handleTest() {
    testing = true;
    testResult = null;

    try {
      const result = await testConnection(connection);
      testResult = {
        success: result.success,
        message: result.message
      };
    } catch (error: any) {
      testResult = {
        success: false,
        message: error.response?.data?.error || error.message || 'Connection failed'
      };
    } finally {
      testing = false;
    }
  }

  function applySaved(id: string) {
    const saved = savedConnections.find((conn) => conn.id === id);
    if (!saved) return;

    connection = {
      url: saved.instanceUrl,
      username: saved.username,
      password: saved.password,
    };

    saveName = saved.name;
    saveFeedback = {
      success: true,
      message: 'Saved account applied',
    };
  }

  function handleSavedChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    applySaved(target.value);
  }

  async function handleSaveConnection() {
    if (!onSaveConnection) return;
    saveError = null;
    saveFeedback = null;

    if (!connection.url || !connection.username || !connection.password) {
      saveError = 'Fill in URL, username, and password before saving';
      return;
    }

    const payload: SavedConnectionInput = {
      name: saveName.trim() || `${connection.username}@${connection.url}`,
      instanceUrl: connection.url.trim(),
      username: connection.username.trim(),
      password: connection.password,
    };

    saving = true;
    try {
      const saved = await onSaveConnection(payload);
      selectedSavedId = saved.id;
      saveFeedback = {
        success: true,
        message: 'Connection saved for quick selection',
      };
    } catch (error: any) {
      saveError = error.response?.data?.error || error.message || 'Failed to save connection';
    } finally {
      saving = false;
    }
  }
</script>

<div class="connection-form">
  <h3 class="mb-2">{label}</h3>

  {#if allowManualEntry}
    <div class="form-group">
      <label class="form-label" for="{label}-url">URL</label>
      <input
        id="{label}-url"
        type="text"
        class="form-input"
        placeholder="http://localhost:9191"
        bind:value={connection.url}
      />
    </div>

    <div class="grid grid-2">
      <div class="form-group">
        <label class="form-label" for="{label}-username">Username</label>
        <input
          id="{label}-username"
          type="text"
          class="form-input"
          placeholder="admin"
          bind:value={connection.username}
        />
      </div>

      <div class="form-group">
        <label class="form-label" for="{label}-password">Password</label>
        <input
          id="{label}-password"
          type="password"
          class="form-input"
          placeholder="Password"
          bind:value={connection.password}
        />
      </div>
    </div>
  {:else}
    <div class="alert alert-info mb-2">
      Select a saved account below. Create or edit accounts in the Connections tab.
    </div>
    {#if connection.url && showSelectedSummary}
      <div class="saved-summary">
        <div class="text-sm"><strong>URL:</strong> {connection.url}</div>
        <div class="text-sm"><strong>User:</strong> {connection.username}</div>
      </div>
    {/if}
  {/if}

  {#if testable}
    <button
      class="btn btn-secondary btn-sm"
      on:click={handleTest}
      disabled={testing || !connection.url || !connection.username || !connection.password}
    >
      {#if testing}
        <span class="spinner"></span>
        Testing...
      {:else}
        Test Connection
      {/if}
    </button>
  {/if}

  {#if testResult}
    <div class="alert mt-2" class:alert-success={testResult.success} class:alert-error={!testResult.success}>
      {testResult.message}
    </div>
  {/if}

  {#if savedError}
    <div class="alert alert-error mt-2">
      {savedError}
    </div>
  {/if}

  {#if savedConnections.length > 0}
    <div class="form-group mt-3">
      <label class="form-label" for={savedSelectId}>Saved accounts</label>
      <div class="saved-row">
        <select
          class="form-select"
          bind:value={selectedSavedId}
          id={savedSelectId}
          on:change={handleSavedChange}
          disabled={loadingSaved}
        >
          <option value="">Select a saved account</option>
          {#each savedConnections as saved}
            <option value={saved.id}>
              {saved.name} — {saved.instanceUrl}
            </option>
          {/each}
        </select>
      </div>
    </div>
  {/if}

  {#if onSaveConnection && allowSave}
    <div class="save-block">
      <div class="grid grid-2">
        <div class="form-group">
          <label class="form-label" for={saveLabelId}>Save label</label>
          <input
            class="form-input"
            placeholder="Friendly name"
            id={saveLabelId}
            bind:value={saveName}
          />
        </div>
      </div>

      <button
        class="btn btn-secondary btn-sm"
        on:click={handleSaveConnection}
        disabled={saving}
      >
        {#if saving}
          <span class="spinner"></span>
          Saving...
        {:else}
          Save for reuse
        {/if}
      </button>

      {#if saveFeedback}
        <div class="alert alert-success mt-2">
          {saveFeedback.message}
        </div>
      {/if}

      {#if saveError}
        <div class="alert alert-error mt-2">
          {saveError}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .connection-form {
    padding: 1rem;
    background: var(--gray-50);
    border-radius: 0.5rem;
  }

  .saved-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .save-block {
    margin-top: 1rem;
    padding: 0.75rem;
    background: #fff;
    border: 1px solid var(--gray-200);
    border-radius: 0.5rem;
  }

  .saved-summary {
    background: #fff;
    border: 1px solid var(--gray-200);
    border-radius: 0.5rem;
    padding: 0.75rem;
  }
</style>
