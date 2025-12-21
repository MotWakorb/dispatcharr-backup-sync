import { AxiosError } from 'axios';

/**
 * Base application error with proper typing
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

/**
 * Authentication/authorization errors
 */
export class AuthError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AUTH_ERROR', 401, details);
    this.name = 'AuthError';
  }
}

/**
 * Validation errors
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Not found errors
 */
export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, details);
    this.name = 'NotFoundError';
  }
}

/**
 * Network/API errors
 */
export class NetworkError extends AppError {
  public readonly originalError?: Error;
  public readonly responseStatus?: number;
  public readonly responseData?: unknown;

  constructor(
    message: string,
    options?: {
      originalError?: Error;
      responseStatus?: number;
      responseData?: unknown;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, 'NETWORK_ERROR', options?.responseStatus || 502, options?.details);
    this.name = 'NetworkError';
    this.originalError = options?.originalError;
    this.responseStatus = options?.responseStatus;
    this.responseData = options?.responseData;
  }
}

/**
 * Job execution errors
 */
export class JobError extends AppError {
  public readonly jobId?: string;
  public readonly phase?: string;

  constructor(
    message: string,
    options?: {
      jobId?: string;
      phase?: string;
      details?: Record<string, unknown>;
    }
  ) {
    super(message, 'JOB_ERROR', 500, options?.details);
    this.name = 'JobError';
    this.jobId = options?.jobId;
    this.phase = options?.phase;
  }
}

/**
 * Type guard to check if an error is an AxiosError
 */
export function isAxiosError(error: unknown): error is AxiosError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'isAxiosError' in error &&
    (error as AxiosError).isAxiosError === true
  );
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard to check if something is an Error
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.message;
  }
  if (isAxiosError(error)) {
    const responseData = error.response?.data;
    if (responseData && typeof responseData === 'object') {
      const data = responseData as Record<string, unknown>;
      if (typeof data.detail === 'string') return data.detail;
      if (typeof data.message === 'string') return data.message;
      if (typeof data.error === 'string') return data.error;
    }
    return error.message;
  }
  if (isError(error)) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}

/**
 * Extract status code from unknown error
 */
export function getErrorStatusCode(error: unknown): number {
  if (isAppError(error)) {
    return error.statusCode;
  }
  if (isAxiosError(error)) {
    return error.response?.status || 500;
  }
  return 500;
}

/**
 * Convert any error to a NetworkError with proper context
 */
export function toNetworkError(error: unknown, context?: string): NetworkError {
  const message = context ? `${context}: ${getErrorMessage(error)}` : getErrorMessage(error);

  if (isAxiosError(error)) {
    return new NetworkError(message, {
      originalError: error,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    });
  }

  if (isError(error)) {
    return new NetworkError(message, {
      originalError: error,
    });
  }

  return new NetworkError(message);
}

/**
 * Format error details for logging (truncates long values)
 */
export function formatErrorForLogging(error: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {
    message: getErrorMessage(error),
    type: error?.constructor?.name || typeof error,
  };

  if (isAppError(error)) {
    result.code = error.code;
    result.statusCode = error.statusCode;
    if (error.details) {
      result.details = error.details;
    }
  }

  if (isAxiosError(error)) {
    result.status = error.response?.status;
    result.url = error.config?.url;
    result.method = error.config?.method?.toUpperCase();

    // Truncate response data if too long
    const responseData = error.response?.data;
    if (responseData) {
      const dataStr =
        typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
      result.responseData = dataStr.length > 500 ? dataStr.substring(0, 500) + '...' : responseData;
    }
  }

  if (isError(error) && error.stack) {
    // Only include first 3 lines of stack trace
    result.stack = error.stack.split('\n').slice(0, 4).join('\n');
  }

  return result;
}
