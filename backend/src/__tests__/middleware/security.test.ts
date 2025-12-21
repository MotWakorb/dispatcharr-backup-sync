import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import {
  securityHeadersMiddleware,
  sanitizeRequestMiddleware,
  PAYLOAD_LIMITS,
} from '../../middleware/security.js';

// Helper to create mock request
function createMockRequest(overrides = {}): Partial<Request> {
  return {
    body: {},
    query: {},
    path: '/',
    ...overrides,
  };
}

// Helper to create mock response
function createMockResponse(): Partial<Response> {
  const res: Partial<Response> = {
    setHeader: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('Security Middleware', () => {
  describe('securityHeadersMiddleware', () => {
    it('should set X-Frame-Options header', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      securityHeadersMiddleware(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    });

    it('should set X-Content-Type-Options header', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      securityHeadersMiddleware(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    });

    it('should set X-XSS-Protection header', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      securityHeadersMiddleware(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
    });

    it('should set Referrer-Policy header', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      securityHeadersMiddleware(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Referrer-Policy',
        'strict-origin-when-cross-origin'
      );
    });

    it('should set Content-Security-Policy header', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      securityHeadersMiddleware(req as Request, res as Response, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        expect.stringContaining("default-src 'self'")
      );
    });

    it('should call next()', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      securityHeadersMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('sanitizeRequestMiddleware', () => {
    it('should remove null bytes from body strings', () => {
      const req = createMockRequest({
        body: {
          name: 'test\x00value',
          nested: {
            field: 'nested\x00null',
          },
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      sanitizeRequestMiddleware(req as Request, res as Response, next);

      expect(req.body.name).toBe('testvalue');
      expect(req.body.nested.field).toBe('nestednull');
    });

    it('should remove control characters from body strings', () => {
      const req = createMockRequest({
        body: {
          name: 'test\x01\x02\x03value\x1F',
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      sanitizeRequestMiddleware(req as Request, res as Response, next);

      expect(req.body.name).toBe('testvalue');
    });

    it('should preserve newlines and tabs', () => {
      const req = createMockRequest({
        body: {
          text: 'line1\nline2\ttabbed',
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      sanitizeRequestMiddleware(req as Request, res as Response, next);

      expect(req.body.text).toBe('line1\nline2\ttabbed');
    });

    it('should sanitize query parameters', () => {
      const req = createMockRequest({
        query: {
          search: 'test\x00query',
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      sanitizeRequestMiddleware(req as Request, res as Response, next);

      expect(req.query.search).toBe('testquery');
    });

    it('should handle non-string values', () => {
      const req = createMockRequest({
        body: {
          count: 42,
          enabled: true,
          items: ['a', 'b'],
          data: null,
        },
      });
      const res = createMockResponse();
      const next = vi.fn();

      sanitizeRequestMiddleware(req as Request, res as Response, next);

      expect(req.body.count).toBe(42);
      expect(req.body.enabled).toBe(true);
    });

    it('should handle empty body', () => {
      const req = createMockRequest({ body: {} });
      const res = createMockResponse();
      const next = vi.fn();

      sanitizeRequestMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('should call next()', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      sanitizeRequestMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('PAYLOAD_LIMITS', () => {
    it('should have correct default limit', () => {
      expect(PAYLOAD_LIMITS.default).toBe('1mb');
    });

    it('should have correct importExport limit', () => {
      expect(PAYLOAD_LIMITS.importExport).toBe('500mb');
    });

    it('should have correct plugins limit', () => {
      expect(PAYLOAD_LIMITS.plugins).toBe('100mb');
    });

    it('should have correct logos limit', () => {
      expect(PAYLOAD_LIMITS.logos).toBe('50mb');
    });
  });
});
