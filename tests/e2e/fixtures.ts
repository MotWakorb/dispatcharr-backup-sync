import { test as base, expect } from '@playwright/test';

// Extend the base test with custom fixtures
export const test = base.extend<{
  backendUrl: string;
}>({
  backendUrl: [
    process.env.BACKEND_URL || 'http://localhost:3001',
    { option: true },
  ],
});

export { expect };

// Test data-testid selectors for consistent element selection
export const selectors = {
  // Tabs
  tabs: {
    sync: 'button:has-text("Sync")',
    backup: 'button:has-text("Backup")',
    restore: 'button:has-text("Restore")',
    settings: 'button:has-text("Settings")',
    schedules: 'button:has-text("Schedules")',
    notifications: 'button:has-text("Notifications")',
    jobs: 'button:has-text("Jobs")',
  },

  // Common elements
  loadingSpinner: '.loading-spinner',
  errorDisplay: '.error-display',
  toast: '.toast',

  // Forms
  formButton: (text: string) => `button:has-text("${text}")`,
  formInput: (label: string) => `input[placeholder*="${label}"], label:has-text("${label}") + input`,
};

// Helper functions for common operations
export async function waitForJobCompletion(
  page: ReturnType<typeof base.page>,
  timeout = 30000
): Promise<void> {
  // Wait for job progress to appear
  await page.waitForSelector('.job-progress, [class*="progress"]', {
    state: 'visible',
    timeout: 5000
  }).catch(() => {
    // Job might complete too quickly to see progress
  });

  // Wait for completion (success toast or progress disappears)
  await Promise.race([
    page.waitForSelector('.toast-success, [class*="success"]', { timeout }),
    page.waitForSelector('.job-progress, [class*="progress"]', {
      state: 'hidden',
      timeout
    }),
  ]);
}

export async function dismissToasts(page: ReturnType<typeof base.page>): Promise<void> {
  const toasts = await page.locator('.toast').all();
  for (const toast of toasts) {
    await toast.locator('button[aria-label*="close"], button[aria-label*="dismiss"]')
      .click()
      .catch(() => {
        // Toast might auto-dismiss
      });
  }
}
