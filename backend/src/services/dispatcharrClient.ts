import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import type { DispatcharrConnection } from '../types/index.js';
import { createLogger } from './logger.js';

const log = createLogger('http-client');

// Redaction utility to prevent logging sensitive data
const SENSITIVE_KEYS = /password|passwd|pass|token|secret|apikey|api_key|api-key|auth|authorization|credential|bearer|jwt|session|cookie/i;

function redactObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const clone: any = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(key)) {
      clone[key] = '***redacted***';
    } else if (typeof value === 'object') {
      clone[key] = redactObject(value);
    } else if (typeof value === 'string') {
      clone[key] = redactString(value);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

function redactString(str: string): string {
  if (str.startsWith('{') || str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      return JSON.stringify(redactObject(parsed));
    } catch {
      // Not valid JSON, continue with string redaction
    }
  }
  return str.replace(
    /(password|passwd|pass|token|secret|apikey|api_key|api-key|authorization|bearer|jwt)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    '$1$2***redacted***'
  );
}

function safeStringify(data: any, maxLen = 200): string {
  if (data === undefined || data === null) return String(data);
  const redacted = typeof data === 'object' ? redactObject(data) : redactString(String(data));
  const str = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

export class DispatcharrClient {
  private client: AxiosInstance;
  private token: string | null = null;
  private authenticated: boolean = false;
  private csrfToken: string | null = null;
  private cookieJar: CookieJar;

  constructor(private connection: DispatcharrConnection) {
    this.cookieJar = new CookieJar();
    this.client = wrapper(axios.create({
      baseURL: connection.url,
      timeout: 120000, // allow large imports
      // Do not force Content-Type globally; set per-request so form uploads work
      headers: {
        Accept: 'application/json',
      },
      jar: this.cookieJar,
      withCredentials: true, // Enable cookies for session-based auth
    }));
  }

  async authenticate(): Promise<string> {
    try {
      // Use JWT token endpoint for API authentication
      const response = await this.client.post('/api/accounts/token/', {
        username: this.connection.username,
        password: this.connection.password,
      });

      log.debug('Token response received');

      // Get JWT access token
      this.token = response.data.access;

      if (!this.token) {
        throw new Error('No access token received from server');
      }

      log.debug({ tokenLength: this.token.length }, 'JWT token received');

      // Set authorization header for JWT-based auth
      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;

      this.authenticated = true;
      return this.token;
    } catch (error: any) {
      const statusCode = error.response?.status;
      const errorData = error.response?.data;
      const errorMsg = errorData?.detail || errorData?.message || error.message;

      log.error({
        url: this.connection.url,
        username: this.connection.username,
        statusCode,
        error: errorMsg,
        fullError: redactObject(errorData)
      }, 'Authentication error');

      const authError: any = new Error(`Authentication failed (${statusCode || 'unknown'}): ${errorMsg}`);
      authError.status = statusCode;
      authError.code = statusCode;
      throw authError;
    }
  }

  async get<T = any>(endpoint: string, config?: any): Promise<T> {
    if (!this.authenticated) {
      await this.authenticate();
    }

    try {
      log.debug({ endpoint }, 'Making GET request');
      const axiosConfig = config
        ? (config.params || config.responseType || config.headers ? config : { params: config })
        : undefined;
      const response = await this.client.get(endpoint, axiosConfig);
      log.debug({ endpoint, status: response.status }, 'GET response');
      return response.data ?? response;
    } catch (error: any) {
      log.error({ endpoint, status: error.response?.status, data: safeStringify(error.response?.data, 500) }, 'GET failed');
      if (error.response?.status === 401) {
        // Token expired, re-authenticate
        this.authenticated = false;
        await this.authenticate();
        // Retry with new token
        const axiosConfig = config
          ? (config.params || config.responseType || config.headers ? config : { params: config })
          : undefined;
        const response = await this.client.get(endpoint, axiosConfig);
        return response.data ?? response;
      }
      throw error;
    }
  }

  async post<T = any>(endpoint: string, data?: any, config?: any): Promise<T> {
    if (!this.authenticated) {
      await this.authenticate();
    }

    try {
      log.debug({ endpoint }, 'Making POST request');
      if (data !== undefined) {
        log.debug({ endpoint, payload: safeStringify(data) }, 'POST payload');
      }
      const response = await this.client.post(endpoint, data, config);
      log.debug({ endpoint, status: response.status }, 'POST response');
      return response.data;
    } catch (error: any) {
      log.error({ endpoint, status: error.response?.status, data: safeStringify(error.response?.data, 500) }, 'POST failed');
      if (error.response?.status === 401) {
        this.authenticated = false;
        await this.authenticate();
        const response = await this.client.post(endpoint, data, config);
        return response.data;
      }
      throw error;
    }
  }

  async put<T = any>(endpoint: string, data?: any): Promise<T> {
    if (!this.authenticated) {
      await this.authenticate();
    }

    try {
      const response = await this.client.put(endpoint, data);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.authenticated = false;
        await this.authenticate();
        const response = await this.client.put(endpoint, data);
        return response.data;
      }
      throw error;
    }
  }

  async delete<T = any>(endpoint: string, data?: any): Promise<T> {
    if (!this.authenticated) {
      await this.authenticate();
    }

    try {
      const config = data ? { data } : undefined;
      const response = await this.client.delete(endpoint, config);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.authenticated = false;
        await this.authenticate();
        const config = data ? { data } : undefined;
        const response = await this.client.delete(endpoint, config);
        return response.data;
      }
      throw error;
    }
  }

  async patch<T = any>(endpoint: string, data?: any, config?: any): Promise<T> {
    if (!this.authenticated) {
      await this.authenticate();
    }

    try {
      log.debug({ endpoint }, 'Making PATCH request');
      log.debug({ endpoint, payload: safeStringify(data, 500) }, 'PATCH payload');
      const response = await this.client.patch(endpoint, data, config);
      log.debug({ endpoint, status: response.status }, 'PATCH response');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.authenticated = false;
        await this.authenticate();
        const response = await this.client.patch(endpoint, data, config);
        log.debug({ endpoint, status: response.status }, 'PATCH response after re-auth');
        return response.data;
      }
      log.error({ endpoint, status: error.response?.status, data: safeStringify(error.response?.data, 500) }, 'PATCH failed');
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; version?: string }> {
    try {
      log.debug({ url: this.connection.url }, 'Testing connection');
      await this.authenticate();
      log.debug('Authentication successful');

      // Test API access with a simple endpoint
      await this.get('/api/accounts/users/me/');

      return {
        success: true,
        message: 'Connection successful!',
        version: 'Dispatcharr',
      };
    } catch (error: any) {
      log.error({ err: error }, 'Test connection failed');
      const status = error?.status || error?.code || error?.response?.status;
      const message = status === 401
        ? 'Unknown username or password.'
        : (error.message || error?.response?.data?.detail || 'Connection failed');
      return {
        success: false,
        message,
      };
    }
  }
}
