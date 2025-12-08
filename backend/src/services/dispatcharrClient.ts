import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import type { DispatcharrConnection } from '../types/index.js';

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

      console.log('Token response received');

      // Get JWT access token
      this.token = response.data.access;

      if (!this.token) {
        throw new Error('No access token received from server');
      }

      console.log('JWT token received, length:', this.token.length);

      // Set authorization header for JWT-based auth
      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;

      this.authenticated = true;
      return this.token;
    } catch (error: any) {
      const statusCode = error.response?.status;
      const errorData = error.response?.data;
      const errorMsg = errorData?.detail || errorData?.message || error.message;

      console.error('Authentication error:', {
        url: this.connection.url,
        username: this.connection.username,
        statusCode,
        error: errorMsg,
        fullError: errorData
      });

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
      console.log(`Making GET request to: ${endpoint}`);
      const axiosConfig = config
        ? (config.params || config.responseType || config.headers ? config : { params: config })
        : undefined;
      const response = await this.client.get(endpoint, axiosConfig);
      console.log(`GET ${endpoint} response status:`, response.status);
      return response.data ?? response;
    } catch (error: any) {
      console.error(`GET ${endpoint} failed:`, error.response?.status, error.response?.data);
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
      console.log(`Making POST request to: ${endpoint}`);
      console.log(`POST ${endpoint} payload:`, JSON.stringify(data).slice(0, 200));
      const response = await this.client.post(endpoint, data, config);
      console.log(`POST ${endpoint} response status:`, response.status);
      return response.data;
    } catch (error: any) {
      console.error(`POST ${endpoint} failed:`, error.response?.status);
      console.error(`POST ${endpoint} error data:`, error.response?.data);
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

  async delete<T = any>(endpoint: string): Promise<T> {
    if (!this.authenticated) {
      await this.authenticate();
    }

    try {
      const response = await this.client.delete(endpoint);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.authenticated = false;
        await this.authenticate();
        const response = await this.client.delete(endpoint);
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
      console.log(`Making PATCH request to: ${endpoint}`);
      console.log(`PATCH ${endpoint} payload:`, JSON.stringify(data).substring(0, 500));
      const response = await this.client.patch(endpoint, data, config);
      console.log(`PATCH ${endpoint} response status: ${response.status}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.authenticated = false;
        await this.authenticate();
        const response = await this.client.patch(endpoint, data, config);
        console.log(`PATCH ${endpoint} response status: ${response.status}`);
        return response.data;
      }
      console.log(`PATCH ${endpoint} error:`, error.response?.status, error.response?.data);
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; version?: string }> {
    try {
      console.log('Testing connection to:', this.connection.url);
      await this.authenticate();
      console.log('Authentication successful!');

      // Test API access with a simple endpoint
      await this.get('/api/accounts/users/me/');

      return {
        success: true,
        message: 'Connection successful!',
        version: 'Dispatcharr',
      };
    } catch (error: any) {
      console.error('Test connection failed:', error.message);
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
