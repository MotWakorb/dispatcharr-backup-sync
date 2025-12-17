import { vi } from 'vitest';
import type { JobStatus } from '../src/types/index.js';

/**
 * Test helper utilities for service tests
 */

/**
 * Mock job manager for testing services
 */
export interface MockJobManager {
  createJob: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
  updateJob: ReturnType<typeof vi.fn>;
  startJob: ReturnType<typeof vi.fn>;
  completeJob: ReturnType<typeof vi.fn>;
  failJob: ReturnType<typeof vi.fn>;
  cancelJob: ReturnType<typeof vi.fn>;
  setProgress: ReturnType<typeof vi.fn>;
  addLog: ReturnType<typeof vi.fn>;
  getLogs: ReturnType<typeof vi.fn>;
  getAllJobs: ReturnType<typeof vi.fn>;
  getHistory: ReturnType<typeof vi.fn>;
  clearHistory: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  /** Access recorded logs for assertions */
  logs: string[];
  /** Access recorded progress updates */
  progressUpdates: Array<{ jobId: string; progress: number; message?: string }>;
  /** Get current job status */
  currentStatus: JobStatus | null;
  /** Reset all mocks and recorded data */
  reset: () => void;
}

/**
 * Creates a mock job manager for testing
 */
export function createMockJobManager(initialJobId: string = 'test-job-123'): MockJobManager {
  const logs: string[] = [];
  const progressUpdates: Array<{ jobId: string; progress: number; message?: string }> = [];

  // Use an object to hold status so we can update it via reference
  const state = {
    currentStatus: {
      jobId: initialJobId,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
    } as JobStatus | null,
  };

  const mockJobManager: MockJobManager = {
    logs,
    progressUpdates,
    // Use getter to always return current state
    get currentStatus() {
      return state.currentStatus;
    },
    set currentStatus(value: JobStatus | null) {
      state.currentStatus = value;
    },

    createJob: vi.fn().mockImplementation((jobType?: string) => {
      state.currentStatus = {
        jobId: initialJobId,
        status: 'pending',
        jobType,
        progress: 0,
        startedAt: new Date(),
      };
      return initialJobId;
    }),

    getJob: vi.fn().mockImplementation((jobId: string) => {
      if (jobId === initialJobId || jobId === state.currentStatus?.jobId) {
        return state.currentStatus;
      }
      return undefined;
    }),

    updateJob: vi.fn().mockImplementation((jobId: string, updates: Partial<JobStatus>) => {
      if (state.currentStatus && jobId === state.currentStatus.jobId) {
        state.currentStatus = { ...state.currentStatus, ...updates };
      }
    }),

    startJob: vi.fn().mockImplementation((jobId: string, message?: string) => {
      if (state.currentStatus && jobId === state.currentStatus.jobId) {
        state.currentStatus = { ...state.currentStatus, status: 'running', message, progress: 0 };
      }
    }),

    completeJob: vi.fn().mockImplementation((jobId: string, result?: any) => {
      if (state.currentStatus && jobId === state.currentStatus.jobId) {
        state.currentStatus = {
          ...state.currentStatus,
          status: 'completed',
          progress: 100,
          result,
          completedAt: new Date(),
        };
      }
    }),

    failJob: vi.fn().mockImplementation((jobId: string, error: string) => {
      if (state.currentStatus && jobId === state.currentStatus.jobId) {
        state.currentStatus = {
          ...state.currentStatus,
          status: 'failed',
          error,
          completedAt: new Date(),
        };
      }
    }),

    cancelJob: vi.fn().mockImplementation((jobId: string, message?: string) => {
      if (state.currentStatus && jobId === state.currentStatus.jobId) {
        state.currentStatus = {
          ...state.currentStatus,
          status: 'cancelled',
          message: message || 'Cancelled by user',
          completedAt: new Date(),
        };
      }
    }),

    setProgress: vi.fn().mockImplementation((jobId: string, progress: number, message?: string) => {
      progressUpdates.push({ jobId, progress, message });
      if (state.currentStatus && jobId === state.currentStatus.jobId) {
        state.currentStatus = { ...state.currentStatus, progress, message };
      }
    }),

    addLog: vi.fn().mockImplementation((jobId: string, message: string) => {
      logs.push(message);
    }),

    getLogs: vi.fn().mockImplementation(() => {
      return logs.map((message) => ({
        timestamp: new Date().toISOString(),
        message,
      }));
    }),

    getAllJobs: vi.fn().mockReturnValue([]),
    getHistory: vi.fn().mockReturnValue([]),
    clearHistory: vi.fn(),
    shutdown: vi.fn(),

    reset: () => {
      logs.length = 0;
      progressUpdates.length = 0;
      state.currentStatus = {
        jobId: initialJobId,
        status: 'pending',
        progress: 0,
        startedAt: new Date(),
      };
      mockJobManager.createJob.mockClear();
      mockJobManager.getJob.mockClear();
      mockJobManager.updateJob.mockClear();
      mockJobManager.startJob.mockClear();
      mockJobManager.completeJob.mockClear();
      mockJobManager.failJob.mockClear();
      mockJobManager.cancelJob.mockClear();
      mockJobManager.setProgress.mockClear();
      mockJobManager.addLog.mockClear();
      mockJobManager.getLogs.mockClear();
      mockJobManager.getAllJobs.mockClear();
      mockJobManager.getHistory.mockClear();
      mockJobManager.clearHistory.mockClear();
    },
  };

  return mockJobManager;
}

/**
 * Waits for a condition to be true, with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number; message?: string } = {}
): Promise<void> {
  const { timeout = 5000, interval = 50, message = 'Condition not met within timeout' } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await sleep(interval);
  }

  throw new Error(message);
}

/**
 * Simple sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a deferred promise for testing async flows
 */
export function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Suppresses console output during test execution
 */
export function suppressConsole(): { restore: () => void } {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    info: console.info,
  };

  console.log = vi.fn();
  console.warn = vi.fn();
  console.error = vi.fn();
  console.debug = vi.fn();
  console.info = vi.fn();

  return {
    restore: () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
      console.info = originalConsole.info;
    },
  };
}

/**
 * Creates a spy on module exports
 * Useful for mocking service dependencies
 */
export function createModuleSpy<T extends object>(module: T): {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? ReturnType<typeof vi.fn> : T[K];
} {
  const spy = {} as any;
  for (const key of Object.keys(module) as (keyof T)[]) {
    const value = module[key];
    if (typeof value === 'function') {
      spy[key] = vi.fn().mockImplementation(value as any);
    } else {
      spy[key] = value;
    }
  }
  return spy;
}

/**
 * Asserts that a function was called with matching partial arguments
 */
export function expectCalledWithPartial(
  mockFn: ReturnType<typeof vi.fn>,
  partialArgs: Record<string, unknown>
): void {
  const calls = mockFn.mock.calls;
  const matchingCall = calls.find((call) => {
    const arg = call[0];
    if (typeof arg !== 'object' || arg === null) return false;
    return Object.entries(partialArgs).every(([key, value]) => arg[key] === value);
  });

  if (!matchingCall) {
    throw new Error(
      `Expected mock to be called with partial args ${JSON.stringify(partialArgs)}, ` +
        `but was called with: ${JSON.stringify(calls)}`
    );
  }
}

/**
 * Captures all logs added to a mock job manager
 */
export function captureJobLogs(mockJobManager: MockJobManager): string[] {
  return mockJobManager.logs;
}

/**
 * Asserts that logs contain a specific message (partial match)
 */
export function expectLogContains(mockJobManager: MockJobManager, substring: string): void {
  const logs = mockJobManager.logs;
  const found = logs.some((log) => log.includes(substring));
  if (!found) {
    throw new Error(
      `Expected logs to contain "${substring}", but logs were: ${JSON.stringify(logs)}`
    );
  }
}

/**
 * Asserts that the job progressed through expected stages
 */
export function expectProgressUpdates(
  mockJobManager: MockJobManager,
  expectedProgresses: number[]
): void {
  const actualProgresses = mockJobManager.progressUpdates.map((u) => u.progress);
  for (const expected of expectedProgresses) {
    if (!actualProgresses.includes(expected)) {
      throw new Error(
        `Expected progress to include ${expected}, but progress updates were: ${JSON.stringify(actualProgresses)}`
      );
    }
  }
}
