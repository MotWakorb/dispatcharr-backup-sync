import axios, { AxiosInstance } from 'axios';
import type { DispatcharrConnection } from '../types/index.js';

export class DispatcharrClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor(private connection: DispatcharrConnection) {
    this.client = axios.create({
      baseURL: connection.url,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async authenticate(): Promise<string> {
    try {
      const response = await this.client.post('/api/accounts/auth/login/', {
        username: this.connection.username,
        password: this.connection.password,
      });

      this.token = response.data.access || response.data.token;

      // Set authorization header for future requests
      this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;

      return this.token;
    } catch (error: any) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  async get<T = any>(endpoint: string, params?: any): Promise<T> {
    if (!this.token) {
      await this.authenticate();
    }

    try {
      const response = await this.client.get(endpoint, { params });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        // Token expired, re-authenticate
        await this.authenticate();
        const response = await this.client.get(endpoint, { params });
        return response.data;
      }
      throw error;
    }
  }

  async post<T = any>(endpoint: string, data?: any): Promise<T> {
    if (!this.token) {
      await this.authenticate();
    }

    try {
      const response = await this.client.post(endpoint, data);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        await this.authenticate();
        const response = await this.client.post(endpoint, data);
        return response.data;
      }
      throw error;
    }
  }

  async put<T = any>(endpoint: string, data?: any): Promise<T> {
    if (!this.token) {
      await this.authenticate();
    }

    try {
      const response = await this.client.put(endpoint, data);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        await this.authenticate();
        const response = await this.client.put(endpoint, data);
        return response.data;
      }
      throw error;
    }
  }

  async delete<T = any>(endpoint: string): Promise<T> {
    if (!this.token) {
      await this.authenticate();
    }

    try {
      const response = await this.client.delete(endpoint);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        await this.authenticate();
        const response = await this.client.delete(endpoint);
        return response.data;
      }
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; version?: string }> {
    try {
      await this.authenticate();

      // Try to get server info
      const info = await this.get('/api/accounts/users/me/');

      return {
        success: true,
        message: 'Connection successful',
        version: info?.version || 'Unknown',
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Connection failed',
      };
    }
  }
}
