/**
 * Type-safe error handling utilities.
 *
 * These utilities help extract error messages from unknown error types
 * without using `any`, maintaining TypeScript's type safety.
 */

/**
 * Safely extracts an error message from an unknown error type.
 *
 * Handles common error patterns:
 * - Standard Error objects with .message
 * - Axios-style errors with .response.data.error or .response.data.detail
 * - String errors
 * - Objects with .message property
 *
 * @param error - The caught error (unknown type)
 * @param fallback - Optional fallback message if no message can be extracted
 * @returns The extracted error message or the fallback
 */
export function getErrorMessage(error: unknown, fallback = 'An unexpected error occurred'): string {
  // Handle null/undefined
  if (error == null) {
    return fallback;
  }

  // Handle string errors
  if (typeof error === 'string') {
    return error;
  }

  // Handle Error objects and axios-style errors
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;

    // Check for axios-style response errors first
    if (e.response && typeof e.response === 'object') {
      const response = e.response as Record<string, unknown>;
      if (response.data && typeof response.data === 'object') {
        const data = response.data as Record<string, unknown>;
        if (typeof data.error === 'string') return data.error;
        if (typeof data.detail === 'string') return data.detail;
        if (typeof data.message === 'string') return data.message;
      }
    }

    // Check for standard Error.message
    if (typeof e.message === 'string') {
      return e.message;
    }

    // Check for error property
    if (typeof e.error === 'string') {
      return e.error;
    }
  }

  return fallback;
}

/**
 * Type guard to check if an error has a specific property.
 */
export function hasProperty<K extends string>(error: unknown, key: K): error is Record<K, unknown> {
  return error != null && typeof error === 'object' && key in error;
}

/**
 * Type guard to check if an error is an axios-style error with response.
 */
export function isAxiosError(error: unknown): error is {
  response?: {
    status?: number;
    statusText?: string;
    data?: unknown;
  };
  message?: string;
  config?: unknown;
} {
  return hasProperty(error, 'response') || hasProperty(error, 'config');
}

/**
 * Extracts HTTP status code from an axios-style error.
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (isAxiosError(error) && error.response) {
    return error.response.status;
  }
  return undefined;
}

/**
 * Type guard to check if error indicates cancellation.
 */
export function isCancelledError(error: unknown): boolean {
  if (hasProperty(error, 'cancelled')) {
    return error.cancelled === true;
  }
  return false;
}
