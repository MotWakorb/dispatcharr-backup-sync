<script lang="ts">
  export let error: string;
  export let title = 'Error';
  export let showRetry = false;
  export let onRetry: (() => void) | undefined = undefined;
  export let compact = false;
</script>

<div class="error-display" class:compact role="alert" aria-live="assertive">
  <div class="error-icon" aria-hidden="true">
    {#if compact}
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    {/if}
  </div>
  <div class="error-content">
    {#if !compact}
      <h3 class="error-title">{title}</h3>
    {/if}
    <p class="error-message">{error}</p>
  </div>
  {#if showRetry && onRetry}
    <button class="btn btn-secondary btn-sm" on:click={onRetry}>
      Retry
    </button>
  {/if}
</div>

<style>
  .error-display {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--error-bg, rgba(220, 38, 38, 0.1));
    border: 1px solid var(--error-border, rgba(220, 38, 38, 0.3));
    border-radius: 0.5rem;
    color: var(--error-text, #fca5a5);
  }

  .error-display.compact {
    padding: 0.5rem 0.75rem;
    align-items: center;
  }

  .error-icon {
    flex-shrink: 0;
    color: var(--error-color, #dc2626);
  }

  .error-content {
    flex: 1;
    min-width: 0;
  }

  .error-title {
    margin: 0 0 0.25rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--error-color, #dc2626);
  }

  .compact .error-title {
    display: none;
  }

  .error-message {
    margin: 0;
    font-size: 0.875rem;
    color: var(--error-text, #fca5a5);
    word-break: break-word;
  }

  .compact .error-message {
    font-size: 0.8125rem;
  }

  .btn-sm {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    flex-shrink: 0;
  }
</style>
