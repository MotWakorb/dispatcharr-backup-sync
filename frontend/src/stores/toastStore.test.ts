import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toastStore, toasts, type Toast } from './toastStore';
import { get } from 'svelte/store';

describe('toastStore', () => {
  beforeEach(() => {
    // Clear all toasts before each test
    toastStore.dismissAll();
    // Clear any mock timers
    vi.clearAllTimers();
  });

  describe('add', () => {
    it('should add a toast with default options', () => {
      const id = toastStore.add('Test message');
      const state = get(toastStore);

      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0].message).toBe('Test message');
      expect(state.toasts[0].type).toBe('info');
      expect(state.toasts[0].dismissible).toBe(true);
      expect(state.toasts[0].id).toBe(id);
    });

    it('should add a toast with custom options', () => {
      const id = toastStore.add('Custom toast', {
        type: 'error',
        duration: 5000,
        dismissible: false,
      });

      const state = get(toastStore);
      expect(state.toasts[0].type).toBe('error');
      expect(state.toasts[0].duration).toBe(5000);
      expect(state.toasts[0].dismissible).toBe(false);
    });
  });

  describe('convenience methods', () => {
    it('should create a success toast', () => {
      toastStore.success('Success message');
      const state = get(toastStore);

      expect(state.toasts[0].type).toBe('success');
      expect(state.toasts[0].message).toBe('Success message');
    });

    it('should create an error toast with longer duration', () => {
      toastStore.error('Error message');
      const state = get(toastStore);

      expect(state.toasts[0].type).toBe('error');
      expect(state.toasts[0].message).toBe('Error message');
      // Error toasts have double the default duration
      expect(state.toasts[0].duration).toBeGreaterThan(0);
    });

    it('should create a warning toast', () => {
      toastStore.warning('Warning message');
      const state = get(toastStore);

      expect(state.toasts[0].type).toBe('warning');
      expect(state.toasts[0].message).toBe('Warning message');
    });

    it('should create an info toast', () => {
      toastStore.info('Info message');
      const state = get(toastStore);

      expect(state.toasts[0].type).toBe('info');
      expect(state.toasts[0].message).toBe('Info message');
    });
  });

  describe('dismiss', () => {
    it('should dismiss a specific toast', () => {
      const id1 = toastStore.add('Toast 1');
      const id2 = toastStore.add('Toast 2');

      let state = get(toastStore);
      expect(state.toasts).toHaveLength(2);

      toastStore.dismiss(id1);

      state = get(toastStore);
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0].id).toBe(id2);
    });

    it('should handle dismissing non-existent toast', () => {
      toastStore.add('Toast 1');
      toastStore.dismiss('non-existent-id');

      const state = get(toastStore);
      expect(state.toasts).toHaveLength(1);
    });
  });

  describe('dismissAll', () => {
    it('should dismiss all toasts', () => {
      toastStore.add('Toast 1');
      toastStore.add('Toast 2');
      toastStore.add('Toast 3');

      let state = get(toastStore);
      expect(state.toasts).toHaveLength(3);

      toastStore.dismissAll();

      state = get(toastStore);
      expect(state.toasts).toHaveLength(0);
    });
  });

  describe('toasts derived store', () => {
    it('should provide a derived store with just the toasts array', () => {
      toastStore.add('Toast 1');
      toastStore.add('Toast 2');

      const toastList = get(toasts);
      expect(toastList).toHaveLength(2);
      expect(toastList[0].message).toBe('Toast 1');
      expect(toastList[1].message).toBe('Toast 2');
    });
  });
});
