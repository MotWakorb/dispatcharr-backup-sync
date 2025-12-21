import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

// Header name for correlation ID (standard X-Request-ID or X-Correlation-ID)
export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';

// Async local storage for correlation context
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export interface CorrelationContext {
  correlationId: string;
  requestId: string;
  startTime: number;
}

/**
 * Get the current correlation context from async local storage
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/**
 * Get just the correlation ID (convenience function)
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

/**
 * Get just the request ID (convenience function)
 */
export function getRequestId(): string | undefined {
  return correlationStorage.getStore()?.requestId;
}

/**
 * Run a function within a correlation context
 */
export function runWithCorrelation<T>(context: CorrelationContext, fn: () => T): T {
  return correlationStorage.run(context, fn);
}

/**
 * Middleware that adds correlation IDs to requests for distributed tracing.
 *
 * - Extracts or generates a correlation ID for each request
 * - Stores it in async local storage for access throughout the request lifecycle
 * - Adds it to response headers for client-side tracing
 * - Adds it to req object for easy access in routes
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Extract correlation ID from incoming request or generate new one
  // Check both common header names
  const incomingCorrelationId =
    (req.headers[CORRELATION_ID_HEADER] as string) ||
    (req.headers[REQUEST_ID_HEADER] as string) ||
    undefined;

  // Always generate a unique request ID for this specific request
  const requestId = randomUUID();

  // Use incoming correlation ID or generate new one
  // Correlation ID tracks a flow across multiple services
  // Request ID is unique to this specific request
  const correlationId = incomingCorrelationId || requestId;

  const context: CorrelationContext = {
    correlationId,
    requestId,
    startTime: Date.now(),
  };

  // Add to response headers for client-side tracing
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  res.setHeader(REQUEST_ID_HEADER, requestId);

  // Also add to request object for easy access in routes
  (req as any).correlationId = correlationId;
  (req as any).requestId = requestId;

  // Run the rest of the middleware chain within the correlation context
  correlationStorage.run(context, () => {
    next();
  });
}

// Extend Express Request type to include correlation IDs

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
      requestId?: string;
    }
  }
}
