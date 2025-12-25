import { describe, it, expect } from 'vitest';
import { getErrorMessage, ERRORS, TOAST_TIMEOUT_MS } from './constants';

describe('constants', () => {
  describe('timing constants', () => {
    it('should have reasonable toast timeout', () => {
      expect(TOAST_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('ERRORS', () => {
    it('should have all required error messages', () => {
      expect(ERRORS.GENERIC).toBeDefined();
      expect(ERRORS.LOAD_JOBS).toBeDefined();
      expect(ERRORS.LOAD_HISTORY).toBeDefined();
      expect(ERRORS.CANCEL_JOB).toBeDefined();
    });
  });
});

describe('getErrorMessage', () => {
  it('should return fallback for null/undefined', () => {
    expect(getErrorMessage(null, 'Fallback')).toBe('Fallback');
    expect(getErrorMessage(undefined, 'Fallback')).toBe('Fallback');
  });

  it('should return fallback for primitive values', () => {
    expect(getErrorMessage('string error', 'Fallback')).toBe('Fallback');
    expect(getErrorMessage(123, 'Fallback')).toBe('Fallback');
  });

  it('should extract error from axios-style response', () => {
    const axiosError = {
      response: {
        data: {
          error: 'API error message',
        },
      },
    };
    expect(getErrorMessage(axiosError, 'Fallback')).toBe('API error message');
  });

  it('should extract detail from Django-style response', () => {
    const djangoError = {
      response: {
        data: {
          detail: 'Django detail message',
        },
      },
    };
    expect(getErrorMessage(djangoError, 'Fallback')).toBe('Django detail message');
  });

  it('should extract message from standard Error', () => {
    const standardError = new Error('Standard error message');
    expect(getErrorMessage(standardError, 'Fallback')).toBe('Standard error message');
  });

  it('should prefer error over detail over message', () => {
    const mixedError = {
      response: {
        data: {
          error: 'Error field',
          detail: 'Detail field',
        },
      },
      message: 'Message field',
    };
    expect(getErrorMessage(mixedError, 'Fallback')).toBe('Error field');
  });

  it('should handle empty response data', () => {
    const emptyResponse = {
      response: {
        data: {},
      },
    };
    expect(getErrorMessage(emptyResponse, 'Fallback')).toBe('Fallback');
  });

  it('should handle response without data', () => {
    const noData = {
      response: {},
    };
    expect(getErrorMessage(noData, 'Fallback')).toBe('Fallback');
  });
});
