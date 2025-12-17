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
    ScheduleRunHistoryEntry,
    ScheduledJobType,
    TimeFormat,
  } from '../types';
  import { SCHEDULE_POLL_INTERVAL_MS } from '../constants';
  import { formatScheduleDescription } from '../lib/scheduleUtils';
  import ScheduleFormModal from './schedule/ScheduleFormModal.svelte';
  import ScheduleHistoryModal from './schedule/ScheduleHistoryModal.svelte';

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
  let saving = false;

  // History modal state
  let showHistoryModal = false;
  let historySchedule: Schedule | null = null;
  let historyEntries: ScheduleRunHistoryEntry[] = [];
  let loadingHistory = false;

  // Time format setting
  let timeFormat: TimeFormat = '12h';

  const JOB_TYPE_LABELS: Record<ScheduledJobType, string> = {
    backup: 'Backup',
    sync: 'Sync',
  };

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
    }, SCHEDULE_POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function openCreateModal() {
    editingSchedule = null;
    error = null;
    success = null;
    showModal = true;
  }

  function openEditModal(schedule: Schedule) {
    editingSchedule = schedule;
    error = null;
    success = null;
    showModal = true;
  }

  function closeModal() {
    showModal = false;
    editingSchedule = null;
  }

  async function handleSave(event: CustomEvent<ScheduleInput>) {
    const formData = event.detail;
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
      error = err.response?.data?.error || err.message || 'Failed to save schedule';
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
    } catch {
      // Handle error silently
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
                <td class="text-sm">{formatScheduleDescription(schedule.schedulePreset, schedule.cronExpression, timeFormat)}</td>
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

  <ScheduleFormModal
    show={showModal}
    {editingSchedule}
    {savedConnections}
    {timeFormat}
    {saving}
    on:close={closeModal}
    on:save={handleSave}
  />

  <ScheduleHistoryModal
    show={showHistoryModal}
    schedule={historySchedule}
    entries={historyEntries}
    loading={loadingHistory}
    on:close={closeHistoryModal}
  />
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

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
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
</style>
