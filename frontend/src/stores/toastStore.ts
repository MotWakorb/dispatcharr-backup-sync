import { writable, derived } from 'svelte/store';
import { TOAST_TIMEOUT_MS } from '../constants';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  dismissible: boolean;
  createdAt: number;
}

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
  dismissible?: boolean;
}

// Internal store state
interface ToastState {
  toasts: Toast[];
  timeouts: Map<string, number>;
}

function createToastStore() {
  const { subscribe, update } = writable<ToastState>({
    toasts: [],
    timeouts: new Map(),
  });

  // Generate unique ID for each toast
  let idCounter = 0;
  function generateId(): string {
    return `toast-${Date.now()}-${++idCounter}`;
  }

  // Add a new toast
  function add(message: string, options: ToastOptions = {}): string {
    const id = generateId();
    const toast: Toast = {
      id,
      message,
      type: options.type ?? 'info',
      duration: options.duration ?? TOAST_TIMEOUT_MS,
      dismissible: options.dismissible ?? true,
      createdAt: Date.now(),
    };

    update((state) => {
      // Add the new toast
      const newToasts = [...state.toasts, toast];

      // Set up auto-dismiss timeout if duration > 0
      const newTimeouts = new Map(state.timeouts);
      if (toast.duration > 0) {
        const timeoutId = window.setTimeout(() => {
          dismiss(id);
        }, toast.duration);
        newTimeouts.set(id, timeoutId);
      }

      return {
        toasts: newToasts,
        timeouts: newTimeouts,
      };
    });

    return id;
  }

  // Dismiss a specific toast
  function dismiss(id: string): void {
    update((state) => {
      // Clear the timeout if it exists
      const timeoutId = state.timeouts.get(id);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      // Remove toast and timeout entry
      const newTimeouts = new Map(state.timeouts);
      newTimeouts.delete(id);

      return {
        toasts: state.toasts.filter((t) => t.id !== id),
        timeouts: newTimeouts,
      };
    });
  }

  // Dismiss all toasts
  function dismissAll(): void {
    update((state) => {
      // Clear all timeouts
      state.timeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });

      return {
        toasts: [],
        timeouts: new Map(),
      };
    });
  }

  // Convenience methods for different toast types
  function success(message: string, options: Omit<ToastOptions, 'type'> = {}): string {
    return add(message, { ...options, type: 'success' });
  }

  function error(message: string, options: Omit<ToastOptions, 'type'> = {}): string {
    // Errors stay longer by default
    return add(message, { duration: TOAST_TIMEOUT_MS * 2, ...options, type: 'error' });
  }

  function warning(message: string, options: Omit<ToastOptions, 'type'> = {}): string {
    return add(message, { ...options, type: 'warning' });
  }

  function info(message: string, options: Omit<ToastOptions, 'type'> = {}): string {
    return add(message, { ...options, type: 'info' });
  }

  return {
    subscribe,
    add,
    dismiss,
    dismissAll,
    success,
    error,
    warning,
    info,
  };
}

// Export the store instance
export const toastStore = createToastStore();

// Derived store that just exposes the toasts array for easier consumption
export const toasts = derived(toastStore, ($state) => $state.toasts);
