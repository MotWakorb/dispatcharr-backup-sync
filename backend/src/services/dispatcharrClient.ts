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
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
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

      throw new Error(`Authentication failed (${statusCode || 'unknown'}): ${errorMsg}`);
    }
  }

  async get<T = any>(endpoint: string, params?: any): Promise<T> {
    if (!this.authenticated) {
      await this.authenticate();
    }

    try {
      console.log(`Making GET request to: ${endpoint}`);
      const response = await this.client.get(endpoint, { params });
      console.log(`GET ${endpoint} response status:`, response.status);
      return response.data;
    } catch (error: any) {
      console.error(`GET ${endpoint} failed:`, error.response?.status, error.response?.data);
      if (error.response?.status === 401) {
        // Token expired, re-authenticate
        this.authenticated = false;
        await this.authenticate();
        // Retry with new token
        const response = await this.client.get(endpoint, { params });
        return response.data;
      }
      throw error;
    }
  }

  async post<T = any>(endpoint: string, data?: any): Promise<T> {
    if (!this.authenticated) {
      await this.authenticate();
    }

    try {
      const response = await this.client.post(endpoint, data);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.authenticated = false;
        await this.authenticate();
        const response = await this.client.post(endpoint, data);
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

  async testConnection(): Promise<{ success: boolean; message: string; version?: string }> {
    try {
      console.log('Testing connection to:', this.connection.url);
      await this.authenticate();
      console.log('Authentication successful!');

      // Test API access with a simple endpoint
      await this.get('/api/accounts/users/me/');

      return {
        success: true,
        message: 'Connection successful - API access verified',
        version: 'Dispatcharr',
      };
    } catch (error: any) {
      console.error('Test connection failed:', error.message);
      return {
        success: false,
        message: error.message || 'Connection failed',
      };
    }
  }
}
