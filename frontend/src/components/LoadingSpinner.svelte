<script lang="ts">
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let message = '';
  export let inline = false;
  export let centered = true;
</script>

<div
  class="loading-spinner"
  class:inline
  class:centered
  class:size-sm={size === 'sm'}
  class:size-md={size === 'md'}
  class:size-lg={size === 'lg'}
  role="status"
  aria-live="polite"
>
  <div class="spinner" aria-hidden="true"></div>
  {#if message}
    <span class="loading-message">{message}</span>
  {/if}
  <span class="sr-only">Loading...</span>
</div>

<style>
  .loading-spinner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .loading-spinner.inline {
    flex-direction: row;
  }

  .loading-spinner.centered {
    justify-content: center;
    padding: 2rem;
  }

  .spinner {
    border-radius: 50%;
    border-style: solid;
    border-color: var(--spinner-track, rgba(255, 255, 255, 0.2));
    border-top-color: var(--spinner-color, var(--primary-color, #3b82f6));
    animation: spin 0.8s linear infinite;
  }

  .size-sm .spinner {
    width: 1rem;
    height: 1rem;
    border-width: 2px;
  }

  .size-md .spinner {
    width: 1.5rem;
    height: 1.5rem;
    border-width: 2px;
  }

  .size-lg .spinner {
    width: 2.5rem;
    height: 2.5rem;
    border-width: 3px;
  }

  .loading-message {
    color: var(--text-secondary, #9ca3af);
    font-size: 0.875rem;
  }

  .size-sm .loading-message {
    font-size: 0.75rem;
  }

  .size-lg .loading-message {
    font-size: 1rem;
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

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
