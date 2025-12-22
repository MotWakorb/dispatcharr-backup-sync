<script lang="ts">
  import type { JobStatus } from '../types';

  export let job: JobStatus;

  $: progressDisplay = job.progress !== undefined
    ? Math.round(job.progress)
    : undefined;

  const statValue = (value: unknown, key: string): unknown => {
    if (value && typeof value === 'object' && key in value) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  };
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
        class:status-completed-warnings={job.status === 'completed_with_warnings'}
        class:status-failed={job.status === 'failed'}
        class:status-cancelled={job.status === 'cancelled'}
      >
        {job.status === 'completed_with_warnings' ? 'completed with warnings' : job.status}
      </span>
    </div>
    {#if progressDisplay !== undefined}
      <span class="text-sm text-gray">{progressDisplay}%</span>
    {/if}
  </div>

  {#if progressDisplay !== undefined}
    <div class="progress-bar mb-2">
      <div class="progress-fill" style="width: {progressDisplay}%"></div>
    </div>
  {/if}

  {#if job.message}
    <p class="text-sm text-gray mb-1">{job.message}</p>
  {/if}

  {#if job.warnings && job.warnings.length > 0}
    <div class="alert alert-warning">
      <strong>{job.warnings.length} Warning(s):</strong>
      <ul class="warnings-list">
        {#each job.warnings.slice(0, 5) as warning}
          <li>{warning}</li>
        {/each}
        {#if job.warnings.length > 5}
          <li class="text-sm text-muted">...and {job.warnings.length - 5} more</li>
        {/if}
      </ul>
    </div>
  {/if}

  {#if job.error}
    <div class="alert alert-error">
      {job.error}
    </div>
  {/if}

  {#if (job.status === 'completed' || job.status === 'completed_with_warnings') && job.result}
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
                  <span class="text-success">{statValue(stats, 'synced') || 0} synced</span>
                  {#if (statValue(stats, 'errors') || 0) > 0}
                    <span class="text-danger">{statValue(stats, 'errors')} errors</span>
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
                  <span class="text-success">{statValue(stats, 'imported') || 0} imported</span>
                  {#if (statValue(stats, 'errors') || 0) > 0}
                    <span class="text-danger">{statValue(stats, 'errors')} errors</span>
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
    background: var(--bg-card);
    border: 1px solid var(--border-color);
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
    background: var(--border-color);
    color: var(--text-secondary);
  }

  .status-running {
    background: var(--bg-info);
    color: var(--primary);
  }

  .status-completed {
    background: var(--bg-success);
    color: var(--success);
  }

  .status-completed-warnings {
    background: var(--bg-warning, #fef3c7);
    color: var(--warning, #d97706);
  }

  .status-failed {
    background: var(--bg-error);
    color: var(--danger);
  }

  .status-cancelled {
    background: var(--border-color);
    color: var(--text-secondary);
  }

  .result-summary {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
  }

  .stat {
    padding: 0.75rem;
    background: var(--bg-hover);
    border-radius: 0.375rem;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-transform: capitalize;
    margin-bottom: 0.25rem;
  }

  .stat-value {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .text-success {
    color: var(--success);
  }

  .text-danger {
    color: var(--danger);
  }

  .alert-warning {
    background: var(--bg-warning, #fef3c7);
    color: var(--warning, #d97706);
    padding: 0.75rem 1rem;
    border-radius: 0.375rem;
    border: 1px solid var(--warning, #d97706);
    margin-bottom: 0.5rem;
  }

  .warnings-list {
    margin: 0.5rem 0 0 0;
    padding-left: 1.25rem;
    font-size: 0.875rem;
  }

  .warnings-list li {
    margin-bottom: 0.25rem;
  }

  .text-muted {
    color: var(--text-muted, #6b7280);
    font-style: italic;
  }
</style>
