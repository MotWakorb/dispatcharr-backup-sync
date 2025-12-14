<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    listSchedules,
    listSavedConnections,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
    triggerScheduleRun,
    getScheduleHistory,
    getSettings,
  } from '../api';
  import type {
    Schedule,
    ScheduleInput,
    SavedConnection,
    SyncOptions,
    ScheduleRunHistoryEntry,
    SchedulePreset,
    ScheduledJobType,
    TimeFormat,
  } from '../types';

  // State
  let schedules: Schedule[] = [];
  let savedConnections: SavedConnection[] = [];
  let loading = false;
  let error: string | null = null;
  let success: string | null = null;
  let pollInterval: number | null = null;

  // Modal state
  let showModal = false;
  let editingSchedule: Schedule | null = null;
  let formData: ScheduleInput = getDefaultFormData();
  let formError: string | null = null;
  let saving = false;

  // History modal state
  let showHistoryModal = false;
  let historySchedule: Schedule | null = null;
  let historyEntries: ScheduleRunHistoryEntry[] = [];
  let loadingHistory = false;

  const PRESET_LABELS: Record<SchedulePreset, string> = {
    hourly: 'Hourly',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    custom: 'Custom',
  };

  const JOB_TYPE_LABELS: Record<ScheduledJobType, string> = {
    backup: 'Backup',
    sync: 'Sync',
  };

  // Time format setting
  let timeFormat: TimeFormat = '12h';

  // Custom schedule time picker state
  let customHour = 2;
  let customMinute = 0;
  let customDayOfWeek = 0; // 0 = Sunday (for weekly preset)
  let customDayOfMonth = 1;

  // Typed time input state
  let typedHour = '2';
  let typedMinute = '00';
  let ampm: 'AM' | 'PM' = 'AM';
  let timeInputError: string | null = null;

  // Custom schedule - multiple days selection
  let customSelectedDays: number[] = [1]; // Default to Monday

  const DAYS_OF_WEEK = [
    { value: 0, label: 'Sun', fullLabel: 'Sunday' },
    { value: 1, label: 'Mon', fullLabel: 'Monday' },
    { value: 2, label: 'Tue', fullLabel: 'Tuesday' },
    { value: 3, label: 'Wed', fullLabel: 'Wednesday' },
    { value: 4, label: 'Thu', fullLabel: 'Thursday' },
    { value: 5, label: 'Fri', fullLabel: 'Friday' },
    { value: 6, label: 'Sat', fullLabel: 'Saturday' },
  ];

  const HOURS = Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`,
  }));

  const MINUTES = [
    { value: 0, label: ':00' },
    { value: 15, label: ':15' },
    { value: 30, label: ':30' },
    { value: 45, label: ':45' },
  ];

  const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => ({
    value: i + 1,
    label: `${i + 1}${getOrdinalSuffix(i + 1)}`,
  }));

  function getOrdinalSuffix(n: number): string {
    if (n >= 11 && n <= 13) return 'th';
    switch (n % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  // Convert typed time input to 24h customHour value
  function parseTypedTime(): boolean {
    timeInputError = null;

    const hour = parseInt(typedHour, 10);
    const minute = parseInt(typedMinute, 10);

    // Validate minute
    if (isNaN(minute) || minute < 0 || minute > 59) {
      timeInputError = 'Minutes must be 0-59';
      return false;
    }

    if (timeFormat === '12h') {
      // 12-hour format validation
      if (isNaN(hour) || hour < 1 || hour > 12) {
        timeInputError = 'Hour must be 1-12 in 12-hour format';
        return false;
      }
      // Convert to 24h
      if (ampm === 'AM') {
        customHour = hour === 12 ? 0 : hour;
      } else {
        customHour = hour === 12 ? 12 : hour + 12;
      }
    } else {
      // 24-hour format validation
      if (isNaN(hour) || hour < 0 || hour > 23) {
        timeInputError = 'Hour must be 0-23 in 24-hour format';
        return false;
      }
      customHour = hour;
    }

    customMinute = minute;
    return true;
  }

  // Convert 24h customHour to typed time display
  function updateTypedTimeFromCustom() {
    if (timeFormat === '12h') {
      if (customHour === 0) {
        typedHour = '12';
        ampm = 'AM';
      } else if (customHour < 12) {
        typedHour = String(customHour);
        ampm = 'AM';
      } else if (customHour === 12) {
        typedHour = '12';
        ampm = 'PM';
      } else {
        typedHour = String(customHour - 12);
        ampm = 'PM';
      }
    } else {
      typedHour = String(customHour);
    }
    typedMinute = customMinute.toString().padStart(2, '0');
  }

  // Handle time input changes
  function handleTimeInputChange() {
    parseTypedTime();
  }

  function buildCronExpression(): string {
    switch (formData.schedulePreset) {
      case 'hourly':
        return `${customMinute} * * * *`;
      case 'daily':
        return `${customMinute} ${customHour} * * *`;
      case 'weekly':
        return `${customMinute} ${customHour} * * ${customDayOfWeek}`;
      case 'monthly':
        return `${customMinute} ${customHour} ${customDayOfMonth} * *`;
      case 'custom':
        // Custom: specific days of week at specific time
        // We store the week interval in a comment format that we can parse later
        const days = customSelectedDays.length > 0 ? customSelectedDays.sort((a, b) => a - b).join(',') : '1';
        // Standard cron doesn't support "every N weeks", so we'll use the days and note the interval
        // The backend will need to handle the interval logic
        return `${customMinute} ${customHour} * * ${days}`;
      default:
        return '0 2 * * *';
    }
  }

  function parseCronExpression(cron: string | undefined) {
    if (!cron) {
      customMinute = 0;
      customHour = 2;
      customDayOfMonth = 1;
      customDayOfWeek = 0;
      customSelectedDays = [1];
      return;
    }
    const parts = cron.split(' ');
    if (parts.length >= 5) {
      customMinute = parseInt(parts[0]) || 0;
      customHour = parts[1] === '*' ? 0 : parseInt(parts[1]) || 2;
      customDayOfMonth = parts[2] === '*' ? 1 : parseInt(parts[2]) || 1;

      // Parse day of week - could be single value or comma-separated list
      const dayOfWeekPart = parts[4];
      if (dayOfWeekPart === '*') {
        customDayOfWeek = 0;
        customSelectedDays = [1];
      } else if (dayOfWeekPart.includes(',')) {
        // Multiple days selected (custom preset)
        customSelectedDays = dayOfWeekPart.split(',').map(d => parseInt(d) || 0);
        customDayOfWeek = customSelectedDays[0] || 0;
      } else {
        customDayOfWeek = parseInt(dayOfWeekPart) || 0;
        customSelectedDays = [customDayOfWeek];
      }
    }
  }

  function formatScheduleDescription(schedule: Schedule): string {
    if (!schedule.cronExpression) return PRESET_LABELS[schedule.schedulePreset];
    const parts = schedule.cronExpression.split(' ');
    if (parts.length < 5) return schedule.cronExpression;

    const minute = parseInt(parts[0]) || 0;
    const hour = parts[1] === '*' ? null : parseInt(parts[1]);
    const dayOfMonth = parts[2] === '*' ? null : parseInt(parts[2]);
    const dayOfWeekPart = parts[4];

    const timeStr = hour !== null ? formatTime(hour, minute) : `at :${minute.toString().padStart(2, '0')}`;

    switch (schedule.schedulePreset) {
      case 'hourly':
        return `Every hour at :${minute.toString().padStart(2, '0')}`;
      case 'daily':
        return `Daily at ${timeStr}`;
      case 'weekly':
        const dayOfWeek = dayOfWeekPart === '*' ? 0 : parseInt(dayOfWeekPart) || 0;
        const dayName = DAYS_OF_WEEK.find(d => d.value === dayOfWeek)?.fullLabel || 'Sunday';
        return `${dayName}s at ${timeStr}`;
      case 'monthly':
        return `${dayOfMonth}${getOrdinalSuffix(dayOfMonth || 1)} at ${timeStr}`;
      case 'custom':
        // Parse multiple days
        if (dayOfWeekPart.includes(',')) {
          const days = dayOfWeekPart.split(',').map(d => parseInt(d) || 0);
          const dayNames = days.map(d => DAYS_OF_WEEK.find(dow => dow.value === d)?.label || '?');
          return `${dayNames.join(', ')} at ${timeStr}`;
        } else {
          const singleDay = parseInt(dayOfWeekPart) || 0;
          const singleDayName = DAYS_OF_WEEK.find(d => d.value === singleDay)?.fullLabel || 'Monday';
          return `${singleDayName}s at ${timeStr}`;
        }
      default:
        return schedule.cronExpression;
    }
  }

  function formatTime(hour: number, minute: number): string {
    if (timeFormat === '24h') {
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    // 12h format
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  }

  // Option toggle helper
  function toggleOption(key: keyof SyncOptions) {
    formData.options[key] = !formData.options[key];
    formData.options = formData.options; // Trigger reactivity
  }

  // Custom day toggle helper
  function toggleCustomDay(day: number) {
    if (customSelectedDays.includes(day)) {
      // Don't allow deselecting if it's the last day
      if (customSelectedDays.length > 1) {
        customSelectedDays = customSelectedDays.filter(d => d !== day);
      }
    } else {
      customSelectedDays = [...customSelectedDays, day];
    }
  }

  const ALL_OPTIONS = [
    { key: 'syncChannelGroups' as keyof SyncOptions, label: 'Channel Groups' },
    { key: 'syncChannelProfiles' as keyof SyncOptions, label: 'Channel Profiles' },
    { key: 'syncChannels' as keyof SyncOptions, label: 'Channels' },
    { key: 'syncM3USources' as keyof SyncOptions, label: 'M3U Sources' },
    { key: 'syncStreamProfiles' as keyof SyncOptions, label: 'Stream Profiles' },
    { key: 'syncUserAgents' as keyof SyncOptions, label: 'User Agents' },
    { key: 'syncCoreSettings' as keyof SyncOptions, label: 'Core Settings' },
    { key: 'syncEPGSources' as keyof SyncOptions, label: 'EPG Sources' },
    { key: 'syncPlugins' as keyof SyncOptions, label: 'Plugins' },
    { key: 'syncDVRRules' as keyof SyncOptions, label: 'DVR Rules' },
    { key: 'syncComskipConfig' as keyof SyncOptions, label: 'Comskip Config' },
    { key: 'syncUsers' as keyof SyncOptions, label: 'Users' },
    { key: 'syncLogos' as keyof SyncOptions, label: 'Logos' },
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
        syncLogos: false, // Off by default due to performance impact
      },
      schedulePreset: 'daily',
      cronExpression: undefined,
      enabled: true,
      retentionCount: undefined,
    };
  }

  onMount(async () => {
    await loadData();
    startPolling();
  });

  onDestroy(() => {
    stopPolling();
  });

  async function loadData() {
    loading = true;
    error = null;
    try {
      const [schedulesResult, connectionsResult, settingsResult] = await Promise.all([
        listSchedules(),
        listSavedConnections(),
        getSettings(),
      ]);
      schedules = schedulesResult;
      savedConnections = connectionsResult;
      timeFormat = settingsResult.timeFormat || '12h';
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to load data';
    } finally {
      loading = false;
    }
  }

  function startPolling() {
    pollInterval = window.setInterval(async () => {
      try {
        schedules = await listSchedules();
      } catch {
        // Ignore polling errors
      }
    }, 10000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function openCreateModal() {
    editingSchedule = null;
    formData = getDefaultFormData();
    formError = null;
    timeInputError = null;
    error = null;
    success = null;
    // Reset time picker to defaults
    customHour = 2;
    customMinute = 0;
    customDayOfWeek = 0;
    customDayOfMonth = 1;
    customSelectedDays = [1]; // Default to Monday
    // Initialize typed time input
    updateTypedTimeFromCustom();
    showModal = true;
  }

  function openEditModal(schedule: Schedule) {
    editingSchedule = schedule;
    formData = {
      name: schedule.name,
      jobType: schedule.jobType,
      sourceConnectionId: schedule.sourceConnectionId,
      destinationConnectionId: schedule.destinationConnectionId,
      options: { ...schedule.options },
      schedulePreset: schedule.schedulePreset,
      cronExpression: schedule.cronExpression,
      enabled: schedule.enabled,
      retentionCount: schedule.retentionCount,
    };
    formError = null;
    timeInputError = null;
    error = null;
    success = null;
    // Parse existing cron expression into time picker values
    parseCronExpression(schedule.cronExpression);
    // Update typed time input display
    updateTypedTimeFromCustom();
    showModal = true;
  }

  function closeModal() {
    showModal = false;
    editingSchedule = null;
    formData = getDefaultFormData();
    formError = null;
  }

  function handlePresetChange() {
    formData.cronExpression = undefined;
  }

  function handleJobTypeChange() {
    if (formData.jobType === 'backup') {
      formData.destinationConnectionId = undefined;
    }
  }

  async function handleSave() {
    formError = null;
    timeInputError = null;

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

    // Validate time input (except for hourly which only uses minute)
    if (formData.schedulePreset !== 'hourly') {
      if (!parseTypedTime()) {
        formError = timeInputError || 'Invalid time';
        return;
      }
    }

    // Build cron expression from time picker values for all presets
    formData.cronExpression = buildCronExpression();

    // Validate custom schedule has at least one day selected
    if (formData.schedulePreset === 'custom' && customSelectedDays.length === 0) {
      formError = 'Please select at least one day';
      return;
    }

    saving = true;
    try {
      if (editingSchedule) {
        await updateSchedule(editingSchedule.id, formData);
        success = 'Schedule updated successfully';
      } else {
        await createSchedule(formData);
        success = 'Schedule created successfully';
      }
      closeModal();
      await loadData();
    } catch (err: any) {
      formError = err.response?.data?.error || err.message || 'Failed to save schedule';
    } finally {
      saving = false;
    }
  }

  async function handleDelete(schedule: Schedule) {
    if (!confirm(`Delete schedule "${schedule.name}"?`)) return;

    try {
      await deleteSchedule(schedule.id);
      success = 'Schedule deleted';
      await loadData();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to delete schedule';
    }
  }

  async function handleToggle(schedule: Schedule) {
    try {
      await toggleSchedule(schedule.id);
      await loadData();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to toggle schedule';
    }
  }

  async function handleRunNow(schedule: Schedule) {
    try {
      await triggerScheduleRun(schedule.id);
      success = `Schedule "${schedule.name}" triggered`;
      await loadData();
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to trigger schedule';
    }
  }

  async function openHistoryModal(schedule: Schedule) {
    historySchedule = schedule;
    showHistoryModal = true;
    loadingHistory = true;
    try {
      historyEntries = await getScheduleHistory(schedule.id, 20);
    } catch (err: any) {
      // Handle error
    } finally {
      loadingHistory = false;
    }
  }

  function closeHistoryModal() {
    showHistoryModal = false;
    historySchedule = null;
    historyEntries = [];
  }

  function getConnectionName(id: string | undefined, cachedName?: string): string {
    if (!id) return cachedName || 'Unknown';
    const conn = savedConnections.find((c) => c.id === id);
    // Use live connection name if found, otherwise fall back to cached name
    return conn?.name || cachedName || 'Unknown';
  }

  function formatNextRun(nextRunAt?: string): string {
    if (!nextRunAt) return 'Not scheduled';
    return new Date(nextRunAt).toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function formatLastRun(schedule: Schedule): string {
    if (!schedule.lastRunAt) return 'Never';
    return new Date(schedule.lastRunAt).toLocaleString(undefined, {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function getStatusBadgeClass(status?: string): string {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'failed':
        return 'badge-danger';
      case 'cancelled':
        return 'badge-warning';
      default:
        return 'badge-gray';
    }
  }

  // Toggle all options
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
      syncLogos: newValue,
    };
  }

  $: allOptionsSelected = Object.values(formData.options).every(Boolean);
</script>

<div>
  <div class="card">
    <div class="card-header flex justify-between items-center">
      <div>
        <h2 class="card-title">Schedules</h2>
        <p class="text-sm text-gray">Automate your backup and sync jobs.</p>
      </div>
      <button class="btn btn-primary" on:click={openCreateModal} disabled={savedConnections.length === 0}>
        Create Schedule
      </button>
    </div>

    {#if error}
      <div class="alert alert-error mb-2">{error}</div>
    {/if}

    {#if success}
      <div class="alert alert-success mb-2">{success}</div>
    {/if}

    {#if savedConnections.length === 0 && !loading}
      <div class="alert alert-warning mb-2">
        You need to create at least one connection in the Settings tab before creating schedules.
      </div>
    {/if}

    {#if loading}
      <p>Loading schedules...</p>
    {:else if schedules.length === 0}
      <div class="empty-state">
        <p class="text-gray">No schedules yet.</p>
        <p class="text-sm text-gray">Click "Create Schedule" to automate your first job.</p>
      </div>
    {:else}
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Schedule</th>
              <th>Source</th>
              <th class="next-run-col">Next Run</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each schedules as schedule}
              <tr class:disabled-row={!schedule.enabled}>
                <td>
                  <div class="schedule-name">
                    {schedule.name}
                    {#if !schedule.enabled}
                      <span class="badge badge-gray">Disabled</span>
                    {/if}
                  </div>
                </td>
                <td>
                  <span class="badge" class:badge-primary={schedule.jobType === 'backup'} class:badge-info={schedule.jobType === 'sync'}>
                    {JOB_TYPE_LABELS[schedule.jobType]}
                  </span>
                </td>
                <td class="text-sm">{formatScheduleDescription(schedule)}</td>
                <td class="text-sm">
                  {getConnectionName(schedule.sourceConnectionId, schedule.sourceConnectionName)}
                  {#if schedule.jobType === 'sync'}
                    <span class="text-gray"> → </span>
                    {getConnectionName(schedule.destinationConnectionId, schedule.destinationConnectionName)}
                  {/if}
                </td>
                <td class="text-sm next-run-col">{schedule.enabled ? formatNextRun(schedule.nextRunAt) : '-'}</td>
                <td>
                  {#if schedule.isRunning}
                    <span class="badge badge-running">
                      <span class="spinner-sm"></span>
                      Running
                    </span>
                  {:else}
                    <span class="badge {schedule.enabled ? 'badge-success' : 'badge-gray'}">
                      {schedule.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  {/if}
                </td>
                <td class="actions">
                  <button
                    class="btn btn-secondary btn-sm"
                    on:click={() => handleRunNow(schedule)}
                    disabled={schedule.isRunning}
                    title="Run Now"
                  >
                    Run
                  </button>
                  <button
                    class="btn btn-secondary btn-sm"
                    on:click={() => openHistoryModal(schedule)}
                    title="View History"
                  >
                    History
                  </button>
                  <button
                    class="btn btn-sm"
                    class:btn-success={!schedule.enabled}
                    class:btn-warning={schedule.enabled}
                    on:click={() => handleToggle(schedule)}
                    disabled={schedule.isRunning}
                  >
                    {schedule.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    class="btn btn-primary btn-sm"
                    on:click={() => openEditModal(schedule)}
                  >
                    Edit
                  </button>
                  <button
                    class="btn btn-danger btn-sm"
                    on:click={() => handleDelete(schedule)}
                    disabled={schedule.isRunning}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- Create/Edit Schedule Modal -->
  {#if showModal}
    <div class="overlay" role="presentation">
      <div class="modal modal-lg" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3>{editingSchedule ? 'Edit Schedule' : 'Create Schedule'}</h3>
            <p class="text-sm text-gray">
              {editingSchedule ? 'Update your scheduled job.' : 'Set up a new automated job.'}
            </p>
          </div>
          <button class="close-btn" type="button" on:click={closeModal} aria-label="Close">
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
                <div class="form-group">
                  <label class="form-label" for="daily-hour">Time</label>
                  <div class="time-input-group">
                    <input
                      id="daily-hour"
                      type="text"
                      class="form-input time-input"
                      placeholder={timeFormat === '12h' ? 'HH' : 'HH'}
                      maxlength="2"
                      bind:value={typedHour}
                      on:blur={handleTimeInputChange}
                    />
                    <span class="time-separator">:</span>
                    <input
                      type="text"
                      class="form-input time-input"
                      placeholder="MM"
                      maxlength="2"
                      bind:value={typedMinute}
                      on:blur={handleTimeInputChange}
                    />
                    {#if timeFormat === '12h'}
                      <div class="ampm-toggle">
                        <button
                          type="button"
                          class="ampm-btn {ampm === 'AM' ? 'selected' : ''}"
                          on:click={() => { ampm = 'AM'; handleTimeInputChange(); }}
                        >AM</button>
                        <button
                          type="button"
                          class="ampm-btn {ampm === 'PM' ? 'selected' : ''}"
                          on:click={() => { ampm = 'PM'; handleTimeInputChange(); }}
                        >PM</button>
                      </div>
                    {/if}
                  </div>
                  {#if timeInputError}
                    <p class="time-error">{timeInputError}</p>
                  {/if}
                </div>
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
                <div class="form-group">
                  <label class="form-label" for="weekly-hour">Time</label>
                  <div class="time-input-group">
                    <input
                      id="weekly-hour"
                      type="text"
                      class="form-input time-input"
                      placeholder={timeFormat === '12h' ? 'HH' : 'HH'}
                      maxlength="2"
                      bind:value={typedHour}
                      on:blur={handleTimeInputChange}
                    />
                    <span class="time-separator">:</span>
                    <input
                      type="text"
                      class="form-input time-input"
                      placeholder="MM"
                      maxlength="2"
                      bind:value={typedMinute}
                      on:blur={handleTimeInputChange}
                    />
                    {#if timeFormat === '12h'}
                      <div class="ampm-toggle">
                        <button
                          type="button"
                          class="ampm-btn {ampm === 'AM' ? 'selected' : ''}"
                          on:click={() => { ampm = 'AM'; handleTimeInputChange(); }}
                        >AM</button>
                        <button
                          type="button"
                          class="ampm-btn {ampm === 'PM' ? 'selected' : ''}"
                          on:click={() => { ampm = 'PM'; handleTimeInputChange(); }}
                        >PM</button>
                      </div>
                    {/if}
                  </div>
                  {#if timeInputError}
                    <p class="time-error">{timeInputError}</p>
                  {/if}
                </div>
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
                <div class="form-group">
                  <label class="form-label" for="monthly-hour">Time</label>
                  <div class="time-input-group">
                    <input
                      id="monthly-hour"
                      type="text"
                      class="form-input time-input"
                      placeholder={timeFormat === '12h' ? 'HH' : 'HH'}
                      maxlength="2"
                      bind:value={typedHour}
                      on:blur={handleTimeInputChange}
                    />
                    <span class="time-separator">:</span>
                    <input
                      type="text"
                      class="form-input time-input"
                      placeholder="MM"
                      maxlength="2"
                      bind:value={typedMinute}
                      on:blur={handleTimeInputChange}
                    />
                    {#if timeFormat === '12h'}
                      <div class="ampm-toggle">
                        <button
                          type="button"
                          class="ampm-btn {ampm === 'AM' ? 'selected' : ''}"
                          on:click={() => { ampm = 'AM'; handleTimeInputChange(); }}
                        >AM</button>
                        <button
                          type="button"
                          class="ampm-btn {ampm === 'PM' ? 'selected' : ''}"
                          on:click={() => { ampm = 'PM'; handleTimeInputChange(); }}
                        >PM</button>
                      </div>
                    {/if}
                  </div>
                  {#if timeInputError}
                    <p class="time-error">{timeInputError}</p>
                  {/if}
                </div>
              {/if}

              {#if formData.schedulePreset === 'custom'}
                <div class="form-group full-width">
                  <label class="form-label">Days of the week</label>
                  <div class="day-picker">
                    {#each DAYS_OF_WEEK as day}
                      <button
                        type="button"
                        class="day-btn {customSelectedDays.includes(day.value) ? 'selected' : ''}"
                        on:click={() => toggleCustomDay(day.value)}
                      >
                        {day.label}
                      </button>
                    {/each}
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label" for="custom-hour">Time</label>
                  <div class="time-input-group">
                    <input
                      id="custom-hour"
                      type="text"
                      class="form-input time-input"
                      placeholder={timeFormat === '12h' ? 'HH' : 'HH'}
                      maxlength="2"
                      bind:value={typedHour}
                      on:blur={handleTimeInputChange}
                    />
                    <span class="time-separator">:</span>
                    <input
                      type="text"
                      class="form-input time-input"
                      placeholder="MM"
                      maxlength="2"
                      bind:value={typedMinute}
                      on:blur={handleTimeInputChange}
                    />
                    {#if timeFormat === '12h'}
                      <div class="ampm-toggle">
                        <button
                          type="button"
                          class="ampm-btn {ampm === 'AM' ? 'selected' : ''}"
                          on:click={() => { ampm = 'AM'; handleTimeInputChange(); }}
                        >AM</button>
                        <button
                          type="button"
                          class="ampm-btn {ampm === 'PM' ? 'selected' : ''}"
                          on:click={() => { ampm = 'PM'; handleTimeInputChange(); }}
                        >PM</button>
                      </div>
                    {/if}
                  </div>
                  {#if timeInputError}
                    <p class="time-error">{timeInputError}</p>
                  {/if}
                </div>
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
            <button class="btn btn-secondary" type="button" on:click={closeModal}>Cancel</button>
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

  <!-- History Modal -->
  {#if showHistoryModal && historySchedule}
    <div class="overlay" role="presentation">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3>Run History</h3>
            <p class="text-sm text-gray">{historySchedule.name}</p>
          </div>
          <button class="close-btn" type="button" on:click={closeHistoryModal} aria-label="Close">
            &times;
          </button>
        </div>

        {#if loadingHistory}
          <p>Loading history...</p>
        {:else if historyEntries.length === 0}
          <div class="empty-state">
            <p class="text-gray">No run history yet.</p>
          </div>
        {:else}
          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Status</th>
                  <th>Job ID</th>
                </tr>
              </thead>
              <tbody>
                {#each historyEntries as entry}
                  <tr>
                    <td class="text-sm">{new Date(entry.startedAt).toLocaleString()}</td>
                    <td class="text-sm">{entry.completedAt ? new Date(entry.completedAt).toLocaleString() : '-'}</td>
                    <td>
                      <span class="badge {getStatusBadgeClass(entry.status)}">{entry.status}</span>
                      {#if entry.error}
                        <span class="text-xs text-danger" title={entry.error}>
                          (error)
                        </span>
                      {/if}
                    </td>
                    <td class="text-sm text-gray">{entry.jobId}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <div class="modal-footer">
          <button class="btn btn-secondary" on:click={closeHistoryModal}>Close</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .table-wrapper {
    overflow-x: auto;
    width: 100%;
  }

  .table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
  }

  th:nth-last-child(2),
  td:nth-last-child(2) {
    width: 100%;
  }

  .next-run-col {
    min-width: 10rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    flex-wrap: nowrap;
    white-space: nowrap;
  }

  .empty-state {
    text-align: center;
    padding: 2rem 1rem;
  }

  .disabled-row {
    opacity: 0.6;
  }

  .schedule-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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

  .time-select-group {
    display: flex;
    gap: 0.5rem;
  }

  .time-select-group select {
    flex: 1;
  }

  .time-input-group {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .time-input {
    width: 3rem;
    text-align: center;
    padding: 0.5rem;
  }

  .time-separator {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .ampm-toggle {
    display: flex;
    margin-left: 0.5rem;
  }

  .ampm-btn {
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--border-color-strong);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .ampm-btn:first-child {
    border-radius: 0.375rem 0 0 0.375rem;
    border-right: 1px solid var(--border-color-strong);
  }

  .ampm-btn:last-child {
    border-radius: 0 0.375rem 0.375rem 0;
    border-left: 1px solid var(--border-color-strong);
  }

  .ampm-btn:hover {
    background: var(--bg-hover);
  }

  .ampm-btn.selected {
    border-color: var(--primary);
    background: var(--primary);
    color: #ffffff;
  }

  .time-error {
    color: var(--danger);
    font-size: 0.75rem;
    margin-top: 0.25rem;
    margin-bottom: 0;
  }

  .day-picker {
    display: flex;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .day-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 2.5rem;
    border: 2px solid var(--border-color-strong);
    border-radius: 0.5rem;
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .day-btn:hover {
    border-color: var(--primary);
    color: var(--primary);
  }

  .day-btn.selected {
    border-color: var(--primary);
    background: var(--primary);
    color: #ffffff;
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

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .badge-sm {
    padding: 0.125rem 0.375rem;
    font-size: 0.7rem;
  }

  .badge-primary {
    background: var(--primary);
    color: #ffffff;
  }

  .badge-info {
    background: var(--primary);
    color: #ffffff;
  }

  .badge-success {
    background: var(--success);
    color: #ffffff;
  }

  .badge-warning {
    background: var(--warning);
    color: #ffffff;
  }

  .badge-danger {
    background: var(--danger);
    color: #ffffff;
  }

  .badge-gray {
    background: var(--border-color-strong);
    color: var(--text-secondary);
  }

  .badge-running {
    background: var(--primary);
    color: #ffffff;
  }

  .spinner-sm {
    width: 0.75rem;
    height: 0.75rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .text-success {
    color: var(--success);
  }

  .text-danger {
    color: var(--danger);
  }

  .text-xs {
    font-size: 0.75rem;
  }

  .modal .spinner {
    width: 1.125rem;
    height: 1.125rem;
    border-width: 2px;
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
</style>
