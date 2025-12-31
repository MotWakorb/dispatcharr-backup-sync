import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createLogger } from '../services/logger.js';

const log = createLogger('security');

// ============ CORS Configuration ============

// Get allowed origins from environment or use defaults for development
const getAllowedOrigins = (): string[] => {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map((origin) => origin.trim());
  }
  // Default: allow same-origin and common development ports
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173', // Vite dev server
    'http://localhost:6002', // Docker compose frontend
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:6002',
  ];
};

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();

    // Allow requests with no origin (same-origin, Postman, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is allowed
    if (allowedOrigins.includes(origin) || process.env.CORS_ALLOW_ALL === 'true') {
      return callback(null, true);
    }

    log.warn({ origin }, 'CORS request blocked from unauthorized origin');
    callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400, // 24 hours
});

// ============ Rate Limiting ============
//
// Rate Limit Headers (automatically added via standardHeaders: true):
// - RateLimit-Limit: Maximum requests allowed in the window
// - RateLimit-Remaining: Remaining requests in the current window
// - RateLimit-Reset: Unix timestamp when the rate limit resets
//
// Rate Limit Tiers:
// 1. General API: 500 requests per 15 minutes (most endpoints)
// 2. Authentication: 50 requests per 15 minutes (connection testing)
// 3. Job Creation: 10 requests per 1 minute (export/import/sync)
// 4. File Uploads: 5 requests per 1 minute

/**
 * General API rate limiter.
 * Applies to most endpoints.
 * Limit: 500 requests per 15 minutes per IP.
 */
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    if (req.path === '/health') return true;
    // Skip rate limiting for job status polling (high-frequency during imports/exports)
    if (req.path.startsWith('/api/jobs/') && req.method === 'GET') return true;
    return false;
  },
  handler: (req, res, _next, options) => {
    log.warn({ ip: req.ip, path: req.path, method: req.method }, 'General rate limit exceeded');
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * Authentication rate limiter.
 * Applies to connection testing and authentication endpoints.
 * Limit: 50 requests per 15 minutes per IP.
 * Stricter to prevent brute force attacks.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 auth attempts per windowMs
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    log.warn(
      { ip: req.ip, path: req.path },
      'Auth rate limit exceeded - possible brute force attempt'
    );
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * Job creation rate limiter.
 * Applies to export, import, and sync endpoints.
 * Limit: 30 requests per 1 minute per IP.
 * Prevents resource exhaustion from too many concurrent jobs.
 */
export const jobCreationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 job creations per minute
  message: {
    success: false,
    error: 'Too many job requests, please wait before starting new jobs',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    log.warn({ ip: req.ip, path: req.path }, 'Job creation rate limit exceeded');
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * File upload rate limiter.
 * Applies to import file upload endpoints.
 * Limit: 5 requests per 1 minute per IP.
 * Prevents storage exhaustion from excessive uploads.
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 uploads per minute
  message: {
    success: false,
    error: 'Too many upload requests, please wait before uploading again',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    log.warn({ ip: req.ip, path: req.path }, 'Upload rate limit exceeded');
    res.status(options.statusCode).json(options.message);
  },
});

// ============ Payload Size Configuration ============

// Payload limits by route type (in bytes)
export const PAYLOAD_LIMITS = {
  // Small JSON payloads for configuration
  default: '1mb',

  // Larger limits for file operations
  importExport: '500mb',

  // Plugin uploads
  plugins: '100mb',

  // Logos/images
  logos: '50mb',
} as const;

// ============ Security Headers ============

export const securityHeadersMiddleware = (_req: Request, res: Response, next: NextFunction) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy (adjust as needed for your frontend)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'"
  );

  next();
};

// ============ Request Sanitization ============

export const sanitizeRequestMiddleware = (req: Request, _res: Response, next: NextFunction) => {
  // Remove any null bytes from string values in body
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }

  // Remove any null bytes from query params
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query as Record<string, unknown>);
  }

  next();
};

function sanitizeObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string') {
      // Remove null bytes and control characters (except newlines and tabs)
      obj[key] = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    } else if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
      sanitizeObject(value as Record<string, unknown>);
    }
  }
}
