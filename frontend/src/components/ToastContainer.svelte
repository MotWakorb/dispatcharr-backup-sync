<script lang="ts">
  import { toasts, toastStore } from '../stores/toastStore';
  import type { Toast } from '../stores/toastStore';

  function getAriaLive(type: Toast['type']): 'assertive' | 'polite' {
    return type === 'error' ? 'assertive' : 'polite';
  }
</script>

<div class="toast-container" aria-live="polite" aria-label="Notifications">
  {#each $toasts as toast (toast.id)}
    <div
      class="toast toast-{toast.type}"
      role="alert"
      aria-live={getAriaLive(toast.type)}
    >
      <span class="toast-message">{toast.message}</span>
      {#if toast.dismissible}
        <button
          class="toast-close"
          on:click={() => toastStore.dismiss(toast.id)}
          aria-label="Dismiss notification"
        >
          &times;
        </button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: min(400px, calc(100vw - 2rem));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-size: 0.875rem;
    animation: slideIn 0.2s ease-out;
    pointer-events: auto;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .toast-success {
    background: var(--bg-success, #d4edda);
    color: var(--text-success, #155724);
    border: 1px solid var(--success, #28a745);
  }

  .toast-error {
    background: var(--bg-error, #f8d7da);
    color: var(--text-error, #721c24);
    border: 1px solid var(--danger, #dc3545);
  }

  .toast-warning {
    background: var(--bg-warning, #fff3cd);
    color: var(--text-warning, #856404);
    border: 1px solid var(--warning, #ffc107);
  }

  .toast-info {
    background: var(--bg-info, #d1ecf1);
    color: var(--text-info, #0c5460);
    border: 1px solid var(--info, #17a2b8);
  }

  .toast-message {
    flex: 1;
    word-break: break-word;
  }

  .toast-close {
    background: none;
    border: none;
    font-size: 1.25rem;
    cursor: pointer;
    opacity: 0.7;
    padding: 0;
    line-height: 1;
    color: inherit;
    flex-shrink: 0;
  }

  .toast-close:hover {
    opacity: 1;
  }

  /* Mobile responsiveness */
  @media (max-width: 480px) {
    .toast-container {
      left: 1rem;
      right: 1rem;
      max-width: none;
    }
  }
</style>
