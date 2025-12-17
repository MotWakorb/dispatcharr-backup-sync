<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Schedule, ScheduleInput, SavedConnection, SyncOptions, TimeFormat } from '../../types';
  import { MINUTES, DAYS_OF_WEEK, DAYS_OF_MONTH, buildCronExpression, parseCronExpression, hour24ToDisplayTime } from '../../lib/scheduleUtils';
  import TimePicker from '../TimePicker.svelte';
  import DayPicker from '../DayPicker.svelte';

  export let show: boolean = false;
  export let editingSchedule: Schedule | null = null;
  export let savedConnections: SavedConnection[] = [];
  export let timeFormat: TimeFormat = '12h';
  export let saving: boolean = false;

  const dispatch = createEventDispatcher<{
    close: void;
    save: ScheduleInput;
  }>();

  // Form data
  let formData: ScheduleInput = getDefaultFormData();
  let formError: string | null = null;
  let timeInputError: string | null = null;

  // Time picker state
  let customHour = 2;
  let customMinute = 0;
  let customDayOfWeek = 0;
  let customDayOfMonth = 1;
  let customSelectedDays: number[] = [1];

  const ALL_OPTIONS: { key: keyof SyncOptions; label: string }[] = [
    { key: 'syncChannelGroups', label: 'Channel Groups' },
    { key: 'syncChannelProfiles', label: 'Channel Profiles' },
    { key: 'syncChannels', label: 'Channels' },
    { key: 'syncM3USources', label: 'M3U Sources' },
    { key: 'syncStreamProfiles', label: 'Stream Profiles' },
    { key: 'syncUserAgents', label: 'User Agents' },
    { key: 'syncCoreSettings', label: 'Core Settings' },
    { key: 'syncEPGSources', label: 'EPG Sources' },
    { key: 'syncPlugins', label: 'Plugins' },
    { key: 'syncDVRRules', label: 'DVR Rules' },
    { key: 'syncComskipConfig', label: 'Comskip Config' },
    { key: 'syncUsers', label: 'Users' },
  ];

  function getDefaultFormData(): ScheduleInput {
    return {
      name: '',
      jobType: 'backup',
      sourceConnectionId: '',
      destinationConnectionId: undefined,
      options: {
        syncChannelGroups: true,
        syncChannelProfiles: true,
        syncChannels: true,
        syncM3USources: true,
        syncStreamProfiles: true,
        syncUserAgents: true,
        syncCoreSettings: true,
        syncEPGSources: true,
        syncPlugins: true,
        syncDVRRules: true,
        syncComskipConfig: true,
        syncUsers: true,
        syncLogos: true,
      },
      schedulePreset: 'daily',
      cronExpression: undefined,
      enabled: true,
      retentionCount: undefined,
    };
  }

  // Initialize form when modal opens or editingSchedule changes
  $: if (show) {
    initializeForm();
  }

  function initializeForm() {
    if (editingSchedule) {
      formData = {
        name: editingSchedule.name,
        jobType: editingSchedule.jobType,
        sourceConnectionId: editingSchedule.sourceConnectionId,
        destinationConnectionId: editingSchedule.destinationConnectionId,
        options: { ...editingSchedule.options },
        schedulePreset: editingSchedule.schedulePreset,
        cronExpression: editingSchedule.cronExpression,
        enabled: editingSchedule.enabled,
        retentionCount: editingSchedule.retentionCount,
      };
      // Parse existing cron expression
      const cronParts = parseCronExpression(editingSchedule.cronExpression);
      customMinute = cronParts.minute;
      customHour = cronParts.hour;
      customDayOfMonth = cronParts.dayOfMonth;
      customDayOfWeek = cronParts.dayOfWeek;
      customSelectedDays = cronParts.selectedDays;
    } else {
      formData = getDefaultFormData();
      customHour = 2;
      customMinute = 0;
      customDayOfWeek = 0;
      customDayOfMonth = 1;
      customSelectedDays = [1];
    }
    formError = null;
    timeInputError = null;
  }

  function handleClose() {
    dispatch('close');
  }

  function handlePresetChange() {
    formData.cronExpression = undefined;
  }

  function handleJobTypeChange() {
    if (formData.jobType === 'backup') {
      formData.destinationConnectionId = undefined;
    }
  }

  function handleTimeChange(event: CustomEvent<{ hour24: number; minute: number }>) {
    customHour = event.detail.hour24;
    customMinute = event.detail.minute;
    timeInputError = null;
  }

  function handleTimeError(event: CustomEvent<string | null>) {
    timeInputError = event.detail;
  }

  function handleDaysChange(event: CustomEvent<number[]>) {
    customSelectedDays = event.detail;
  }

  function toggleOption(key: keyof SyncOptions) {
    formData.options[key] = !formData.options[key];
    formData.options = formData.options; // Trigger reactivity
  }

  function toggleAllOptions() {
    const allSelected = Object.values(formData.options).every(Boolean);
    const newValue = !allSelected;
    formData.options = {
      syncChannelGroups: newValue,
      syncChannelProfiles: newValue,
      syncChannels: newValue,
      syncM3USources: newValue,
      syncStreamProfiles: newValue,
      syncUserAgents: newValue,
      syncCoreSettings: newValue,
      syncEPGSources: newValue,
      syncPlugins: newValue,
      syncDVRRules: newValue,
      syncComskipConfig: newValue,
      syncUsers: newValue,
    };
  }

  function handleSave() {
    formError = null;

    // Validation
    if (!formData.name.trim()) {
      formError = 'Name is required';
      return;
    }
    if (!formData.sourceConnectionId) {
      formError = 'Source connection is required';
      return;
    }
    if (formData.jobType === 'sync' && !formData.destinationConnectionId) {
      formError = 'Destination connection is required for sync jobs';
      return;
    }

    // Check for time input error (except for hourly which only uses minute)
    if (formData.schedulePreset !== 'hourly' && timeInputError) {
      formError = timeInputError;
      return;
    }

    // Validate custom schedule has at least one day selected
    if (formData.schedulePreset === 'custom' && customSelectedDays.length === 0) {
      formError = 'Please select at least one day';
      return;
    }

    // Build cron expression
    formData.cronExpression = buildCronExpression(
      formData.schedulePreset,
      customMinute,
      customHour,
      customDayOfWeek,
      customDayOfMonth,
      customSelectedDays
    );

    dispatch('save', formData);
  }

  $: allOptionsSelected = Object.values(formData.options).every(Boolean);
</script>

{#if show}
  <div class="overlay" role="presentation">
    <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="schedule-form-title">
      <div class="modal-header">
        <div>
          <h3 id="schedule-form-title">{editingSchedule ? 'Edit Schedule' : 'Create Schedule'}</h3>
          <p class="text-sm text-gray">
            {editingSchedule ? 'Update your scheduled job.' : 'Set up a new automated job.'}
          </p>
        </div>
        <button class="close-btn" type="button" on:click={handleClose} aria-label="Close">
          &times;
        </button>
      </div>

      <form on:submit|preventDefault={handleSave}>
        <div class="form-section">
          <h4>Basic Settings</h4>
          <div class="grid grid-2 gap-3">
            <div class="form-group">
              <label class="form-label" for="schedule-name">Schedule Name</label>
              <input
                id="schedule-name"
                class="form-input"
                placeholder="Daily Backup"
                bind:value={formData.name}
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="job-type">Job Type</label>
              <select
                id="job-type"
                class="form-input"
                bind:value={formData.jobType}
                on:change={handleJobTypeChange}
              >
                <option value="backup">Backup</option>
                <option value="sync">Sync</option>
              </select>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h4>Connections</h4>
          <div class="grid grid-2 gap-3">
            <div class="form-group">
              <label class="form-label" for="source-connection">
                {formData.jobType === 'backup' ? 'Source Instance' : 'Source Instance'}
              </label>
              <select
                id="source-connection"
                class="form-input"
                bind:value={formData.sourceConnectionId}
              >
                <option value="">Select a connection...</option>
                {#each savedConnections as conn}
                  <option value={conn.id}>{conn.name} ({conn.instanceUrl})</option>
                {/each}
              </select>
            </div>

            {#if formData.jobType === 'sync'}
              <div class="form-group">
                <label class="form-label" for="dest-connection">Destination Instance</label>
                <select
                  id="dest-connection"
                  class="form-input"
                  bind:value={formData.destinationConnectionId}
                >
                  <option value="">Select a connection...</option>
                  {#each savedConnections as conn}
                    <option value={conn.id}>{conn.name} ({conn.instanceUrl})</option>
                  {/each}
                </select>
              </div>
            {/if}
          </div>
        </div>

        {#if formData.jobType === 'backup'}
          <div class="form-section">
            <h4>Backup Retention</h4>
            <div class="form-group">
              <label class="form-label" for="retention-count">Keep last backups</label>
              <div class="retention-input-group">
                <input
                  id="retention-count"
                  type="number"
                  class="form-input retention-input"
                  placeholder="e.g. 5"
                  min="1"
                  max="100"
                  bind:value={formData.retentionCount}
                />
                <span class="retention-hint">Leave empty to keep all backups</span>
              </div>
            </div>
          </div>
        {/if}

        <div class="form-section">
          <h4>Schedule</h4>
          <div class="form-group mb-3">
            <label class="form-label" for="schedule-preset">Frequency</label>
            <select
              id="schedule-preset"
              class="form-input"
              bind:value={formData.schedulePreset}
              on:change={handlePresetChange}
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div class="time-picker-grid">
            {#if formData.schedulePreset === 'hourly'}
              <div class="form-group">
                <label class="form-label" for="custom-minute">At minute</label>
                <select id="custom-minute" class="form-input" bind:value={customMinute}>
                  {#each MINUTES as min}
                    <option value={min.value}>{min.label}</option>
                  {/each}
                </select>
              </div>
            {/if}

            {#if formData.schedulePreset === 'daily'}
              <TimePicker
                id="daily-time"
                label="Time"
                bind:hour24={customHour}
                bind:minute={customMinute}
                {timeFormat}
                on:change={handleTimeChange}
                on:error={handleTimeError}
              />
            {/if}

            {#if formData.schedulePreset === 'weekly'}
              <div class="form-group">
                <label class="form-label" for="custom-day-week">Day</label>
                <select id="custom-day-week" class="form-input" bind:value={customDayOfWeek}>
                  {#each DAYS_OF_WEEK as day}
                    <option value={day.value}>{day.fullLabel}</option>
                  {/each}
                </select>
              </div>
              <TimePicker
                id="weekly-time"
                label="Time"
                bind:hour24={customHour}
                bind:minute={customMinute}
                {timeFormat}
                on:change={handleTimeChange}
                on:error={handleTimeError}
              />
            {/if}

            {#if formData.schedulePreset === 'monthly'}
              <div class="form-group">
                <label class="form-label" for="custom-day-month">Day of month</label>
                <select id="custom-day-month" class="form-input" bind:value={customDayOfMonth}>
                  {#each DAYS_OF_MONTH as day}
                    <option value={day.value}>{day.label}</option>
                  {/each}
                </select>
              </div>
              <TimePicker
                id="monthly-time"
                label="Time"
                bind:hour24={customHour}
                bind:minute={customMinute}
                {timeFormat}
                on:change={handleTimeChange}
                on:error={handleTimeError}
              />
            {/if}

            {#if formData.schedulePreset === 'custom'}
              <div class="form-group full-width">
                <label class="form-label" for="custom-days">Days of the week</label>
                <DayPicker
                  bind:selectedDays={customSelectedDays}
                  on:change={handleDaysChange}
                />
              </div>
              <TimePicker
                id="custom-time"
                label="Time"
                bind:hour24={customHour}
                bind:minute={customMinute}
                {timeFormat}
                on:change={handleTimeChange}
                on:error={handleTimeError}
              />
            {/if}
          </div>
        </div>

        <div class="form-section">
          <div class="flex justify-between items-center mb-2">
            <h4>What to {formData.jobType === 'backup' ? 'Backup' : 'Sync'}</h4>
            <button type="button" class="btn btn-secondary btn-sm" on:click={toggleAllOptions}>
              {allOptionsSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div class="toggle-buttons-grid">
            {#each ALL_OPTIONS as option}
              <button
                type="button"
                class="toggle-btn {formData.options[option.key] ? 'selected' : ''}"
                on:click={() => toggleOption(option.key)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="form-section">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={formData.enabled} />
            <strong>Enable schedule</strong>
            <span class="text-sm text-gray">- Schedule will run automatically when enabled</span>
          </label>
        </div>

        {#if formError}
          <div class="alert alert-error mt-3">{formError}</div>
        {/if}

        <div class="modal-footer">
          <button class="btn btn-secondary" type="button" on:click={handleClose}>Cancel</button>
          <button class="btn btn-primary" type="submit" disabled={saving}>
            {#if saving}
              <span class="spinner"></span>
              Saving...
            {:else}
              {editingSchedule ? 'Save Changes' : 'Create Schedule'}
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
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
    width: min(600px, 100%);
    max-height: 90vh;
    overflow-y: auto;
    background: var(--bg-card);
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .modal-lg {
    width: min(800px, 100%);
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
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .form-section {
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .form-section:last-of-type {
    border-bottom: none;
    margin-bottom: 0.5rem;
  }

  .form-section h4 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .toggle-buttons-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toggle-btn:hover {
    border-color: var(--primary);
    color: var(--primary);
  }

  .toggle-btn.selected {
    border-color: var(--primary);
    background: var(--bg-selected);
    color: var(--primary);
  }

  .time-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }

  .time-picker-grid .full-width {
    grid-column: 1 / -1;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    width: 1rem;
    height: 1rem;
  }

  .mb-3 {
    margin-bottom: 0.75rem;
  }

  .retention-input-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .retention-input {
    width: 6rem;
  }

  .retention-hint {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .modal .spinner {
    width: 1.125rem;
    height: 1.125rem;
    border-width: 2px;
  }
</style>
