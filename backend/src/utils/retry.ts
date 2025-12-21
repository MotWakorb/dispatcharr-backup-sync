import { createLogger } from '../services/logger.js';

const log = createLogger('retry');

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Exponential backoff factor (default: 2) */
  backoffFactor?: number;
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
  /** Function to determine if error is retryable (default: retries on network errors) */
  isRetryable?: (error: unknown) => boolean;
  /** Optional callback before each retry */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Operation name for logging */
  operationName?: string;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'operationName'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitter: true,
  isRetryable: isNetworkError,
};

/**
 * Default function to determine if an error is retryable.
 * Retries on network errors, timeouts, and 5xx server errors.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;

  // Check for Axios error structure
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;

    // Network errors (no response received)
    if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return true;
    }

    // Axios network error
    if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
      return true;
    }

    // Timeout errors
    if (err.code === 'ECONNABORTED' || (err.message as string)?.includes('timeout')) {
      return true;
    }

    // Check HTTP status codes
    const response = err.response as Record<string, unknown> | undefined;
    if (response) {
      const status = response.status as number | undefined;
      // Retry on 5xx server errors and 429 rate limiting
      if (status && (status >= 500 || status === 429)) {
        return true;
      }
      // Don't retry on 4xx client errors (except 429)
      if (status && status >= 400 && status < 500) {
        return false;
      }
    }

    // If no response at all, it's likely a network error
    if ('isAxiosError' in err && err.isAxiosError && !response) {
      return true;
    }
  }

  // Check error message for common network issues
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffFactor: number,
  jitter: boolean
): number {
  // Exponential backoff: initialDelay * (factor ^ attempt)
  let delay = initialDelayMs * Math.pow(backoffFactor, attempt);

  // Cap at max delay
  delay = Math.min(delay, maxDelayMs);

  // Add jitter (0-50% of delay) to prevent thundering herd
  if (jitter) {
    const jitterAmount = delay * 0.5 * Math.random();
    delay += jitterAmount;
  }

  return Math.floor(delay);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with exponential backoff retry.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function if successful
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchData(url),
 *   { maxRetries: 3, operationName: 'fetchData' }
 * );
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { maxRetries, initialDelayMs, maxDelayMs, backoffFactor, jitter, isRetryable, onRetry } =
    opts;
  const operationName = options.operationName || 'operation';

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxRetries) {
        log.error(
          { operationName, attempt, maxRetries, err: error },
          'All retry attempts exhausted'
        );
        throw error;
      }

      if (!isRetryable(error)) {
        log.debug({ operationName, err: error }, 'Error is not retryable');
        throw error;
      }

      // Calculate delay for next attempt
      const delayMs = calculateDelay(attempt, initialDelayMs, maxDelayMs, backoffFactor, jitter);

      log.warn(
        { operationName, attempt: attempt + 1, maxRetries, delayMs },
        'Retrying after error'
      );

      // Call optional retry callback
      if (onRetry) {
        onRetry(error, attempt + 1, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable version of an async function.
 *
 * @param fn - The async function to wrap
 * @param options - Retry configuration options
 * @returns A new function that will retry on failure
 *
 * @example
 * ```typescript
 * const retryableFetch = retryable(
 *   (url: string) => fetch(url),
 *   { maxRetries: 3 }
 * );
 * const result = await retryableFetch('https://api.example.com');
 * ```
 */
export function retryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}
