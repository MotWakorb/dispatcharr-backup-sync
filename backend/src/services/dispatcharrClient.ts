import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import type { DispatcharrConnection, TestConnectionResponse } from '../types/index.js';
import { createLogger } from './logger.js';
import { HTTP_TIMEOUT_MS } from '../constants.js';

const log = createLogger('http-client');

// Redaction utility to prevent logging sensitive data
const SENSITIVE_KEYS =
  /password|passwd|pass|token|secret|apikey|api_key|api-key|auth|authorization|credential|bearer|jwt|session|cookie/i;

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

// Environment variable to allow private/internal URLs (for self-hosted/Docker setups)
const ALLOW_PRIVATE_URLS = process.env.ALLOW_PRIVATE_URLS === 'true';

/**
 * Validates a URL to prevent SSRF attacks.
 * Blocks internal/private IP ranges, localhost, and non-HTTP(S) protocols.
 * Set ALLOW_PRIVATE_URLS=true environment variable to allow private network access
 * (useful for self-hosted Docker setups).
 */
function validateUrl(urlString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  // Only allow HTTP and HTTPS protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid protocol: ${parsed.protocol} - only HTTP and HTTPS are allowed`);
  }

  // Skip private IP checks if explicitly allowed (for self-hosted/Docker setups)
  if (ALLOW_PRIVATE_URLS) {
    log.debug({ url: urlString }, 'Skipping private URL validation (ALLOW_PRIVATE_URLS=true)');
    return;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new Error('Localhost URLs are not allowed (set ALLOW_PRIVATE_URLS=true to enable)');
  }

  // Block private IP ranges (RFC 1918)
  // 10.0.0.0 - 10.255.255.255
  // 172.16.0.0 - 172.31.255.255
  // 192.168.0.0 - 192.168.255.255
  // 169.254.0.0 - 169.254.255.255 (link-local)
  // 0.0.0.0
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);

    // 0.0.0.0
    if (a === 0 && b === 0 && c === 0 && d === 0) {
      throw new Error('Invalid IP address: 0.0.0.0');
    }

    // 10.x.x.x
    if (a === 10) {
      throw new Error(
        'Private IP addresses (10.x.x.x) are not allowed (set ALLOW_PRIVATE_URLS=true to enable)'
      );
    }

    // 172.16.0.0 - 172.31.255.255
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error(
        'Private IP addresses (172.16-31.x.x) are not allowed (set ALLOW_PRIVATE_URLS=true to enable)'
      );
    }

    // 192.168.x.x
    if (a === 192 && b === 168) {
      throw new Error(
        'Private IP addresses (192.168.x.x) are not allowed (set ALLOW_PRIVATE_URLS=true to enable)'
      );
    }

    // 169.254.x.x (link-local)
    if (a === 169 && b === 254) {
      throw new Error(
        'Link-local IP addresses (169.254.x.x) are not allowed (set ALLOW_PRIVATE_URLS=true to enable)'
      );
    }

    // 127.x.x.x (loopback)
    if (a === 127) {
      throw new Error(
        'Loopback IP addresses (127.x.x.x) are not allowed (set ALLOW_PRIVATE_URLS=true to enable)'
      );
    }
  }

  // Block IPv6 private/local addresses
  if (hostname.startsWith('[')) {
    const ipv6 = hostname.slice(1, -1).toLowerCase();
    // ::1 (loopback)
    if (ipv6 === '::1') {
      throw new Error(
        'IPv6 loopback address is not allowed (set ALLOW_PRIVATE_URLS=true to enable)'
      );
    }
    // fe80:: (link-local)
    if (ipv6.startsWith('fe80:')) {
      throw new Error(
        'IPv6 link-local addresses are not allowed (set ALLOW_PRIVATE_URLS=true to enable)'
      );
    }
    // fc00:: and fd00:: (unique local)
    if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) {
      throw new Error(
        'IPv6 unique local addresses are not allowed (set ALLOW_PRIVATE_URLS=true to enable)'
      );
    }
  }

  // Block common internal hostnames (cloud metadata endpoints - always blocked)
  const blockedHostnames = ['metadata', 'metadata.google.internal', '169.254.169.254'];
  if (blockedHostnames.includes(hostname)) {
    throw new Error(`Blocked hostname: ${hostname} (cloud metadata endpoint)`);
  }
}

export class DispatcharrClient {
  private client: AxiosInstance;
  private token: string | null = null;
  private authenticated: boolean = false;
  private csrfToken: string | null = null;
  private cookieJar: CookieJar;

  constructor(private connection: DispatcharrConnection) {
    // Validate URL to prevent SSRF attacks
    validateUrl(connection.url);

    this.cookieJar = new CookieJar();
    this.client = wrapper(
      axios.create({
        baseURL: connection.url,
        timeout: HTTP_TIMEOUT_MS, // allow large imports
        // Do not force Content-Type globally; set per-request so form uploads work
        headers: {
          Accept: 'application/json',
        },
        jar: this.cookieJar,
        withCredentials: true, // Enable cookies for session-based auth
      })
    );
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

      log.error(
        {
          url: this.connection.url,
          username: this.connection.username,
          statusCode,
          error: errorMsg,
          fullError: redactObject(errorData),
        },
        'Authentication error'
      );

      const authError: any = new Error(
        `Authentication failed (${statusCode || 'unknown'}): ${errorMsg}`
      );
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
        ? config.params || config.responseType || config.headers
          ? config
          : { params: config }
        : undefined;
      const response = await this.client.get(endpoint, axiosConfig);
      log.debug({ endpoint, status: response.status }, 'GET response');
      return response.data ?? response;
    } catch (error: any) {
      log.error(
        {
          endpoint,
          status: error.response?.status,
          data: safeStringify(error.response?.data, 500),
        },
        'GET failed'
      );
      if (error.response?.status === 401) {
        // Token expired, re-authenticate
        this.authenticated = false;
        await this.authenticate();
        // Retry with new token
        const axiosConfig = config
          ? config.params || config.responseType || config.headers
            ? config
            : { params: config }
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
      log.error(
        {
          endpoint,
          status: error.response?.status,
          data: safeStringify(error.response?.data, 500),
        },
        'POST failed'
      );
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
      log.error(
        {
          endpoint,
          status: error.response?.status,
          data: safeStringify(error.response?.data, 500),
        },
        'PATCH failed'
      );
      throw error;
    }
  }

  async testConnection(): Promise<TestConnectionResponse> {
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
      const message =
        status === 401
          ? 'Unknown username or password.'
          : error.message || error?.response?.data?.detail || 'Connection failed';
      return {
        success: false,
        message,
      };
    }
  }
}
