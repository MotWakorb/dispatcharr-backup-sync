import { describe, it, expect } from 'vitest';
import {
  AppError,
  AuthError,
  ValidationError,
  NotFoundError,
  NetworkError,
  JobError,
  isAxiosError,
  isAppError,
  isError,
  getErrorMessage,
  getErrorStatusCode,
  toNetworkError,
  formatErrorForLogging,
} from '../../types/errors.js';

describe('Error Types', () => {
  describe('AppError', () => {
    it('should create an error with correct properties', () => {
      const error = new AppError('Test error', 'TEST_ERROR', 400, { foo: 'bar' });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ foo: 'bar' });
      expect(error.name).toBe('AppError');
    });

    it('should use default status code of 500', () => {
      const error = new AppError('Test error', 'TEST_ERROR');

      expect(error.statusCode).toBe(500);
    });

    it('should serialize to JSON correctly', () => {
      const error = new AppError('Test error', 'TEST_ERROR', 400, { foo: 'bar' });
      const json = error.toJSON();

      expect(json).toEqual({
        name: 'AppError',
        message: 'Test error',
        code: 'TEST_ERROR',
        statusCode: 400,
        details: { foo: 'bar' },
      });
    });
  });

  describe('AuthError', () => {
    it('should create with correct code and status', () => {
      const error = new AuthError('Invalid credentials');

      expect(error.code).toBe('AUTH_ERROR');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('AuthError');
    });

    it('should accept details', () => {
      const error = new AuthError('Invalid credentials', { username: 'test' });

      expect(error.details).toEqual({ username: 'test' });
    });
  });

  describe('ValidationError', () => {
    it('should create with correct code and status', () => {
      const error = new ValidationError('Invalid input');

      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('ValidationError');
    });
  });

  describe('NotFoundError', () => {
    it('should create with correct code and status', () => {
      const error = new NotFoundError('Resource not found');

      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('NotFoundError');
    });
  });

  describe('NetworkError', () => {
    it('should create with correct properties', () => {
      const originalError = new Error('Connection failed');
      const error = new NetworkError('Request failed', {
        originalError,
        responseStatus: 503,
        responseData: { error: 'Service unavailable' },
      });

      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.statusCode).toBe(503);
      expect(error.originalError).toBe(originalError);
      expect(error.responseStatus).toBe(503);
      expect(error.responseData).toEqual({ error: 'Service unavailable' });
    });

    it('should default to 502 status code', () => {
      const error = new NetworkError('Request failed');

      expect(error.statusCode).toBe(502);
    });
  });

  describe('JobError', () => {
    it('should create with job context', () => {
      const error = new JobError('Job failed', {
        jobId: '123',
        phase: 'export',
      });

      expect(error.code).toBe('JOB_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.jobId).toBe('123');
      expect(error.phase).toBe('export');
    });
  });
});

describe('Type Guards', () => {
  describe('isAxiosError', () => {
    it('should return true for axios-like errors', () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 400 },
      };

      expect(isAxiosError(axiosError)).toBe(true);
    });

    it('should return false for regular errors', () => {
      expect(isAxiosError(new Error('test'))).toBe(false);
      expect(isAxiosError(null)).toBe(false);
      expect(isAxiosError(undefined)).toBe(false);
      expect(isAxiosError('string')).toBe(false);
    });
  });

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      expect(isAppError(new AppError('test', 'TEST'))).toBe(true);
      expect(isAppError(new AuthError('test'))).toBe(true);
      expect(isAppError(new ValidationError('test'))).toBe(true);
    });

    it('should return false for regular errors', () => {
      expect(isAppError(new Error('test'))).toBe(false);
      expect(isAppError(null)).toBe(false);
    });
  });

  describe('isError', () => {
    it('should return true for Error instances', () => {
      expect(isError(new Error('test'))).toBe(true);
      expect(isError(new AppError('test', 'TEST'))).toBe(true);
    });

    it('should return false for non-errors', () => {
      expect(isError('string')).toBe(false);
      expect(isError(null)).toBe(false);
      expect(isError({})).toBe(false);
    });
  });
});

describe('Helper Functions', () => {
  describe('getErrorMessage', () => {
    it('should extract message from AppError', () => {
      expect(getErrorMessage(new AppError('App error', 'TEST'))).toBe('App error');
    });

    it('should extract message from regular Error', () => {
      expect(getErrorMessage(new Error('Regular error'))).toBe('Regular error');
    });

    it('should return string directly', () => {
      expect(getErrorMessage('String error')).toBe('String error');
    });

    it('should handle axios errors with response data', () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          data: { detail: 'Server error detail' },
        },
      };

      expect(getErrorMessage(axiosError)).toBe('Server error detail');
    });

    it('should return default message for unknown types', () => {
      expect(getErrorMessage(null)).toBe('An unknown error occurred');
      expect(getErrorMessage(undefined)).toBe('An unknown error occurred');
      expect(getErrorMessage(123)).toBe('An unknown error occurred');
    });
  });

  describe('getErrorStatusCode', () => {
    it('should return status code from AppError', () => {
      expect(getErrorStatusCode(new AuthError('test'))).toBe(401);
      expect(getErrorStatusCode(new NotFoundError('test'))).toBe(404);
    });

    it('should return status from axios error', () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 503 },
      };

      expect(getErrorStatusCode(axiosError)).toBe(503);
    });

    it('should default to 500', () => {
      expect(getErrorStatusCode(new Error('test'))).toBe(500);
      expect(getErrorStatusCode(null)).toBe(500);
    });
  });

  describe('toNetworkError', () => {
    it('should convert regular error to NetworkError', () => {
      const original = new Error('Connection failed');
      const result = toNetworkError(original, 'API call');

      expect(result).toBeInstanceOf(NetworkError);
      expect(result.message).toBe('API call: Connection failed');
      expect(result.originalError).toBe(original);
    });

    it('should convert axios error with response info', () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 404,
          data: { error: 'Not found' },
        },
      };

      const result = toNetworkError(axiosError);

      expect(result.responseStatus).toBe(404);
      expect(result.responseData).toEqual({ error: 'Not found' });
    });
  });

  describe('formatErrorForLogging', () => {
    it('should format AppError for logging', () => {
      const error = new AuthError('Auth failed', { username: 'test' });
      const result = formatErrorForLogging(error);

      expect(result.message).toBe('Auth failed');
      expect(result.type).toBe('AuthError');
      expect(result.code).toBe('AUTH_ERROR');
      expect(result.statusCode).toBe(401);
      expect(result.details).toEqual({ username: 'test' });
    });

    it('should format axios error for logging', () => {
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        config: { url: '/api/test', method: 'get' },
        response: {
          status: 500,
          data: { error: 'Server error' },
        },
        stack: 'Error: test\n  at line1\n  at line2\n  at line3\n  at line4',
      };

      const result = formatErrorForLogging(axiosError);

      expect(result.status).toBe(500);
      expect(result.url).toBe('/api/test');
      expect(result.method).toBe('GET');
    });

    it('should truncate long response data', () => {
      const longData = 'x'.repeat(600);
      const axiosError = {
        isAxiosError: true,
        message: 'Request failed',
        response: {
          status: 500,
          data: longData,
        },
      };

      const result = formatErrorForLogging(axiosError);

      expect((result.responseData as string).length).toBeLessThan(510);
      expect((result.responseData as string).endsWith('...')).toBe(true);
    });
  });
});
