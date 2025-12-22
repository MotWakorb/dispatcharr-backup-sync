import { Router } from 'express';
import { DispatcharrClient } from '../services/dispatcharrClient.js';
import { createLogger } from '../services/logger.js';
import { getErrorMessage } from '../utils/errorUtils.js';
import type { DispatcharrConnection, ApiResponse, TestConnectionResponse } from '../types/index.js';
import { validateConnection } from '../schemas/index.js';

const log = createLogger('connections-route');

export const connectionsRouter = Router();

// Test connection to Dispatcharr instance
connectionsRouter.post('/test', async (req, res) => {
  try {
    const connection: DispatcharrConnection = req.body;

    const validation = validateConnection(connection, 'connection');
    if (!validation.success) {
      log.warn({ url: connection?.url }, 'Connection test failed: missing required fields');
      return res.status(400).json({
        success: false,
        error: validation.error,
      } as ApiResponse);
    }

    log.debug({ url: connection.url }, 'Testing connection');
    const client = new DispatcharrClient(connection);
    const result = await client.testConnection();

    if (result.success) {
      log.info({ url: connection.url, version: result.version }, 'Connection test successful');
    } else {
      log.warn({ url: connection.url, message: result.message }, 'Connection test failed');
    }

    res.json({
      success: result.success,
      data: result,
      message: result.message,
    } as ApiResponse<TestConnectionResponse>);
  } catch (error) {
    log.error({ err: error }, 'Connection test error');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    } as ApiResponse);
  }
});

// Get instance information
connectionsRouter.post('/info', async (req, res) => {
  try {
    const connection: DispatcharrConnection = req.body;

    log.debug({ url: connection.url }, 'Fetching instance info');
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

    log.debug({ url: connection.url, ...info }, 'Instance info retrieved');

    res.json({
      success: true,
      data: info,
    } as ApiResponse);
  } catch (error) {
    log.error({ err: error }, 'Failed to get instance info');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    } as ApiResponse);
  }
});
