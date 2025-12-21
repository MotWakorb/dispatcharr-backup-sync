import pino, { Logger } from 'pino';

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const isDev = NODE_ENV !== 'production';
const isTest = NODE_ENV === 'test';

// Log level hierarchy: trace < debug < info < warn < error < fatal
// In production, default to 'info' to reduce noise
// In development, default to 'debug' for visibility
// In test, default to 'warn' to reduce test output noise
const DEFAULT_LEVELS: Record<string, string> = {
  production: 'info',
  development: 'debug',
  test: 'warn',
};

const logLevel = process.env.LOG_LEVEL || DEFAULT_LEVELS[NODE_ENV] || 'info';

// Determine if we should use pretty printing
// Can be disabled in dev with LOG_PRETTY=false for JSON output
const usePrettyPrint = isDev && process.env.LOG_PRETTY !== 'false' && !isTest;

export const logger = pino({
  level: logLevel,
  transport: usePrettyPrint
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          levelFirst: true,
        },
      }
    : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Redact sensitive fields from logs
  redact: {
    paths: ['password', 'token', 'apiKey', 'secret', 'authorization', '*.password', '*.token'],
    censor: '[REDACTED]',
  },
  // Add base context to all logs
  base: {
    env: NODE_ENV,
  },
});

// Log startup configuration (only in non-test)
if (!isTest) {
  logger.info({ logLevel, env: NODE_ENV, prettyPrint: usePrettyPrint }, 'Logger initialized');
}

/**
 * Create a child logger for a specific module
 * @param module - Module name for log context (e.g., 'sync', 'export', 'http-client')
 */
export const createLogger = (module: string): Logger => logger.child({ module });

/**
 * Helper to safely extract error details for logging
 * Handles various error types (Error, AxiosError, string, unknown)
 */
export function getLogErrorContext(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const context: Record<string, unknown> = {
      message: error.message,
      name: error.name,
      stack: isDev ? error.stack : undefined,
    };

    // Handle Axios errors
    if ('isAxiosError' in error && (error as any).isAxiosError) {
      const axiosError = error as any;
      context.status = axiosError.response?.status;
      context.statusText = axiosError.response?.statusText;
      context.url = axiosError.config?.url;
      context.method = axiosError.config?.method;
    }

    // Handle errors with cause
    if ('cause' in error && error.cause) {
      context.cause = getLogErrorContext(error.cause);
    }

    return context;
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  return { error: String(error) };
}

/**
 * Log level constants for use in conditional logging
 */
export const LOG_LEVELS = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
} as const;

/**
 * Check if a log level is enabled
 * Useful for expensive operations that should only run when logging is enabled
 */
export function isLevelEnabled(level: keyof typeof LOG_LEVELS): boolean {
  const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const currentLevelIndex = levels.indexOf(logLevel);
  const checkLevelIndex = levels.indexOf(LOG_LEVELS[level]);
  return checkLevelIndex >= currentLevelIndex;
}
