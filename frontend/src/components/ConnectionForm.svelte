<script lang="ts">
  import { testConnection } from '../api';
  import type { DispatcharrConnection } from '../types';

  export let connection: DispatcharrConnection = {
    url: '',
    username: '',
    password: ''
  };
  export let label: string = 'Dispatcharr Instance';
  export let testable: boolean = true;

  let testing = false;
  let testResult: { success: boolean; message: string } | null = null;

  async function handleTest() {
    testing = true;
    testResult = null;

    try {
      const result = await testConnection(connection);
      testResult = {
        success: result.success,
        message: result.message + (result.version ? ` (v${result.version})` : '')
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
</script>

<div class="connection-form">
  <h3 class="mb-2">{label}</h3>

  <div class="form-group">
    <label class="form-label" for="{label}-url">URL</label>
    <input
      id="{label}-url"
      type="text"
      class="form-input"
      placeholder="http://localhost:8000"
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
</div>

<style>
  .connection-form {
    padding: 1rem;
    background: var(--gray-50);
    border-radius: 0.5rem;
  }
</style>
