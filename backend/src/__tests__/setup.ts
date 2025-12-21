import { vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// Test data directory
export const TEST_DATA_DIR = '/tmp/dispatcharr-test-' + process.pid;

// Setup test environment
beforeEach(() => {
  // Create test data directory
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  // Set environment variable for tests
  process.env.DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  // Clean up test data directory
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  // Clear all mocks
  vi.clearAllMocks();
});

// Helper to create mock DispatcharrConnection
export function createMockConnection(overrides = {}) {
  return {
    url: 'http://localhost:8000',
    username: 'testuser',
    password: 'testpass',
    ...overrides,
  };
}

// Helper to create mock job status
export function createMockJobStatus(overrides = {}) {
  return {
    jobId: '20231215120000',
    status: 'pending' as const,
    progress: 0,
    startedAt: new Date(),
    ...overrides,
  };
}

// Helper to wait for async operations
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
