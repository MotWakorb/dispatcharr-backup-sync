<script lang="ts">
  import { onMount } from 'svelte';
  import { toastStore } from '../stores/toastStore';

  export let fallbackMessage = 'Something went wrong';
  export let showRetry = true;
  export let onRetry: (() => void) | undefined = undefined;

  let hasError = false;
  let errorMessage = '';
  let errorStack = '';

  // In Svelte, we use the onError lifecycle hook via window.onerror
  // This is a simplified error boundary pattern
  onMount(() => {
    const originalOnError = window.onerror;

    window.onerror = (message, source, lineno, colno, error) => {
      // Only catch errors from our app
      if (source && source.includes('/src/')) {
        hasError = true;
        errorMessage = typeof message === 'string' ? message : 'An unexpected error occurred';
        errorStack = error?.stack || '';
        toastStore.error('An unexpected error occurred. Please try refreshing the page.');
        console.error('ErrorBoundary caught:', { message, source, lineno, colno, error });
      }

      // Call original handler if exists
      if (originalOnError) {
        return originalOnError(message, source, lineno, colno, error);
      }
      return false;
    };

    // Handle unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      hasError = true;
      errorMessage = event.reason?.message || 'An unexpected error occurred';
      errorStack = event.reason?.stack || '';
      toastStore.error('An unexpected error occurred. Please try refreshing the page.');
      console.error('ErrorBoundary caught unhandled rejection:', event.reason);
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.onerror = originalOnError;
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  });

  function handleRetry() {
    hasError = false;
    errorMessage = '';
    errorStack = '';
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  }

  function handleDismiss() {
    hasError = false;
    errorMessage = '';
    errorStack = '';
  }
</script>

{#if hasError}
  <div class="error-boundary">
    <div class="error-content">
      <div class="error-icon">⚠️</div>
      <h2>{fallbackMessage}</h2>
      <p class="error-message">{errorMessage}</p>
      {#if import.meta.env.DEV && errorStack}
        <details class="error-details">
          <summary>Technical Details</summary>
          <pre>{errorStack}</pre>
        </details>
      {/if}
      <div class="error-actions">
        {#if showRetry}
          <button class="btn btn-primary" on:click={handleRetry}>
            {onRetry ? 'Try Again' : 'Refresh Page'}
          </button>
        {/if}
        <button class="btn btn-secondary" on:click={handleDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  </div>
{:else}
  <slot />
{/if}

<style>
  .error-boundary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    padding: 2rem;
  }

  .error-content {
    text-align: center;
    max-width: 500px;
  }

  .error-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .error-content h2 {
    color: var(--error-color, #dc2626);
    margin-bottom: 0.5rem;
  }

  .error-message {
    color: var(--text-secondary, #6b7280);
    margin-bottom: 1rem;
  }

  .error-details {
    text-align: left;
    background: var(--bg-secondary, #1f2937);
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .error-details summary {
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
    margin-bottom: 0.5rem;
  }

  .error-details pre {
    font-size: 0.75rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--error-color, #dc2626);
    margin: 0;
  }

  .error-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }
</style>
