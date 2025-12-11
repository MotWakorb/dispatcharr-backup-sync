import { Router } from 'express';
import { notificationStore } from '../services/notificationStore.js';
import { notificationService } from '../services/notificationService.js';
import type { ApiResponse } from '../types/index.js';
import type {
  NotificationProvider,
  NotificationProviderInput,
  NotificationGlobalSettings,
} from '../types/notifications.js';

export const notificationsRouter = Router();

function validateProviderInput(input: NotificationProviderInput): string | null {
  if (!input.name || !input.name.trim()) {
    return 'name is required';
  }

  if (!input.type || !['smtp', 'telegram', 'discord', 'slack'].includes(input.type)) {
    return 'type must be smtp, telegram, discord, or slack';
  }

  if (!input.config) {
    return 'config is required';
  }

  // Type-specific validation
  switch (input.type) {
    case 'smtp': {
      const config = input.config as any;
      if (!config.host || !config.fromAddress || !config.toAddress) {
        return 'SMTP config requires host, fromAddress, and toAddress';
      }
      // Set default port if not provided
      if (!config.port) {
        config.port = 25;
      }
      break;
    }
    case 'telegram': {
      const config = input.config as any;
      if (!config.botToken || !config.chatId) {
        return 'Telegram config requires botToken and chatId';
      }
      break;
    }
    case 'discord': {
      const config = input.config as any;
      if (!config.webhookUrl) {
        return 'Discord config requires webhookUrl';
      }
      if (!config.webhookUrl.startsWith('https://discord.com/api/webhooks/') && !config.webhookUrl.startsWith('https://discordapp.com/api/webhooks/')) {
        return 'Invalid Discord webhook URL';
      }
      break;
    }
    case 'slack': {
      const config = input.config as any;
      if (!config.webhookUrl) {
        return 'Slack config requires webhookUrl';
      }
      if (!config.webhookUrl.startsWith('https://hooks.slack.com/')) {
        return 'Invalid Slack webhook URL';
      }
      break;
    }
  }

  return null;
}

// ============ Provider Routes ============

// List all notification providers
notificationsRouter.get('/providers', async (_req, res) => {
  try {
    const providers = await notificationStore.getProviders();
    res.json({
      success: true,
      data: providers,
    } as ApiResponse<NotificationProvider[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list notification providers',
    } as ApiResponse);
  }
});

// Get a single provider
notificationsRouter.get('/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const provider = await notificationStore.getProviderById(id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        error: 'Notification provider not found',
      } as ApiResponse);
    }
    res.json({
      success: true,
      data: provider,
    } as ApiResponse<NotificationProvider>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get notification provider',
    } as ApiResponse);
  }
});

// Create a notification provider
notificationsRouter.post('/providers', async (req, res) => {
  try {
    const input: NotificationProviderInput = req.body;
    const validationError = validateProviderInput(input);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError,
      } as ApiResponse);
    }

    const provider = await notificationStore.createProvider(input);
    res.status(201).json({
      success: true,
      data: provider,
      message: 'Notification provider created',
    } as ApiResponse<NotificationProvider>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create notification provider',
    } as ApiResponse);
  }
});

// Update a notification provider
notificationsRouter.put('/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await notificationStore.getProviderById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Notification provider not found',
      } as ApiResponse);
    }

    const input: NotificationProviderInput = req.body;
    const validationError = validateProviderInput(input);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError,
      } as ApiResponse);
    }

    const provider = await notificationStore.updateProvider(id, input);
    res.json({
      success: true,
      data: provider,
      message: 'Notification provider updated',
    } as ApiResponse<NotificationProvider>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update notification provider',
    } as ApiResponse);
  }
});

// Delete a notification provider
notificationsRouter.delete('/providers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await notificationStore.getProviderById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Notification provider not found',
      } as ApiResponse);
    }

    await notificationStore.deleteProvider(id);
    res.json({
      success: true,
      message: 'Notification provider deleted',
    } as ApiResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete notification provider',
    } as ApiResponse);
  }
});

// Test a notification provider (by ID - must be saved first)
notificationsRouter.post('/providers/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await notificationService.testProvider(id);
    res.json({
      success: result.success,
      message: result.message,
    } as ApiResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to test notification provider',
    } as ApiResponse);
  }
});

// Test a provider config without saving (for testing before creating/updating)
notificationsRouter.post('/providers/test-config', async (req, res) => {
  try {
    const input: NotificationProviderInput = req.body;
    const validationError = validateProviderInput(input);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError,
      } as ApiResponse);
    }

    const result = await notificationService.testProviderConfig(input);
    res.json({
      success: result.success,
      message: result.message,
    } as ApiResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to test notification provider',
    } as ApiResponse);
  }
});

// ============ Global Settings Routes ============

// Get global notification settings
notificationsRouter.get('/settings', async (_req, res) => {
  try {
    const settings = await notificationStore.getGlobalSettings();
    res.json({
      success: true,
      data: settings,
    } as ApiResponse<NotificationGlobalSettings>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get notification settings',
    } as ApiResponse);
  }
});

// Update global notification settings
notificationsRouter.put('/settings', async (req, res) => {
  try {
    const updates: Partial<NotificationGlobalSettings> = req.body;
    const settings = await notificationStore.updateGlobalSettings(updates);
    res.json({
      success: true,
      data: settings,
      message: 'Notification settings updated',
    } as ApiResponse<NotificationGlobalSettings>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update notification settings',
    } as ApiResponse);
  }
});
