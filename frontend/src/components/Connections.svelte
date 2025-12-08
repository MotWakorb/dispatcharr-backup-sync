<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listSavedConnections,
    createSavedConnection,
    deleteSavedConnection,
    testConnection,
    updateSavedConnection,
  } from '../api';
  import type { SavedConnection, SavedConnectionInput } from '../types';

  let savedConnections: SavedConnection[] = [];
  let loadingList = false;
  let saving = false;
  let error: string | null = null;
  let success: string | null = null;
  let form: SavedConnectionInput = {
    name: '',
    instanceUrl: '',
    username: '',
    password: '',
  };
  let testState: Record<
    string,
    { loading: boolean; result?: { success: boolean; message: string } }
  > = {};
  let creatingTest = { loading: false, result: null as null | { success: boolean; message: string } };
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

  const formIds = {
    name: 'conn-name',
    instanceUrl: 'conn-instance-url',
    username: 'conn-username',
    password: 'conn-password',
  };

  onMount(loadConnections);

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

  async function handleSave(event?: Event) {
    event?.preventDefault();
    error = null;
    success = null;
    if (!creatingTest.result?.success) {
      error = 'Please test the connection and ensure it succeeds before saving.';
      return;
    }

    if (!form.name || !form.instanceUrl || !form.username || !form.password) {
      error = 'Name, instance URL, username, and password are required.';
      return;
    }

    const payload: SavedConnectionInput = {
      name: form.name.trim(),
      instanceUrl: form.instanceUrl.trim(),
      username: form.username.trim(),
      password: form.password,
    };

    saving = true;
    try {
      await createSavedConnection(payload);
      success = 'Connection saved.';
      form = { name: '', instanceUrl: '', username: '', password: '' };
      creatingTest = { loading: false, result: null };
      await loadConnections();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to save connection';
    } finally {
      saving = false;
    }
  }

  function markDirty() {
    creatingTest = { loading: false, result: null };
    success = null;
  }

  async function handleCreateTest(event?: Event) {
    event?.preventDefault();
    error = null;
    success = null;
    if (!form.instanceUrl || !form.username || !form.password) {
      error = 'Instance URL, username, and password are required to test.';
      return;
    }
    creatingTest = { loading: true, result: null };
    try {
      const result = await testConnection({
        url: form.instanceUrl.trim(),
        username: form.username.trim(),
        password: form.password,
      });
      creatingTest = {
        loading: false,
        result: { success: result.success, message: result.message },
      };
      if (!result.success) {
        error = result.message || 'Connection test failed.';
      }
    } catch (err: any) {
      creatingTest = {
        loading: false,
        result: {
          success: false,
          message: err.response?.data?.error || err.message || 'Connection failed',
        },
      };
      error = creatingTest.result.message;
    }
  }

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
    success = null;
  }

  async function handleEditTest(event?: Event) {
    event?.preventDefault();
    editingError = null;
    error = null;
    success = null;
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
    error = null;
    success = null;

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
  <div class="card export-card">
    <div class="card-header">
      <h2 class="card-title">Saved Connections</h2>
      <p class="text-sm text-gray">Create and manage Dispatcharr accounts for quick selection.</p>
    </div>

    <form on:submit|preventDefault={handleSave}>
      <div class="grid grid-2 gap-3">
        <div class="form-group">
          <label class="form-label" for={formIds.name}>Name</label>
          <input
            id={formIds.name}
            class="form-input"
            placeholder="Friendly label"
            bind:value={form.name}
            on:input={markDirty}
          />
        </div>

        <div class="form-group">
          <label class="form-label" for={formIds.instanceUrl}>Instance URL</label>
          <input
            id={formIds.instanceUrl}
            class="form-input"
            placeholder="http://localhost:9191"
            bind:value={form.instanceUrl}
            on:input={markDirty}
          />
        </div>

        <div class="form-group">
          <label class="form-label" for={formIds.username}>Username</label>
          <input
            id={formIds.username}
            class="form-input"
            placeholder="admin"
            bind:value={form.username}
            on:input={markDirty}
          />
        </div>

        <div class="form-group">
          <label class="form-label" for={formIds.password}>Password</label>
          <input
            id={formIds.password}
            type="password"
            class="form-input"
            placeholder="Password"
            bind:value={form.password}
            on:input={markDirty}
          />
        </div>
      </div>

      <div class="actions-row">
        <button class="btn btn-secondary" type="button" on:click={handleCreateTest} disabled={creatingTest.loading}>
          {#if creatingTest.loading}
            <span class="spinner"></span>
            Testing...
          {:else}
            Test Connection
          {/if}
        </button>
        <button class="btn btn-primary" type="submit" disabled={saving || !creatingTest.result?.success}>
          {#if saving}
            <span class="spinner"></span>
            Saving...
          {:else}
            Save Connection
          {/if}
        </button>
      </div>
    </form>

    {#if creatingTest.result}
      <div
        class="alert mt-2"
        class:alert-success={creatingTest.result?.success}
        class:alert-error={!creatingTest.result?.success}
      >
        {creatingTest.result.message}
      </div>
    {/if}

    {#if error}
      <div class="alert alert-error mt-2">{error}</div>
    {/if}

    {#if success}
      <div class="alert alert-success mt-2">{success}</div>
    {/if}
  </div>

  <div class="card export-card">
    <div class="card-header">
      <h3 class="card-title">Existing Accounts</h3>
      <p class="text-sm text-gray">Select, test, or delete saved accounts.</p>
    </div>

    {#if loadingList}
      <p>Loading saved connections...</p>
    {:else if savedConnections.length === 0}
      <p class="text-gray">No saved connections yet.</p>
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

  {#if editingConnection}
    <div class="overlay" role="presentation">
      <button class="sr-only" on:click={closeEdit}>Close edit dialog</button>
      <div class="edit-modal" role="dialog" aria-modal="true">
        <div class="flex justify-between items-center mb-2">
          <div>
            <h3>Edit Connection</h3>
            <p class="text-sm text-gray">Update settings for {editingConnection.name}</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" on:click={closeEdit}>Close</button>
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

          <div class="actions-row modal-actions">
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              on:click={handleEditTest}
              disabled={editingTest.loading}
            >
              {#if editingTest.loading}
                <span class="spinner"></span>
                Testing...
              {:else}
                Test changes
              {/if}
            </button>
            <div class="flex gap-2">
              <button class="btn btn-secondary btn-sm" type="button" on:click={closeEdit}>Cancel</button>
              <button class="btn btn-primary btn-sm" type="submit" disabled={editingSaving}>
                {#if editingSaving}
                  <span class="spinner"></span>
                  Saving...
                {:else}
                  Save changes
                {/if}
              </button>
            </div>
          </div>
        </form>

        {#if editingTest.result}
          <div
            class="alert mt-2"
            class:alert-success={editingTest.result?.success}
            class:alert-error={!editingTest.result?.success}
          >
            {editingTest.result.message}
          </div>
        {/if}

        {#if editingError}
          <div class="alert alert-error mt-2">{editingError}</div>
        {/if}
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

  .actions-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .modal-actions {
    justify-content: space-between;
    flex-wrap: wrap;
  }

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
    border-bottom: 1px solid var(--gray-200);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 1000;
  }

  .edit-modal {
    width: min(720px, 100%);
    background: #fff;
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .edit-modal .spinner {
    width: 1.125rem;
    height: 1.125rem;
    border-width: 2px;
  }
</style>
