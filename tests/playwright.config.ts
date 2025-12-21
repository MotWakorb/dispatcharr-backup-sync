import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run tests sequentially for workflow tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for sequential workflow tests
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 60000, // 60s timeout for longer operations
  expect: {
    timeout: 10000, // 10s for assertions
  },

  use: {
    baseURL: process.env.TARGET_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Web server configuration for local development
  webServer: process.env.CI
    ? undefined
    : {
        command: 'cd ../frontend && npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
