<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getAllLogs } from '../api';
  import type { CombinedLogEntry } from '../types';
  import { ERRORS, LABELS, STATUS, getErrorMessage, LOG_POLL_INTERVAL_MS } from '../constants';
  import Skeleton from './Skeleton.svelte';

  let logs: CombinedLogEntry[] = [];
  let loading = false;
  let error: string | null = null;
  let pollInterval: number | null = null;
  let initialized = false;

  // Filters
  let searchQuery = '';
  let jobTypeFilter = '';
  let limit = 500;
  let autoRefresh = true;

  // Available job types for filter dropdown
  const jobTypes = ['', 'backup', 'restore', 'sync'];

  onMount(() => {
    loadLogs(true);
    startPolling();
  });

  onDestroy(() => {
    stopPolling();
  });

  function startPolling() {
    if (pollInterval) return;
    pollInterval = window.setInterval(() => {
      if (autoRefresh) {
        loadLogs(false);
      }
    }, LOG_POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function loadLogs(manual: boolean = false) {
    const shouldShowLoading = manual || !initialized;
    if (shouldShowLoading) loading = true;
    error = null;
    try {
      logs = await getAllLogs({
        limit,
        jobType: jobTypeFilter || undefined,
        search: searchQuery || undefined,
      });
    } catch (err: unknown) {
      error = getErrorMessage(err, ERRORS.LOAD_LOGS);
    } finally {
      if (shouldShowLoading) loading = false;
      initialized = true;
    }
  }

  function handleSearch() {
    loadLogs(true);
  }

  function handleFilterChange() {
    loadLogs(true);
  }

  function clearFilters() {
    searchQuery = '';
    jobTypeFilter = '';
    loadLogs(true);
  }

  function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
  }

  function formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }
</script>

<div class="logs-container">
  <div class="card">
    <div class="card-header logs-header">
      <div>
        <h2 class="card-title">All Logs</h2>
        <p class="text-sm text-gray">Combined view of logs from all jobs</p>
      </div>
      <div class="header-actions">
        <button
          class="btn btn-sm"
          class:btn-success={autoRefresh}
          class:btn-secondary={!autoRefresh}
          on:click={toggleAutoRefresh}
          title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh disabled'}
        >
          {#if autoRefresh}
            <span class="pulse-dot"></span>
            Live
          {:else}
            Paused
          {/if}
        </button>
        <button class="btn btn-secondary btn-sm" on:click={() => loadLogs(true)} disabled={loading}>
          {#if loading}
            <span class="spinner"></span>
            {STATUS.LOADING}
          {:else}
            {LABELS.REFRESH}
          {/if}
        </button>
      </div>
    </div>

    <div class="filters">
      <div class="filter-group">
        <label for="search-input" class="sr-only">Search logs</label>
        <input
          id="search-input"
          type="text"
          class="form-input"
          placeholder="Search logs..."
          bind:value={searchQuery}
          on:keydown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button class="btn btn-primary btn-sm" on:click={handleSearch}>
          Search
        </button>
      </div>
      <div class="filter-group">
        <label for="job-type-filter" class="sr-only">Filter by job type</label>
        <select
          id="job-type-filter"
          class="form-select"
          bind:value={jobTypeFilter}
          on:change={handleFilterChange}
        >
          <option value="">All job types</option>
          {#each jobTypes.filter(t => t) as type}
            <option value={type}>{type}</option>
          {/each}
        </select>
      </div>
      <div class="filter-group">
        <label for="limit-filter" class="sr-only">Limit</label>
        <select
          id="limit-filter"
          class="form-select"
          bind:value={limit}
          on:change={handleFilterChange}
        >
          <option value={100}>100 entries</option>
          <option value={250}>250 entries</option>
          <option value={500}>500 entries</option>
          <option value={1000}>1000 entries</option>
        </select>
      </div>
      {#if searchQuery || jobTypeFilter}
        <button class="btn btn-secondary btn-sm" on:click={clearFilters}>
          Clear filters
        </button>
      {/if}
    </div>

    {#if error}
      <div class="alert alert-error mb-2">{error}</div>
    {/if}

    <div class="logs-body">
      {#if loading && logs.length === 0}
        <Skeleton variant="text" count={10} />
      {:else if logs.length === 0}
        <p class="text-gray empty-state">{LABELS.NO_LOGS}</p>
      {:else}
        <div class="logs-list">
          {#each logs as log}
            <div class="log-line {/error|failed/i.test(log.message) ? 'log-error' : ''} {/^WARNING:/i.test(log.message) ? 'log-warning' : ''}">
              <span class="log-time" title={formatTimestamp(log.timestamp)}>
                {formatTime(log.timestamp)}
              </span>
              <span class="log-job-info">
                <span class="badge badge-{log.jobStatus || 'pending'} badge-sm">{log.jobType || 'unknown'}</span>
                <span class="log-job-id" title={log.jobId}>{log.jobId}</span>
              </span>
              <span class="log-msg">{log.message}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if logs.length > 0}
      <div class="logs-footer">
        <span class="text-sm text-gray">Showing {logs.length} log entries</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .logs-container {
    max-width: 100%;
  }

  .logs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .filters {
    display: flex;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-hover);
    border-bottom: 1px solid var(--border-color);
    flex-wrap: wrap;
  }

  .filter-group {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .form-input {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: var(--bg-card);
    color: var(--text-primary);
    min-width: 200px;
  }

  .form-input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .form-select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    background: var(--bg-card);
    color: var(--text-primary);
    cursor: pointer;
  }

  .form-select:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .logs-body {
    padding: 0;
    overflow-y: auto;
    max-height: calc(100vh - 350px);
    min-height: 300px;
    background: var(--bg-hover);
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 0.8rem;
  }

  .logs-list {
    padding: 0.5rem;
  }

  .log-line {
    display: flex;
    gap: 0.75rem;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--border-color);
    align-items: flex-start;
  }

  .log-line:last-child {
    border-bottom: none;
  }

  .log-line:hover {
    background: var(--bg-card);
  }

  .log-time {
    color: var(--text-muted);
    min-width: 5rem;
    flex-shrink: 0;
    cursor: help;
  }

  .log-job-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 140px;
    flex-shrink: 0;
  }

  .log-job-id {
    font-size: 0.7rem;
    color: var(--text-muted);
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-msg {
    color: var(--text-primary);
    word-break: break-word;
    flex: 1;
  }

  .log-error .log-msg {
    color: var(--danger);
    font-weight: 600;
  }

  .log-warning .log-msg {
    color: var(--warning, #d97706);
    font-weight: 500;
  }

  .badge {
    display: inline-block;
    padding: 0.15rem 0.4rem;
    border-radius: 0.375rem;
    font-size: 0.65rem;
    text-transform: capitalize;
    font-weight: 500;
  }

  .badge-sm {
    font-size: 0.6rem;
    padding: 0.1rem 0.3rem;
  }

  .badge-running { background: var(--bg-info); color: var(--primary); }
  .badge-pending { background: var(--border-color); color: var(--text-secondary); }
  .badge-completed { background: var(--bg-success); color: var(--success); }
  .badge-completed_with_warnings { background: var(--bg-warning, #fef3c7); color: var(--warning, #d97706); }
  .badge-failed { background: var(--bg-error); color: var(--danger); }
  .badge-cancelled { background: var(--border-color); color: var(--text-secondary); }

  .logs-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }

  .pulse-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    background: white;
    border-radius: 50%;
    margin-right: 0.25rem;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(0.8);
    }
  }

  .btn-success {
    background: var(--success);
    color: white;
    border-color: var(--success);
  }

  .btn-success:hover {
    background: #059669;
    border-color: #059669;
  }
</style>
