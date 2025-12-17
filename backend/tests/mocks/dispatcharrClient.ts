import { vi } from 'vitest';
import type { DispatcharrConnection, TestConnectionResponse } from '../../src/types/index.js';

/**
 * Response handler type for mock client
 */
export type ResponseHandler = (endpoint: string, data?: any) => any | Promise<any>;

/**
 * Configuration for mock responses
 */
export interface MockResponseConfig {
  /** Map of endpoint patterns to response data or handlers */
  responses?: Record<string, any | ResponseHandler>;
  /** Default response for unmatched endpoints */
  defaultResponse?: any;
  /** Simulate authentication failure */
  authFailure?: boolean;
  /** Endpoints that should throw errors */
  errorEndpoints?: Record<string, Error | string>;
}

/**
 * Creates a paginated API response
 */
export function createPaginatedResponse<T>(
  results: T[],
  page: number = 1,
  pageSize: number = 100,
  hasNext: boolean = false
): { results: T[]; next: string | null; previous: string | null; count: number } {
  return {
    results,
    next: hasNext ? `?page=${page + 1}&page_size=${pageSize}` : null,
    previous: page > 1 ? `?page=${page - 1}&page_size=${pageSize}` : null,
    count: results.length,
  };
}

/**
 * Mock implementation of DispatcharrClient for testing
 */
export class MockDispatcharrClient {
  private config: MockResponseConfig;
  private authenticated = false;
  public connection: DispatcharrConnection;

  // Track calls for assertions
  public getCalls: Array<{ endpoint: string; config?: any }> = [];
  public postCalls: Array<{ endpoint: string; data?: any; config?: any }> = [];
  public putCalls: Array<{ endpoint: string; data?: any }> = [];
  public patchCalls: Array<{ endpoint: string; data?: any; config?: any }> = [];
  public deleteCalls: Array<{ endpoint: string; data?: any }> = [];

  constructor(connection: DispatcharrConnection, config: MockResponseConfig = {}) {
    this.connection = connection;
    this.config = config;
  }

  async authenticate(): Promise<string> {
    if (this.config.authFailure) {
      const error: any = new Error('Authentication failed (401): Invalid credentials');
      error.status = 401;
      error.code = 401;
      throw error;
    }
    this.authenticated = true;
    return 'mock-jwt-token';
  }

  private getResponse(endpoint: string, data?: any): any {
    // Check for error endpoints
    if (this.config.errorEndpoints?.[endpoint]) {
      const error = this.config.errorEndpoints[endpoint];
      throw typeof error === 'string' ? new Error(error) : error;
    }

    // Check pattern-based error endpoints
    for (const [pattern, error] of Object.entries(this.config.errorEndpoints || {})) {
      if (pattern.includes('*') && this.matchesPattern(endpoint, pattern)) {
        throw typeof error === 'string' ? new Error(error) : error;
      }
    }

    // Check for exact match
    if (this.config.responses?.[endpoint] !== undefined) {
      const response = this.config.responses[endpoint];
      return typeof response === 'function' ? response(endpoint, data) : response;
    }

    // Check for pattern matches (e.g., '/api/channels/*')
    for (const [pattern, response] of Object.entries(this.config.responses || {})) {
      if (this.matchesPattern(endpoint, pattern)) {
        return typeof response === 'function' ? response(endpoint, data) : response;
      }
    }

    // Return default response
    return this.config.defaultResponse ?? [];
  }

  private matchesPattern(endpoint: string, pattern: string): boolean {
    // Strip query params for matching
    const cleanEndpoint = endpoint.split('?')[0];
    const cleanPattern = pattern.split('?')[0];

    // Simple wildcard matching
    if (cleanPattern.endsWith('*')) {
      const prefix = cleanPattern.slice(0, -1);
      return cleanEndpoint.startsWith(prefix);
    }

    // Exact match
    return cleanEndpoint === cleanPattern;
  }

  async get<T = any>(endpoint: string, config?: any): Promise<T> {
    this.getCalls.push({ endpoint, config });
    return this.getResponse(endpoint);
  }

  async post<T = any>(endpoint: string, data?: any, config?: any): Promise<T> {
    this.postCalls.push({ endpoint, data, config });
    return this.getResponse(endpoint, data);
  }

  async put<T = any>(endpoint: string, data?: any): Promise<T> {
    this.putCalls.push({ endpoint, data });
    return this.getResponse(endpoint, data);
  }

  async patch<T = any>(endpoint: string, data?: any, config?: any): Promise<T> {
    this.patchCalls.push({ endpoint, data, config });
    return this.getResponse(endpoint, data);
  }

  async delete<T = any>(endpoint: string, data?: any): Promise<T> {
    this.deleteCalls.push({ endpoint, data });
    return this.getResponse(endpoint, data);
  }

  async testConnection(): Promise<TestConnectionResponse> {
    if (this.config.authFailure) {
      return {
        success: false,
        message: 'Unknown username or password.',
      };
    }
    return {
      success: true,
      message: 'Connection successful!',
      version: 'Dispatcharr',
    };
  }

  /** Reset call tracking */
  resetCalls(): void {
    this.getCalls = [];
    this.postCalls = [];
    this.putCalls = [];
    this.patchCalls = [];
    this.deleteCalls = [];
  }
}

/**
 * Creates a mock DispatcharrClient with the given configuration
 */
export function createMockClient(
  config: MockResponseConfig = {},
  connection?: Partial<DispatcharrConnection>
): MockDispatcharrClient {
  const defaultConnection: DispatcharrConnection = {
    url: 'http://test-server.local',
    username: 'testuser',
    password: 'testpass',
    ...connection,
  };
  return new MockDispatcharrClient(defaultConnection, config);
}

/**
 * Creates a vi.fn() mock of DispatcharrClient constructor
 * Use this when you need to spy on client creation
 */
export function createClientMock(config: MockResponseConfig = {}) {
  return vi.fn().mockImplementation((connection: DispatcharrConnection) => {
    return new MockDispatcharrClient(connection, config);
  });
}

/**
 * Helper to create axios-style error responses
 */
export function createAxiosError(
  status: number,
  message: string,
  data?: any
): Error {
  const error: any = new Error(message);
  error.response = {
    status,
    data: data || { detail: message },
  };
  error.isAxiosError = true;
  return error;
}
