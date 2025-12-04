<script lang="ts">
  import type { JobStatus } from '../types';

  export let job: JobStatus;
</script>

<div class="job-progress">
  <div class="flex items-center justify-between mb-2">
    <div>
      <span class="font-semibold">Status:</span>
      <span
        class="status-badge"
        class:status-pending={job.status === 'pending'}
        class:status-running={job.status === 'running'}
        class:status-completed={job.status === 'completed'}
        class:status-failed={job.status === 'failed'}
      >
        {job.status}
      </span>
    </div>
    {#if job.progress !== undefined}
      <span class="text-sm text-gray">{job.progress}%</span>
    {/if}
  </div>

  {#if job.progress !== undefined}
    <div class="progress-bar mb-2">
      <div class="progress-fill" style="width: {job.progress}%"></div>
    </div>
  {/if}

  {#if job.message}
    <p class="text-sm text-gray mb-1">{job.message}</p>
  {/if}

  {#if job.error}
    <div class="alert alert-error">
      {job.error}
    </div>
  {/if}

  {#if job.status === 'completed' && job.result}
    <div class="result-summary">
      <h4 class="mb-1">Results</h4>
      {#if job.result.summary}
        <div class="text-sm">
          {#if job.result.summary.counts}
            <div class="grid grid-3 gap-2">
              {#each Object.entries(job.result.summary.counts) as [key, value]}
                <div class="stat">
                  <div class="stat-label">{key}</div>
                  <div class="stat-value">{value}</div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else if job.result.synced}
        <div class="grid grid-3 gap-2">
          {#each Object.entries(job.result.synced) as [key, stats]}
            <div class="stat">
              <div class="stat-label">{key}</div>
              <div class="stat-value">
                {#if typeof stats === 'object' && stats !== null}
                  <span class="text-success">{stats.synced || 0} synced</span>
                  {#if stats.errors > 0}
                    <span class="text-danger">{stats.errors} errors</span>
                  {/if}
                {:else}
                  {stats}
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else if job.result.imported}
        <div class="grid grid-3 gap-2">
          {#each Object.entries(job.result.imported) as [key, stats]}
            <div class="stat">
              <div class="stat-label">{key}</div>
              <div class="stat-value">
                {#if typeof stats === 'object' && stats !== null}
                  <span class="text-success">{stats.imported || 0} imported</span>
                  {#if stats.errors > 0}
                    <span class="text-danger">{stats.errors} errors</span>
                  {/if}
                {:else}
                  {stats}
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .job-progress {
    padding: 1rem;
    background: white;
    border: 1px solid var(--gray-200);
    border-radius: 0.5rem;
  }

  .status-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    margin-left: 0.5rem;
  }

  .status-pending {
    background: var(--gray-200);
    color: var(--gray-700);
  }

  .status-running {
    background: #dbeafe;
    color: var(--primary);
  }

  .status-completed {
    background: #d1fae5;
    color: var(--success);
  }

  .status-failed {
    background: #fee2e2;
    color: var(--danger);
  }

  .result-summary {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--gray-200);
  }

  .stat {
    padding: 0.75rem;
    background: var(--gray-50);
    border-radius: 0.375rem;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--gray-600);
    text-transform: capitalize;
    margin-bottom: 0.25rem;
  }

  .stat-value {
    font-size: 1rem;
    font-weight: 600;
    color: var(--gray-900);
  }

  .text-success {
    color: var(--success);
  }

  .text-danger {
    color: var(--danger);
  }
</style>
