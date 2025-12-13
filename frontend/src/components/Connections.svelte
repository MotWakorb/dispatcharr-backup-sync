<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listSavedConnections,
    createSavedConnection,
    deleteSavedConnection,
    testConnection,
    updateSavedConnection,
    getSettings,
    updateSettings,
    getTimezones,
  } from '../api';
  import type { SavedConnection, SavedConnectionInput, AppSettings, TimeFormat, Theme } from '../types';

  let savedConnections: SavedConnection[] = [];
  let loadingList = false;
  let error: string | null = null;
  let success: string | null = null;

  // Create modal state
  let showCreateModal = false;
  let createForm: SavedConnectionInput = {
    name: '',
    instanceUrl: '',
    username: '',
    password: '',
  };
  let createTest = { loading: false, result: null as null | { success: boolean; message: string } };
  let createSaving = false;
  let createError: string | null = null;

  // Edit modal state
  let editingConnection: SavedConnection | null = null;
  let editingForm: SavedConnectionInput = {
    name: '',
    instanceUrl: '',
    username: '',
    password: '',
  };
  let editingTest = { loading: false, result: null as null | { success: boolean; message: string } };
  let editingSaving = false;
  let editingError: string | null = null;

  // Test state for table rows
  let testState: Record<
    string,
    { loading: boolean; result?: { success: boolean; message: string } }
  > = {};

  // Settings state
  let appSettings: AppSettings | null = null;
  let availableTimezones: string[] = [];
  let selectedTimezone: string = 'UTC';
  let selectedTimeFormat: TimeFormat = '12h';
  let selectedTheme: Theme = 'auto';
  let savingSettings = false;
  let settingsSuccess: string | null = null;
  let settingsError: string | null = null;

  // Apply theme to document
  function applyTheme(theme: Theme) {
    document.documentElement.classList.remove('light', 'dark');
    if (theme !== 'auto') {
      document.documentElement.classList.add(theme);
    }
  }

  onMount(async () => {
    await loadConnections();
    await loadSettings();
  });

  async function loadSettings() {
    try {
      [appSettings, availableTimezones] = await Promise.all([
        getSettings(),
        getTimezones(),
      ]);
      selectedTimezone = appSettings.timezone;
      selectedTimeFormat = appSettings.timeFormat || '12h';
      selectedTheme = appSettings.theme || 'auto';
      applyTheme(selectedTheme);
    } catch (err: any) {
      // Settings load error - non-critical
      console.error('Failed to load settings:', err);
    }
  }

  async function handleSaveSettings() {
    const timezoneChanged = selectedTimezone !== appSettings?.timezone;
    const timeFormatChanged = selectedTimeFormat !== appSettings?.timeFormat;
    const themeChanged = selectedTheme !== appSettings?.theme;

    if (!timezoneChanged && !timeFormatChanged && !themeChanged) return;

    savingSettings = true;
    settingsError = null;
    settingsSuccess = null;
    try {
      const updates: Partial<AppSettings> = {};
      if (timezoneChanged) updates.timezone = selectedTimezone;
      if (timeFormatChanged) updates.timeFormat = selectedTimeFormat;
      if (themeChanged) updates.theme = selectedTheme;

      appSettings = await updateSettings(updates);

      // Apply theme immediately
      if (themeChanged) {
        applyTheme(selectedTheme);
      }

      const messages: string[] = [];
      if (timezoneChanged) messages.push(`Timezone updated to ${selectedTimezone}`);
      if (timeFormatChanged) messages.push(`Time format updated to ${selectedTimeFormat === '12h' ? '12-hour' : '24-hour'}`);
      if (themeChanged) messages.push(`Theme updated to ${selectedTheme}`);
      settingsSuccess = messages.join('. ') + '.';
    } catch (err: any) {
      settingsError = err.response?.data?.error || err.message || 'Failed to update settings';
      selectedTimezone = appSettings?.timezone || 'UTC';
      selectedTimeFormat = appSettings?.timeFormat || '12h';
      selectedTheme = appSettings?.theme || 'auto';
    } finally {
      savingSettings = false;
    }
  }

  async function loadConnections() {
    loadingList = true;
    error = null;
    try {
      savedConnections = await listSavedConnections();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to load connections';
    } finally {
      loadingList = false;
    }
  }

  // Create modal functions
  function openCreateModal() {
    showCreateModal = true;
    createForm = { name: '', instanceUrl: '', username: '', password: '' };
    createTest = { loading: false, result: null };
    createError = null;
    error = null;
    success = null;
  }

  function closeCreateModal() {
    showCreateModal = false;
    createForm = { name: '', instanceUrl: '', username: '', password: '' };
    createTest = { loading: false, result: null };
    createError = null;
  }

  function markCreateDirty() {
    createTest = { loading: false, result: null };
    createError = null;
  }

  async function handleCreateTest(event?: Event) {
    event?.preventDefault();
    createError = null;
    if (!createForm.instanceUrl || !createForm.username || !createForm.password) {
      createError = 'Instance URL, username, and password are required to test.';
      return;
    }
    createTest = { loading: true, result: null };
    try {
      const result = await testConnection({
        url: createForm.instanceUrl.trim(),
        username: createForm.username.trim(),
        password: createForm.password,
      });
      createTest = {
        loading: false,
        result: { success: result.success, message: result.message },
      };
      if (!result.success) {
        createError = result.message || 'Connection test failed.';
      }
    } catch (err: any) {
      createTest = {
        loading: false,
        result: {
          success: false,
          message: err.response?.data?.error || err.message || 'Connection failed',
        },
      };
      createError = createTest.result.message;
    }
  }

  async function handleCreate(event?: Event) {
    event?.preventDefault();
    createError = null;

    if (!createTest.result?.success) {
      createError = 'Please test the connection and ensure it succeeds before saving.';
      return;
    }

    if (!createForm.name || !createForm.instanceUrl || !createForm.username || !createForm.password) {
      createError = 'Name, instance URL, username, and password are required.';
      return;
    }

    const payload: SavedConnectionInput = {
      name: createForm.name.trim(),
      instanceUrl: createForm.instanceUrl.trim(),
      username: createForm.username.trim(),
      password: createForm.password,
    };

    createSaving = true;
    try {
      await createSavedConnection(payload);
      success = 'Connection saved.';
      closeCreateModal();
      await loadConnections();
    } catch (err: any) {
      createError = err.response?.data?.error || err.message || 'Failed to save connection';
    } finally {
      createSaving = false;
    }
  }

  // Edit modal functions
  function startEdit(conn: SavedConnection) {
    editingConnection = conn;
    editingForm = {
      name: conn.name,
      instanceUrl: conn.instanceUrl,
      username: conn.username,
      password: conn.password,
    };
    editingTest = { loading: false, result: null };
    editingError = null;
    error = null;
    success = null;
  }

  function closeEdit() {
    editingConnection = null;
    editingForm = { name: '', instanceUrl: '', username: '', password: '' };
    editingTest = { loading: false, result: null };
    editingError = null;
  }

  function markEditDirty() {
    editingTest = { loading: false, result: null };
    editingError = null;
  }

  async function handleEditTest(event?: Event) {
    event?.preventDefault();
    editingError = null;
    if (!editingForm.instanceUrl || !editingForm.username || !editingForm.password) {
      editingError = 'Instance URL, username, and password are required to test.';
      return;
    }
    editingTest = { loading: true, result: null };
    try {
      const result = await testConnection({
        url: editingForm.instanceUrl.trim(),
        username: editingForm.username.trim(),
        password: editingForm.password,
      });
      editingTest = {
        loading: false,
        result: { success: result.success, message: result.message },
      };
      if (!result.success) {
        editingError = result.message || 'Connection test failed.';
      }
    } catch (err: any) {
      editingTest = {
        loading: false,
        result: {
          success: false,
          message: err.response?.data?.error || err.message || 'Connection failed',
        },
      };
      editingError = editingTest.result.message;
    }
  }

  async function handleUpdate(event?: Event) {
    event?.preventDefault();
    if (!editingConnection) return;

    editingError = null;

    if (!editingForm.name || !editingForm.instanceUrl || !editingForm.username || !editingForm.password) {
      editingError = 'Name, instance URL, username, and password are required.';
      return;
    }

    const payload: SavedConnectionInput = {
      name: editingForm.name.trim(),
      instanceUrl: editingForm.instanceUrl.trim(),
      username: editingForm.username.trim(),
      password: editingForm.password,
    };

    editingSaving = true;
    try {
      await updateSavedConnection(editingConnection.id, payload);
      success = 'Connection updated.';
      closeEdit();
      await loadConnections();
    } catch (err: any) {
      editingError = err.response?.data?.error || err.message || 'Failed to update connection';
    } finally {
      editingSaving = false;
    }
  }

  async function handleDelete(id: string) {
    const target = savedConnections.find((c) => c.id === id);
    if (!target) return;
    const confirmed = window.confirm(`Delete saved connection "${target.name}"?`);
    if (!confirmed) return;

    try {
      await deleteSavedConnection(id);
      success = 'Connection deleted.';
      await loadConnections();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to delete connection';
    }
  }

  async function handleTest(conn: SavedConnection) {
    testState[conn.id] = { loading: true };
    try {
      const result = await testConnection({
        url: conn.instanceUrl,
        username: conn.username,
        password: conn.password,
      });
      testState[conn.id] = {
        loading: false,
        result: {
          success: result.success,
          message: result.message,
        },
      };
    } catch (err: any) {
      testState[conn.id] = {
        loading: false,
        result: {
          success: false,
          message: err.response?.data?.error || err.message || 'Connection failed',
        },
      };
    }
  }
</script>

<div>
  <div class="card">
    <div class="card-header flex justify-between items-center">
      <div>
        <h2 class="card-title">Connections</h2>
        <p class="text-sm text-gray">Manage your Dispatcharr instance connections.</p>
      </div>
      <button class="btn btn-primary" on:click={openCreateModal}>
        Create Connection
      </button>
    </div>

    {#if error}
      <div class="alert alert-error mb-2">{error}</div>
    {/if}

    {#if success}
      <div class="alert alert-success mb-2">{success}</div>
    {/if}

    {#if loadingList}
      <p>Loading saved connections...</p>
    {:else if savedConnections.length === 0}
      <div class="empty-state">
        <p class="text-gray">No saved connections yet.</p>
        <p class="text-sm text-gray">Click "Create Connection" to add your first Dispatcharr instance.</p>
      </div>
    {:else}
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Instance</th>
              <th>Username</th>
              <th>Updated</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each savedConnections as conn}
              <tr>
                <td>{conn.name}</td>
                <td>{conn.instanceUrl}</td>
                <td>{conn.username}</td>
                <td class="text-sm">{new Date(conn.updatedAt).toLocaleString()}</td>
                <td class="actions">
                  <button
                    class="btn btn-secondary btn-sm"
                    on:click={() => handleTest(conn)}
                    disabled={testState[conn.id]?.loading}
                  >
                    {#if testState[conn.id]?.loading}
                      <span class="spinner"></span>
                      Testing...
                    {:else}
                      Test
                    {/if}
                  </button>
                  <button
                    class="btn btn-primary btn-sm"
                    on:click={() => startEdit(conn)}
                  >
                    Edit
                  </button>
                  <button
                    class="btn btn-danger btn-sm"
                    on:click={() => handleDelete(conn.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
              {#if testState[conn.id]?.result}
                <tr>
                  <td colspan="5">
                    <div
                      class:alert-success={testState[conn.id]?.result?.success}
                      class:alert-error={!testState[conn.id]?.result?.success}
                      class="alert"
                    >
                      {testState[conn.id]?.result?.message}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- App Settings Card -->
  <div class="card mt-4">
    <div class="card-header">
      <h2 class="card-title">App Settings</h2>
      <p class="text-sm text-gray">Configure application-wide settings.</p>
    </div>

    {#if settingsSuccess}
      <div class="alert alert-success mb-2">{settingsSuccess}</div>
    {/if}

    {#if settingsError}
      <div class="alert alert-error mb-2">{settingsError}</div>
    {/if}

    <div class="settings-section">
      <div class="setting-row">
        <div class="setting-info">
          <label class="form-label" for="timezone-select">Timezone</label>
          <p class="text-sm text-gray">All scheduled jobs will run based on this timezone.</p>
        </div>
        <div class="setting-control">
          <select
            id="timezone-select"
            class="form-input"
            bind:value={selectedTimezone}
            disabled={savingSettings}
          >
            {#each availableTimezones as tz}
              <option value={tz}>{tz}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="setting-row mt-3">
        <div class="setting-info">
          <label class="form-label" for="time-format-select">Time Format</label>
          <p class="text-sm text-gray">Display times in 12-hour (AM/PM) or 24-hour format.</p>
        </div>
        <div class="setting-control">
          <div class="toggle-buttons-inline">
            <button
              type="button"
              class="toggle-btn {selectedTimeFormat === '12h' ? 'selected' : ''}"
              on:click={() => selectedTimeFormat = '12h'}
              disabled={savingSettings}
            >
              12-hour
            </button>
            <button
              type="button"
              class="toggle-btn {selectedTimeFormat === '24h' ? 'selected' : ''}"
              on:click={() => selectedTimeFormat = '24h'}
              disabled={savingSettings}
            >
              24-hour
            </button>
          </div>
        </div>
      </div>

      <div class="setting-row mt-3">
        <div class="setting-info">
          <label class="form-label">Theme</label>
          <p class="text-sm text-gray">Choose light, dark, or auto (follows system preference).</p>
        </div>
        <div class="setting-control">
          <div class="toggle-buttons-inline">
            <button
              type="button"
              class="toggle-btn {selectedTheme === 'light' ? 'selected' : ''}"
              on:click={() => selectedTheme = 'light'}
              disabled={savingSettings}
            >
              Light
            </button>
            <button
              type="button"
              class="toggle-btn {selectedTheme === 'dark' ? 'selected' : ''}"
              on:click={() => selectedTheme = 'dark'}
              disabled={savingSettings}
            >
              Dark
            </button>
            <button
              type="button"
              class="toggle-btn {selectedTheme === 'auto' ? 'selected' : ''}"
              on:click={() => selectedTheme = 'auto'}
              disabled={savingSettings}
            >
              Auto
            </button>
          </div>
        </div>
      </div>

      <div class="setting-row mt-3">
        <div></div>
        <div class="setting-control">
          <button
            class="btn btn-primary"
            on:click={handleSaveSettings}
            disabled={savingSettings || (selectedTimezone === appSettings?.timezone && selectedTimeFormat === appSettings?.timeFormat && selectedTheme === appSettings?.theme)}
          >
            {#if savingSettings}
              <span class="spinner"></span>
              Saving...
            {:else}
              Save Settings
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Create Connection Modal -->
  {#if showCreateModal}
    <div class="overlay" role="presentation">
      <button class="sr-only" on:click={closeCreateModal}>Close create dialog</button>
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3>Create Connection</h3>
            <p class="text-sm text-gray">Add a new Dispatcharr instance connection. You must test the connection successfully before saving.</p>
          </div>
          <button class="close-btn" type="button" on:click={closeCreateModal} aria-label="Close">
            &times;
          </button>
        </div>

        <form on:submit|preventDefault={handleCreate}>
          <div class="grid grid-2 gap-3">
            <div class="form-group">
              <label class="form-label" for="create-name">Name</label>
              <input
                id="create-name"
                class="form-input"
                placeholder="Friendly label (e.g., Production)"
                bind:value={createForm.name}
                on:input={markCreateDirty}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="create-instance-url">Instance URL</label>
              <input
                id="create-instance-url"
                class="form-input"
                placeholder="http://localhost:9191"
                bind:value={createForm.instanceUrl}
                on:input={markCreateDirty}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="create-username">Username</label>
              <input
                id="create-username"
                class="form-input"
                placeholder="admin"
                bind:value={createForm.username}
                on:input={markCreateDirty}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="create-password">Password</label>
              <input
                id="create-password"
                type="password"
                class="form-input"
                placeholder="Password"
                bind:value={createForm.password}
                on:input={markCreateDirty}
              />
            </div>
          </div>

          {#if createTest.result}
            <div
              class="alert mt-3"
              class:alert-success={createTest.result?.success}
              class:alert-error={!createTest.result?.success}
            >
              {createTest.result.message}
            </div>
          {/if}

          {#if createError && !createTest.result}
            <div class="alert alert-error mt-3">{createError}</div>
          {/if}

          <div class="modal-footer">
            <button
              class="btn btn-secondary"
              type="button"
              on:click={handleCreateTest}
              disabled={createTest.loading}
            >
              {#if createTest.loading}
                <span class="spinner"></span>
                Testing...
              {:else}
                Test Connection
              {/if}
            </button>
            <div class="flex gap-2">
              <button class="btn btn-secondary" type="button" on:click={closeCreateModal}>Cancel</button>
              <button class="btn btn-primary" type="submit" disabled={createSaving || !createTest.result?.success}>
                {#if createSaving}
                  <span class="spinner"></span>
                  Saving...
                {:else}
                  Save Connection
                {/if}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Edit Connection Modal -->
  {#if editingConnection}
    <div class="overlay" role="presentation">
      <button class="sr-only" on:click={closeEdit}>Close edit dialog</button>
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3>Edit Connection</h3>
            <p class="text-sm text-gray">Update settings for {editingConnection.name}</p>
          </div>
          <button class="close-btn" type="button" on:click={closeEdit} aria-label="Close">
            &times;
          </button>
        </div>

        <form on:submit|preventDefault={handleUpdate}>
          <div class="grid grid-2 gap-3">
            <div class="form-group">
              <label class="form-label" for="edit-name">Name</label>
              <input
                id="edit-name"
                class="form-input"
                placeholder="Friendly label"
                bind:value={editingForm.name}
                on:input={markEditDirty}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="edit-instance-url">Instance URL</label>
              <input
                id="edit-instance-url"
                class="form-input"
                placeholder="http://localhost:9191"
                bind:value={editingForm.instanceUrl}
                on:input={markEditDirty}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="edit-username">Username</label>
              <input
                id="edit-username"
                class="form-input"
                placeholder="admin"
                bind:value={editingForm.username}
                on:input={markEditDirty}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="edit-password">Password</label>
              <input
                id="edit-password"
                type="password"
                class="form-input"
                placeholder="Password"
                bind:value={editingForm.password}
                on:input={markEditDirty}
              />
            </div>
          </div>

          {#if editingTest.result}
            <div
              class="alert mt-3"
              class:alert-success={editingTest.result?.success}
              class:alert-error={!editingTest.result?.success}
            >
              {editingTest.result.message}
            </div>
          {/if}

          {#if editingError && !editingTest.result}
            <div class="alert alert-error mt-3">{editingError}</div>
          {/if}

          <div class="modal-footer">
            <button
              class="btn btn-secondary"
              type="button"
              on:click={handleEditTest}
              disabled={editingTest.loading}
            >
              {#if editingTest.loading}
                <span class="spinner"></span>
                Testing...
              {:else}
                Test Connection
              {/if}
            </button>
            <div class="flex gap-2">
              <button class="btn btn-secondary" type="button" on:click={closeEdit}>Cancel</button>
              <button class="btn btn-primary" type="submit" disabled={editingSaving}>
                {#if editingSaving}
                  <span class="spinner"></span>
                  Saving...
                {:else}
                  Save Changes
                {/if}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  {/if}
</div>

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
    border-bottom: 1px solid var(--border-color);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .empty-state {
    text-align: center;
    padding: 2rem 1rem;
  }

  .overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 1000;
  }

  .modal {
    width: min(720px, 100%);
    background: var(--bg-card);
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
  }

  .modal-header h3 {
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--gray-500);
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .modal .spinner {
    width: 1.125rem;
    height: 1.125rem;
    border-width: 2px;
  }

  .mt-4 {
    margin-top: 1.5rem;
  }

  .settings-section {
    padding: 0.5rem 0;
  }

  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .setting-info {
    flex: 1;
    min-width: 200px;
  }

  .setting-info .form-label {
    margin-bottom: 0.25rem;
  }

  .setting-info p {
    margin: 0;
  }

  .setting-control {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .setting-control select {
    min-width: 200px;
  }

  .mt-3 {
    margin-top: 1rem;
  }

  .toggle-buttons-inline {
    display: flex;
    gap: 0.5rem;
  }

  .toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem 1rem;
    border: 2px solid var(--border-color-strong);
    border-radius: 0.5rem;
    background: var(--bg-card);
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .toggle-btn:hover:not(:disabled) {
    border-color: var(--gray-400);
    background: var(--bg-hover);
  }

  .toggle-btn.selected {
    border-color: var(--primary);
    background: var(--bg-selected);
    color: var(--primary);
  }

  .toggle-btn.selected:hover:not(:disabled) {
    border-color: var(--primary-dark);
    background: var(--bg-info-hover);
  }

  .toggle-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
