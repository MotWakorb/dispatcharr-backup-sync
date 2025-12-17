<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Schedule, ScheduleRunHistoryEntry } from '../../types';

  export let show: boolean = false;
  export let schedule: Schedule | null = null;
  export let entries: ScheduleRunHistoryEntry[] = [];
  export let loading: boolean = false;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  function handleClose() {
    dispatch('close');
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
</script>

{#if show && schedule}
  <div class="overlay" role="presentation">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <h3>Run History</h3>
          <p class="text-sm text-gray">{schedule.name}</p>
        </div>
        <button class="close-btn" type="button" on:click={handleClose} aria-label="Close">
          &times;
        </button>
      </div>

      {#if loading}
        <p>Loading history...</p>
      {:else if entries.length === 0}
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
              {#each entries as entry}
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
        <button class="btn btn-secondary" on:click={handleClose}>Close</button>
      </div>
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
  }

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

  .empty-state {
    text-align: center;
    padding: 2rem 1rem;
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

  .text-xs {
    font-size: 0.75rem;
  }

  .text-danger {
    color: var(--danger);
  }
</style>
