<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listNotificationProviders,
    createNotificationProvider,
    updateNotificationProvider,
    deleteNotificationProvider,
    testNotificationProvider,
    testNotificationProviderConfig,
    getNotificationSettings,
    updateNotificationSettings,
  } from '../api';
  import type {
    NotificationProvider,
    NotificationProviderInput,
    NotificationProviderType,
    NotificationGlobalSettings,
    SmtpConfig,
    TelegramConfig,
    DiscordConfig,
    SlackConfig,
  } from '../types';

  let providers: NotificationProvider[] = [];
  let globalSettings: NotificationGlobalSettings | null = null;
  let loadingList = false;
  let error: string | null = null;
  let success: string | null = null;

  // Create modal state
  let showCreateModal = false;
  let createForm: NotificationProviderInput = getEmptyForm();
  let createSaving = false;
  let createError: string | null = null;
  let createTest = { loading: false, result: null as null | { success: boolean; message: string } };

  // Edit modal state
  let editingProvider: NotificationProvider | null = null;
  let editForm: NotificationProviderInput = getEmptyForm();
  let editSaving = false;
  let editError: string | null = null;
  let editTest = { loading: false, result: null as null | { success: boolean; message: string } };

  // Test state for table rows
  let testState: Record<string, { loading: boolean; result?: { success: boolean; message: string } }> = {};

  // Settings state
  let savingSettings = false;
  let settingsSuccess: string | null = null;
  let settingsError: string | null = null;

  function getEmptyForm(): NotificationProviderInput {
    return {
      name: '',
      type: 'discord',
      enabled: true,
      config: { webhookUrl: '' } as DiscordConfig,
    };
  }

  function getEmptyConfigForType(type: NotificationProviderType): any {
    switch (type) {
      case 'smtp':
        return { host: '', port: 25, secure: false, username: '', password: '', fromAddress: '', toAddress: '' };
      case 'telegram':
        return { botToken: '', chatId: '' };
      case 'discord':
        return { webhookUrl: '' };
      case 'slack':
        return { webhookUrl: '' };
    }
  }

  const providerTypeLabels: Record<NotificationProviderType, string> = {
    smtp: 'Email (SMTP)',
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
  };

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    loadingList = true;
    error = null;
    try {
      [providers, globalSettings] = await Promise.all([
        listNotificationProviders(),
        getNotificationSettings(),
      ]);
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to load notification settings';
    } finally {
      loadingList = false;
    }
  }

  // Create modal functions
  function openCreateModal() {
    showCreateModal = true;
    createForm = getEmptyForm();
    createError = null;
    createTest = { loading: false, result: null };
    error = null;
    success = null;
  }

  function closeCreateModal() {
    showCreateModal = false;
    createForm = getEmptyForm();
    createError = null;
    createTest = { loading: false, result: null };
  }

  function handleTypeChange(form: NotificationProviderInput, newType: NotificationProviderType) {
    form.type = newType;
    form.config = getEmptyConfigForType(newType);
    // Reset test state when type changes
    createTest = { loading: false, result: null };
    editTest = { loading: false, result: null };
    return form;
  }

  async function handleCreateTest() {
    createError = null;
    createTest = { loading: true, result: null };
    try {
      const result = await testNotificationProviderConfig(createForm);
      createTest = { loading: false, result };
      if (!result.success) {
        createError = result.message;
      }
    } catch (err: any) {
      createTest = { loading: false, result: { success: false, message: err.response?.data?.error || err.message || 'Test failed' } };
      createError = createTest.result.message;
    }
  }

  async function handleCreate(event?: Event) {
    event?.preventDefault();
    createError = null;

    if (!createForm.name.trim()) {
      createError = 'Name is required.';
      return;
    }

    createSaving = true;
    try {
      await createNotificationProvider(createForm);
      success = 'Notification provider created.';
      closeCreateModal();
      await loadData();
    } catch (err: any) {
      createError = err.response?.data?.error || err.message || 'Failed to create provider';
    } finally {
      createSaving = false;
    }
  }

  // Edit modal functions
  function startEdit(provider: NotificationProvider) {
    editingProvider = provider;
    editForm = {
      name: provider.name,
      type: provider.type,
      enabled: provider.enabled,
      config: { ...provider.config },
    };
    editError = null;
    editTest = { loading: false, result: null };
    error = null;
    success = null;
  }

  function closeEdit() {
    editingProvider = null;
    editForm = getEmptyForm();
    editError = null;
    editTest = { loading: false, result: null };
  }

  async function handleEditTest() {
    editError = null;
    editTest = { loading: true, result: null };
    try {
      const result = await testNotificationProviderConfig(editForm);
      editTest = { loading: false, result };
      if (!result.success) {
        editError = result.message;
      }
    } catch (err: any) {
      editTest = { loading: false, result: { success: false, message: err.response?.data?.error || err.message || 'Test failed' } };
      editError = editTest.result.message;
    }
  }

  async function handleUpdate(event?: Event) {
    event?.preventDefault();
    if (!editingProvider) return;

    editError = null;

    if (!editForm.name.trim()) {
      editError = 'Name is required.';
      return;
    }

    editSaving = true;
    try {
      await updateNotificationProvider(editingProvider.id, editForm);
      success = 'Notification provider updated.';
      closeEdit();
      await loadData();
    } catch (err: any) {
      editError = err.response?.data?.error || err.message || 'Failed to update provider';
    } finally {
      editSaving = false;
    }
  }

  async function handleDelete(id: string) {
    const target = providers.find((p) => p.id === id);
    if (!target) return;
    const confirmed = window.confirm(`Delete notification provider "${target.name}"?`);
    if (!confirmed) return;

    try {
      await deleteNotificationProvider(id);
      success = 'Notification provider deleted.';
      await loadData();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to delete provider';
    }
  }

  async function handleTest(provider: NotificationProvider) {
    testState[provider.id] = { loading: true };
    testState = testState;
    try {
      const result = await testNotificationProvider(provider.id);
      testState[provider.id] = { loading: false, result };
    } catch (err: any) {
      testState[provider.id] = {
        loading: false,
        result: {
          success: false,
          message: err.response?.data?.error || err.message || 'Test failed',
        },
      };
    }
    testState = testState;
  }

  async function handleSaveSettings() {
    if (!globalSettings) return;

    savingSettings = true;
    settingsError = null;
    settingsSuccess = null;
    try {
      globalSettings = await updateNotificationSettings(globalSettings);
      settingsSuccess = 'Notification settings saved.';
    } catch (err: any) {
      settingsError = err.response?.data?.error || err.message || 'Failed to save settings';
    } finally {
      savingSettings = false;
    }
  }
</script>

<div>
  <!-- Notification Providers Card -->
  <div class="card">
    <div class="card-header flex justify-between items-center">
      <div>
        <h2 class="card-title">Notification Providers</h2>
        <p class="text-sm text-gray">Configure how you receive notifications for scheduled jobs.</p>
      </div>
      <button class="btn btn-primary" on:click={openCreateModal}>
        Add Provider
      </button>
    </div>

    {#if error}
      <div class="alert alert-error mb-2">{error}</div>
    {/if}

    {#if success}
      <div class="alert alert-success mb-2">{success}</div>
    {/if}

    {#if loadingList}
      <p>Loading notification providers...</p>
    {:else if providers.length === 0}
      <div class="empty-state">
        <p class="text-gray">No notification providers configured.</p>
        <p class="text-sm text-gray">Add a provider to receive notifications when scheduled jobs complete or fail.</p>
      </div>
    {:else}
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each providers as provider}
              <tr>
                <td>{provider.name}</td>
                <td>{providerTypeLabels[provider.type]}</td>
                <td>
                  <span class="status-badge {provider.enabled ? 'status-active' : 'status-inactive'}">
                    {provider.enabled ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td class="actions">
                  <button
                    class="btn btn-secondary btn-sm"
                    on:click={() => handleTest(provider)}
                    disabled={testState[provider.id]?.loading}
                  >
                    {#if testState[provider.id]?.loading}
                      <span class="spinner"></span>
                      Testing...
                    {:else}
                      Test
                    {/if}
                  </button>
                  <button class="btn btn-primary btn-sm" on:click={() => startEdit(provider)}>
                    Edit
                  </button>
                  <button class="btn btn-danger btn-sm" on:click={() => handleDelete(provider.id)}>
                    Delete
                  </button>
                </td>
              </tr>
              {#if testState[provider.id]?.result}
                <tr>
                  <td colspan="4">
                    <div
                      class="alert"
                      class:alert-success={testState[provider.id]?.result?.success}
                      class:alert-error={!testState[provider.id]?.result?.success}
                    >
                      {testState[provider.id]?.result?.message}
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

  <!-- Global Notification Settings Card -->
  <div class="card mt-4">
    <div class="card-header">
      <h2 class="card-title">Notification Settings</h2>
      <p class="text-sm text-gray">Choose when to receive notifications for scheduled jobs.</p>
    </div>

    {#if settingsSuccess}
      <div class="alert alert-success mb-2">{settingsSuccess}</div>
    {/if}

    {#if settingsError}
      <div class="alert alert-error mb-2">{settingsError}</div>
    {/if}

    {#if globalSettings}
      <div class="settings-section">
        <div class="checkbox-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={globalSettings.notifyOnStart} />
            <span>Notify when job starts</span>
          </label>
        </div>
        <div class="checkbox-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={globalSettings.notifyOnComplete} />
            <span>Notify when job completes successfully</span>
          </label>
        </div>
        <div class="checkbox-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={globalSettings.notifyOnFailure} />
            <span>Notify when job fails</span>
          </label>
        </div>
        <div class="checkbox-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={globalSettings.includeLogsInEmail} />
            <span>Include job log in email notifications</span>
          </label>
        </div>

        <div class="mt-3">
          <button
            class="btn btn-primary"
            on:click={handleSaveSettings}
            disabled={savingSettings}
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
    {:else}
      <p>Loading settings...</p>
    {/if}
  </div>

  <!-- Create Provider Modal -->
  {#if showCreateModal}
    <div class="overlay" role="presentation">
      <button class="sr-only" on:click={closeCreateModal}>Close create dialog</button>
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3>Add Notification Provider</h3>
            <p class="text-sm text-gray">Configure a new notification provider.</p>
          </div>
          <button class="close-btn" type="button" on:click={closeCreateModal} aria-label="Close">
            &times;
          </button>
        </div>

        <form on:submit|preventDefault={handleCreate}>
          <div class="form-group">
            <label class="form-label" for="create-name">Name</label>
            <input
              id="create-name"
              class="form-input"
              placeholder="e.g., My Discord"
              bind:value={createForm.name}
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="create-type">Provider Type</label>
            <select
              id="create-type"
              class="form-input"
              bind:value={createForm.type}
              on:change={() => createForm = handleTypeChange(createForm, createForm.type)}
            >
              <option value="discord">Discord</option>
              <option value="slack">Slack</option>
              <option value="telegram">Telegram</option>
              <option value="smtp">Email (SMTP)</option>
            </select>
          </div>

          <!-- Dynamic config fields based on type -->
          {#if createForm.type === 'discord'}
            <div class="form-group">
              <label class="form-label" for="create-discord-url">Webhook URL</label>
              <input
                id="create-discord-url"
                class="form-input"
                placeholder="https://discord.com/api/webhooks/..."
                bind:value={(createForm.config as DiscordConfig).webhookUrl}
              />
              <p class="text-sm text-gray mt-1">Get this from Discord channel settings > Integrations > Webhooks</p>
            </div>
          {:else if createForm.type === 'slack'}
            <div class="form-group">
              <label class="form-label" for="create-slack-url">Webhook URL</label>
              <input
                id="create-slack-url"
                class="form-input"
                placeholder="https://hooks.slack.com/services/..."
                bind:value={(createForm.config as SlackConfig).webhookUrl}
              />
              <p class="text-sm text-gray mt-1">Create an incoming webhook in your Slack workspace</p>
            </div>
          {:else if createForm.type === 'telegram'}
            <div class="grid grid-2 gap-3">
              <div class="form-group">
                <label class="form-label" for="create-telegram-token">Bot Token</label>
                <input
                  id="create-telegram-token"
                  class="form-input"
                  placeholder="123456:ABC-DEF..."
                  bind:value={(createForm.config as TelegramConfig).botToken}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="create-telegram-chat">Chat ID</label>
                <input
                  id="create-telegram-chat"
                  class="form-input"
                  placeholder="-1001234567890"
                  bind:value={(createForm.config as TelegramConfig).chatId}
                />
              </div>
            </div>
            <p class="text-sm text-gray">Create a bot via @BotFather and get your chat ID</p>
          {:else if createForm.type === 'smtp'}
            <div class="grid grid-2 gap-3">
              <div class="form-group">
                <label class="form-label" for="create-smtp-host">SMTP Host</label>
                <input
                  id="create-smtp-host"
                  class="form-input"
                  placeholder="smtp.gmail.com"
                  bind:value={(createForm.config as SmtpConfig).host}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="create-smtp-port">Port</label>
                <input
                  id="create-smtp-port"
                  type="number"
                  class="form-input"
                  placeholder="587"
                  bind:value={(createForm.config as SmtpConfig).port}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="create-smtp-user">Username</label>
                <input
                  id="create-smtp-user"
                  class="form-input"
                  placeholder="user@example.com"
                  bind:value={(createForm.config as SmtpConfig).username}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="create-smtp-pass">Password</label>
                <input
                  id="create-smtp-pass"
                  type="password"
                  class="form-input"
                  placeholder="App password"
                  bind:value={(createForm.config as SmtpConfig).password}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="create-smtp-from">From Address</label>
                <input
                  id="create-smtp-from"
                  class="form-input"
                  placeholder="alerts@example.com"
                  bind:value={(createForm.config as SmtpConfig).fromAddress}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="create-smtp-to">To Address</label>
                <input
                  id="create-smtp-to"
                  class="form-input"
                  placeholder="you@example.com"
                  bind:value={(createForm.config as SmtpConfig).toAddress}
                />
              </div>
            </div>
            <div class="checkbox-row mt-2">
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={(createForm.config as SmtpConfig).secure} />
                <span>Use SSL/TLS (port 465)</span>
              </label>
            </div>
          {/if}

          <div class="checkbox-row mt-3">
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={createForm.enabled} />
              <span>Enable this provider</span>
            </label>
          </div>

          {#if createTest.result}
            <div class="alert mt-3" class:alert-success={createTest.result.success} class:alert-error={!createTest.result.success}>
              {createTest.result.message}
            </div>
          {:else if createError}
            <div class="alert alert-error mt-3">{createError}</div>
          {/if}

          <div class="modal-footer">
            <button class="btn btn-secondary" type="button" on:click={closeCreateModal}>Cancel</button>
            <button
              class="btn btn-secondary"
              type="button"
              on:click={handleCreateTest}
              disabled={createTest.loading || createSaving}
            >
              {#if createTest.loading}
                <span class="spinner"></span>
                Testing...
              {:else}
                Send Test
              {/if}
            </button>
            <button class="btn btn-primary" type="submit" disabled={createSaving || createTest.loading}>
              {#if createSaving}
                <span class="spinner"></span>
                Saving...
              {:else}
                Add Provider
              {/if}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <!-- Edit Provider Modal -->
  {#if editingProvider}
    <div class="overlay" role="presentation">
      <button class="sr-only" on:click={closeEdit}>Close edit dialog</button>
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3>Edit Notification Provider</h3>
            <p class="text-sm text-gray">Update settings for {editingProvider.name}</p>
          </div>
          <button class="close-btn" type="button" on:click={closeEdit} aria-label="Close">
            &times;
          </button>
        </div>

        <form on:submit|preventDefault={handleUpdate}>
          <div class="form-group">
            <label class="form-label" for="edit-name">Name</label>
            <input
              id="edit-name"
              class="form-input"
              placeholder="e.g., My Discord"
              bind:value={editForm.name}
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="edit-type">Provider Type</label>
            <select
              id="edit-type"
              class="form-input"
              bind:value={editForm.type}
              on:change={() => editForm = handleTypeChange(editForm, editForm.type)}
            >
              <option value="discord">Discord</option>
              <option value="slack">Slack</option>
              <option value="telegram">Telegram</option>
              <option value="smtp">Email (SMTP)</option>
            </select>
          </div>

          <!-- Dynamic config fields based on type -->
          {#if editForm.type === 'discord'}
            <div class="form-group">
              <label class="form-label" for="edit-discord-url">Webhook URL</label>
              <input
                id="edit-discord-url"
                class="form-input"
                placeholder="https://discord.com/api/webhooks/..."
                bind:value={(editForm.config as DiscordConfig).webhookUrl}
              />
            </div>
          {:else if editForm.type === 'slack'}
            <div class="form-group">
              <label class="form-label" for="edit-slack-url">Webhook URL</label>
              <input
                id="edit-slack-url"
                class="form-input"
                placeholder="https://hooks.slack.com/services/..."
                bind:value={(editForm.config as SlackConfig).webhookUrl}
              />
            </div>
          {:else if editForm.type === 'telegram'}
            <div class="grid grid-2 gap-3">
              <div class="form-group">
                <label class="form-label" for="edit-telegram-token">Bot Token</label>
                <input
                  id="edit-telegram-token"
                  class="form-input"
                  placeholder="123456:ABC-DEF..."
                  bind:value={(editForm.config as TelegramConfig).botToken}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="edit-telegram-chat">Chat ID</label>
                <input
                  id="edit-telegram-chat"
                  class="form-input"
                  placeholder="-1001234567890"
                  bind:value={(editForm.config as TelegramConfig).chatId}
                />
              </div>
            </div>
          {:else if editForm.type === 'smtp'}
            <div class="grid grid-2 gap-3">
              <div class="form-group">
                <label class="form-label" for="edit-smtp-host">SMTP Host</label>
                <input
                  id="edit-smtp-host"
                  class="form-input"
                  placeholder="smtp.gmail.com"
                  bind:value={(editForm.config as SmtpConfig).host}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="edit-smtp-port">Port</label>
                <input
                  id="edit-smtp-port"
                  type="number"
                  class="form-input"
                  placeholder="587"
                  bind:value={(editForm.config as SmtpConfig).port}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="edit-smtp-user">Username</label>
                <input
                  id="edit-smtp-user"
                  class="form-input"
                  placeholder="user@example.com"
                  bind:value={(editForm.config as SmtpConfig).username}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="edit-smtp-pass">Password</label>
                <input
                  id="edit-smtp-pass"
                  type="password"
                  class="form-input"
                  placeholder="App password"
                  bind:value={(editForm.config as SmtpConfig).password}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="edit-smtp-from">From Address</label>
                <input
                  id="edit-smtp-from"
                  class="form-input"
                  placeholder="alerts@example.com"
                  bind:value={(editForm.config as SmtpConfig).fromAddress}
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="edit-smtp-to">To Address</label>
                <input
                  id="edit-smtp-to"
                  class="form-input"
                  placeholder="you@example.com"
                  bind:value={(editForm.config as SmtpConfig).toAddress}
                />
              </div>
            </div>
            <div class="checkbox-row mt-2">
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={(editForm.config as SmtpConfig).secure} />
                <span>Use SSL/TLS (port 465)</span>
              </label>
            </div>
          {/if}

          <div class="checkbox-row mt-3">
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={editForm.enabled} />
              <span>Enable this provider</span>
            </label>
          </div>

          {#if editTest.result}
            <div class="alert mt-3" class:alert-success={editTest.result.success} class:alert-error={!editTest.result.success}>
              {editTest.result.message}
            </div>
          {:else if editError}
            <div class="alert alert-error mt-3">{editError}</div>
          {/if}

          <div class="modal-footer">
            <button class="btn btn-secondary" type="button" on:click={closeEdit}>Cancel</button>
            <button
              class="btn btn-secondary"
              type="button"
              on:click={handleEditTest}
              disabled={editTest.loading || editSaving}
            >
              {#if editTest.loading}
                <span class="spinner"></span>
                Testing...
              {:else}
                Send Test
              {/if}
            </button>
            <button class="btn btn-primary" type="submit" disabled={editSaving || editTest.loading}>
              {#if editSaving}
                <span class="spinner"></span>
                Saving...
              {:else}
                Save Changes
              {/if}
            </button>
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
    border-bottom: 1px solid var(--gray-200);
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

  .status-badge {
    display: inline-block;
    padding: 0.25rem 0.625rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .status-active {
    background: #dcfce7;
    color: #166534;
  }

  .status-inactive {
    background: var(--gray-100);
    color: var(--gray-600);
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

  .modal {
    width: min(600px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    background: #fff;
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
    color: var(--gray-800);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .modal .spinner {
    width: 1.125rem;
    height: 1.125rem;
    border-width: 2px;
  }

  .mt-4 {
    margin-top: 1.5rem;
  }

  .mt-3 {
    margin-top: 1rem;
  }

  .mt-2 {
    margin-top: 0.5rem;
  }

  .mt-1 {
    margin-top: 0.25rem;
  }

  .settings-section {
    padding: 0.5rem 0;
  }

  .checkbox-row {
    padding: 0.5rem 0;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    width: 1.125rem;
    height: 1.125rem;
    cursor: pointer;
  }

  .grid {
    display: grid;
    gap: 1rem;
  }

  .grid-2 {
    grid-template-columns: repeat(2, 1fr);
  }

  .gap-3 {
    gap: 0.75rem;
  }

  @media (max-width: 600px) {
    .grid-2 {
      grid-template-columns: 1fr;
    }
  }
</style>
