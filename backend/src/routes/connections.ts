import { Router } from 'express';
import { DispatcharrClient } from '../services/dispatcharrClient.js';
import type { DispatcharrConnection, ApiResponse, TestConnectionResponse } from '../types/index.js';

export const connectionsRouter = Router();

// Test connection to Dispatcharr instance
connectionsRouter.post('/test', async (req, res) => {
  try {
    const connection: DispatcharrConnection = req.body;

    if (!connection.url || !connection.username || !connection.password) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: url, username, password',
      } as ApiResponse);
    }

    const client = new DispatcharrClient(connection);
    const result = await client.testConnection();

    res.json({
      success: result.success,
      data: result,
      message: result.message,
    } as ApiResponse<TestConnectionResponse>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse);
  }
});

// Get instance information
connectionsRouter.post('/info', async (req, res) => {
  try {
    const connection: DispatcharrConnection = req.body;

    const client = new DispatcharrClient(connection);
    await client.authenticate();

    // Fetch various counts
    const [channels, groups, profiles, users] = await Promise.allSettled([
      client.get('/api/channels/channels/').then((data: any) => data?.count || data?.length || 0),
      client.get('/api/channels/groups/').then((data: any) => data?.count || data?.length || 0),
      client.get('/api/channels/profiles/').then((data: any) => data?.count || data?.length || 0),
      client.get('/api/accounts/users/').then((data: any) => data?.count || data?.length || 0),
    ]);

    const info = {
      channels: channels.status === 'fulfilled' ? channels.value : 0,
      groups: groups.status === 'fulfilled' ? groups.value : 0,
      profiles: profiles.status === 'fulfilled' ? profiles.value : 0,
      users: users.status === 'fulfilled' ? users.value : 0,
    };

    res.json({
      success: true,
      data: info,
    } as ApiResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    } as ApiResponse);
  }
});
