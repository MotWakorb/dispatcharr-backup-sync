import { createLogger } from '../services/logger.js';

const log = createLogger('env-validation');

interface EnvVarConfig {
  name: string;
  required?: boolean;
  default?: string;
  validate?: (value: string) => boolean;
  validationError?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Environment variable configurations with validation rules
 */
const ENV_CONFIGS: EnvVarConfig[] = [
  // Server configuration
  {
    name: 'PORT',
    required: false,
    default: '3001',
    validate: (v) => {
      const port = parseInt(v, 10);
      return !isNaN(port) && port > 0 && port <= 65535;
    },
    validationError: 'PORT must be a valid port number (1-65535)',
  },
  {
    name: 'NODE_ENV',
    required: false,
    default: 'development',
    validate: (v) => ['development', 'production', 'test'].includes(v),
    validationError: 'NODE_ENV must be development, production, or test',
  },

  // Data storage
  {
    name: 'DATA_DIR',
    required: false,
    default: '/tmp/dispatcharr-manager',
  },

  // Logging
  {
    name: 'LOG_LEVEL',
    required: false,
    validate: (v) => ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(v),
    validationError: 'LOG_LEVEL must be trace, debug, info, warn, error, or fatal',
  },
  {
    name: 'LOG_PRETTY',
    required: false,
    validate: (v) => ['true', 'false'].includes(v),
    validationError: 'LOG_PRETTY must be true or false',
  },

  // CORS configuration
  {
    name: 'CORS_ALLOWED_ORIGINS',
    required: false,
  },
  {
    name: 'CORS_ALLOW_ALL',
    required: false,
    validate: (v) => ['true', 'false'].includes(v),
    validationError: 'CORS_ALLOW_ALL must be true or false',
  },

  // Security
  {
    name: 'ALLOW_PRIVATE_URLS',
    required: false,
    validate: (v) => ['true', 'false'].includes(v),
    validationError: 'ALLOW_PRIVATE_URLS must be true or false',
  },

  // Default connection credentials (optional)
  {
    name: 'DEFAULT_PROD_URL',
    required: false,
    validate: (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
    validationError: 'DEFAULT_PROD_URL must be a valid URL',
  },
  {
    name: 'DEFAULT_DEV_URL',
    required: false,
    validate: (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    },
    validationError: 'DEFAULT_DEV_URL must be a valid URL',
  },
  {
    name: 'DEFAULT_USERNAME',
    required: false,
  },
  {
    name: 'DEFAULT_PASSWORD',
    required: false,
  },

  // Timezone
  {
    name: 'TZ',
    required: false,
    validate: (v) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: v });
        return true;
      } catch {
        return false;
      }
    },
    validationError: 'TZ must be a valid IANA timezone (e.g., America/New_York)',
  },

  // App version (for Docker/CI builds)
  {
    name: 'APP_VERSION',
    required: false,
  },
];

/**
 * Validates all environment variables at startup
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const config of ENV_CONFIGS) {
    const value = process.env[config.name];

    // Check required variables
    if (config.required && !value) {
      errors.push(`Missing required environment variable: ${config.name}`);
      continue;
    }

    // Skip validation if not set and not required
    if (!value) {
      continue;
    }

    // Run custom validation if provided
    if (config.validate && !config.validate(value)) {
      errors.push(`Invalid ${config.name}: ${config.validationError || 'validation failed'}`);
    }
  }

  // Log related environment variable dependencies
  if (process.env.DEFAULT_PROD_URL && !process.env.DEFAULT_USERNAME) {
    warnings.push('DEFAULT_PROD_URL is set but DEFAULT_USERNAME is missing');
  }
  if (process.env.DEFAULT_DEV_URL && !process.env.DEFAULT_USERNAME) {
    warnings.push('DEFAULT_DEV_URL is set but DEFAULT_USERNAME is missing');
  }
  if (process.env.DEFAULT_USERNAME && !process.env.DEFAULT_PASSWORD) {
    warnings.push('DEFAULT_USERNAME is set but DEFAULT_PASSWORD is missing');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates environment and logs results.
 * Throws an error if validation fails in production mode.
 */
export function validateAndLogEnvironment(): void {
  const result = validateEnvironment();
  const isProduction = process.env.NODE_ENV === 'production';

  // Log warnings
  for (const warning of result.warnings) {
    log.warn(warning);
  }

  // Log errors
  for (const error of result.errors) {
    log.error(error);
  }

  if (!result.valid) {
    const message = `Environment validation failed with ${result.errors.length} error(s)`;
    if (isProduction) {
      log.fatal(message);
      throw new Error(message);
    } else {
      log.warn(`${message} (continuing in ${process.env.NODE_ENV || 'development'} mode)`);
    }
  } else {
    log.info('Environment validation passed');
  }
}

/**
 * Get environment variable with type coercion
 */
export function getEnvString(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export function getEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function getEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}
