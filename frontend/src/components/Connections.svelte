<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listSavedConnections,
    createSavedConnection,
    deleteSavedConnection,
    testConnection,
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
      await loadConnections();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to save connection';
    } finally {
      saving = false;
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
          />
        </div>

        <div class="form-group">
          <label class="form-label" for={formIds.instanceUrl}>Instance URL</label>
          <input
            id={formIds.instanceUrl}
            class="form-input"
            placeholder="http://localhost:9191"
            bind:value={form.instanceUrl}
          />
        </div>

        <div class="form-group">
          <label class="form-label" for={formIds.username}>Username</label>
          <input
            id={formIds.username}
            class="form-input"
            placeholder="admin"
            bind:value={form.username}
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
          />
        </div>
      </div>

      <div class="actions-row">
        <button class="btn btn-primary" type="submit" disabled={saving}>
          {#if saving}
            <span class="spinner"></span>
            Saving...
          {:else}
            Save Connection
          {/if}
        </button>
      </div>
    </form>

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
</style>
