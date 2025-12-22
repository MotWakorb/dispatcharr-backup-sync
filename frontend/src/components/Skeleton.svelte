<script lang="ts">
  /**
   * Skeleton loading component for placeholder content
   * Usage:
   *   <Skeleton /> - default line skeleton
   *   <Skeleton variant="card" /> - card placeholder
   *   <Skeleton variant="table-row" columns={5} /> - table row placeholder
   *   <Skeleton variant="list" items={3} /> - list with multiple items
   */
  export let variant: 'line' | 'card' | 'table-row' | 'list' | 'badge' = 'line';
  export let width: string = '100%';
  export let height: string = variant === 'card' ? '6rem' : '1rem';
  export let columns: number = 5;
  export let items: number = 3;
</script>

{#if variant === 'line'}
  <div class="skeleton skeleton-line" style="width: {width}; height: {height}"></div>
{:else if variant === 'badge'}
  <div class="skeleton skeleton-badge"></div>
{:else if variant === 'card'}
  <div class="skeleton skeleton-card" style="height: {height}">
    <div class="skeleton-line" style="width: 40%; height: 1.25rem"></div>
    <div class="skeleton-line" style="width: 70%; height: 0.875rem; margin-top: 0.5rem"></div>
    <div class="skeleton-line" style="width: 50%; height: 0.875rem; margin-top: 0.25rem"></div>
  </div>
{:else if variant === 'table-row'}
  <tr class="skeleton-row">
    {#each Array(columns) as _, i}
      <td>
        <div class="skeleton skeleton-line" style="width: {i === 0 ? '60%' : i === columns - 1 ? '50%' : '80%'}; height: 0.875rem"></div>
      </td>
    {/each}
  </tr>
{:else if variant === 'list'}
  <div class="skeleton-list">
    {#each Array(items) as _}
      <div class="skeleton-list-item">
        <div class="skeleton skeleton-line" style="width: 30%; height: 1rem"></div>
        <div class="skeleton skeleton-line" style="width: 60%; height: 0.875rem; margin-top: 0.25rem"></div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .skeleton {
    background: linear-gradient(
      90deg,
      var(--skeleton-base, #e2e8f0) 0%,
      var(--skeleton-shine, #f8fafc) 50%,
      var(--skeleton-base, #e2e8f0) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite ease-in-out;
    border-radius: 0.25rem;
  }

  :global([data-theme='dark']) .skeleton {
    --skeleton-base: #374151;
    --skeleton-shine: #4b5563;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .skeleton-line {
    display: block;
  }

  .skeleton-badge {
    display: inline-block;
    width: 4.5rem;
    height: 1.5rem;
    border-radius: 0.5rem;
  }

  .skeleton-card {
    padding: 1rem;
    border-radius: 0.5rem;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
  }

  .skeleton-card .skeleton-line {
    background: linear-gradient(
      90deg,
      var(--skeleton-base, #e2e8f0) 0%,
      var(--skeleton-shine, #f8fafc) 50%,
      var(--skeleton-base, #e2e8f0) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite ease-in-out;
    border-radius: 0.25rem;
  }

  :global([data-theme='dark']) .skeleton-card .skeleton-line {
    --skeleton-base: #374151;
    --skeleton-shine: #4b5563;
  }

  .skeleton-row td {
    padding: 0.75rem;
    border-bottom: 1px solid var(--border-color);
  }

  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .skeleton-list-item {
    padding: 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: 0.375rem;
    background: var(--bg-card);
  }
</style>
