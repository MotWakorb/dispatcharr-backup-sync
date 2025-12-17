import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock nodemailer
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-123' });
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

// Mock notificationStore
const mockGetGlobalSettings = vi.fn();
const mockGetEnabledProviders = vi.fn();
const mockGetProviderById = vi.fn();

vi.mock('../src/services/notificationStore.js', () => ({
  notificationStore: {
    getGlobalSettings: () => mockGetGlobalSettings(),
    getEnabledProviders: () => mockGetEnabledProviders(),
    getProviderById: (id: string) => mockGetProviderById(id),
  },
}));

// Mock jobManager
vi.mock('../src/services/jobManager.js', () => ({
  jobManager: {
    getLogs: vi.fn(() => []),
  },
}));

// Mock logger
vi.mock('../src/services/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock fetch for Telegram/Discord/Slack
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Set test data directory
process.env.DATA_DIR = '/tmp/dispatcharr-test-data';

describe('NotificationService', () => {
  let notificationService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset fetch mock
    mockFetch.mockReset();

    // Default mock settings
    mockGetGlobalSettings.mockResolvedValue({
      notifyOnStart: true,
      notifyOnComplete: true,
      notifyOnCompleteWithErrors: true,
      notifyOnFailure: true,
      includeLogsInEmail: false,
    });

    mockGetEnabledProviders.mockResolvedValue([]);

    // Import fresh instance
    const module = await import('../src/services/notificationService.js');
    notificationService = module.notificationService;
  });

  describe('notify', () => {
    it('should return empty array when no providers are enabled', async () => {
      mockGetEnabledProviders.mockResolvedValue([]);

      const results = await notificationService.notify({
        type: 'job_completed',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
      });

      expect(results).toEqual([]);
    });

    it('should skip notification when event type is disabled', async () => {
      mockGetGlobalSettings.mockResolvedValue({
        notifyOnStart: false,
        notifyOnComplete: true,
        notifyOnFailure: true,
      });

      const results = await notificationService.notify({
        type: 'job_started',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
      });

      expect(results).toEqual([]);
    });

    it('should send SMTP notification to enabled provider', async () => {
      const smtpProvider = {
        id: 'smtp-1',
        name: 'Email Alerts',
        type: 'smtp',
        enabled: true,
        config: {
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          username: 'user@example.com',
          password: 'password123',
          fromAddress: 'alerts@example.com',
          toAddress: 'admin@example.com',
        },
      };

      mockGetEnabledProviders.mockResolvedValue([smtpProvider]);

      const results = await notificationService.notify({
        type: 'job_completed',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
      });

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(results[0].providerId).toBe('smtp-1');
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('should send Telegram notification', async () => {
      const telegramProvider = {
        id: 'telegram-1',
        name: 'Telegram Bot',
        type: 'telegram',
        enabled: true,
        config: {
          botToken: 'bot123:ABC',
          chatId: '-100123456',
        },
      };

      mockGetEnabledProviders.mockResolvedValue([telegramProvider]);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const results = await notificationService.notify({
        type: 'job_completed',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
      });

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should send Discord notification', async () => {
      const discordProvider = {
        id: 'discord-1',
        name: 'Discord Webhook',
        type: 'discord',
        enabled: true,
        config: {
          webhookUrl: 'https://discord.com/api/webhooks/123/abc',
        },
      };

      mockGetEnabledProviders.mockResolvedValue([discordProvider]);
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const results = await notificationService.notify({
        type: 'job_failed',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
        error: 'Connection timeout',
      });

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/abc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should send Slack notification', async () => {
      const slackProvider = {
        id: 'slack-1',
        name: 'Slack Webhook',
        type: 'slack',
        enabled: true,
        config: {
          webhookUrl: 'https://hooks.slack.com/services/xxx/yyy/zzz',
        },
      };

      mockGetEnabledProviders.mockResolvedValue([slackProvider]);
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('ok'),
      });

      const results = await notificationService.notify({
        type: 'job_completed',
        scheduleName: 'Weekly Sync',
        jobType: 'sync',
        jobId: 'job-456',
        timestamp: new Date().toISOString(),
        duration: 125000, // 2m 5s
      });

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/xxx/yyy/zzz',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should handle provider errors gracefully', async () => {
      const telegramProvider = {
        id: 'telegram-1',
        name: 'Telegram Bot',
        type: 'telegram',
        enabled: true,
        config: {
          botToken: 'invalid-token',
          chatId: '-100123456',
        },
      };

      mockGetEnabledProviders.mockResolvedValue([telegramProvider]);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ description: 'Unauthorized' }),
      });

      const results = await notificationService.notify({
        type: 'job_completed',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
      });

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].message).toBe('Unauthorized');
    });

    it('should send to multiple providers', async () => {
      const providers = [
        {
          id: 'smtp-1',
          name: 'Email',
          type: 'smtp',
          enabled: true,
          config: {
            host: 'smtp.example.com',
            port: 587,
            fromAddress: 'alerts@example.com',
            toAddress: 'admin@example.com',
          },
        },
        {
          id: 'discord-1',
          name: 'Discord',
          type: 'discord',
          enabled: true,
          config: {
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
          },
        },
      ];

      mockGetEnabledProviders.mockResolvedValue(providers);
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const results = await notificationService.notify({
        type: 'job_completed',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
      });

      expect(results.length).toBe(2);
      expect(results.every((r: any) => r.success)).toBe(true);
    });
  });

  describe('testProvider', () => {
    it('should return error when provider not found', async () => {
      mockGetProviderById.mockResolvedValue(null);

      const result = await notificationService.testProvider('non-existent');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Provider not found');
    });

    it('should test existing provider successfully', async () => {
      const telegramProvider = {
        id: 'telegram-1',
        name: 'Telegram Bot',
        type: 'telegram',
        enabled: true,
        config: {
          botToken: 'bot123:ABC',
          chatId: '-100123456',
        },
      };

      mockGetProviderById.mockResolvedValue(telegramProvider);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const result = await notificationService.testProvider('telegram-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Test notification sent successfully');
    });
  });

  describe('testProviderConfig', () => {
    it('should test SMTP config directly', async () => {
      const input = {
        name: 'Test SMTP',
        type: 'smtp' as const,
        config: {
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          username: 'user@example.com',
          password: 'password123',
          fromAddress: 'alerts@example.com',
          toAddress: 'admin@example.com',
        },
      };

      const result = await notificationService.testProviderConfig(input);

      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('should return error message on failure', async () => {
      const input = {
        name: 'Test Discord',
        type: 'discord' as const,
        config: {
          webhookUrl: 'https://discord.com/api/webhooks/invalid',
        },
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });

      const result = await notificationService.testProviderConfig(input);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Discord webhook error');
    });
  });

  describe('notification event types', () => {
    it('should handle job_started event', async () => {
      const discordProvider = {
        id: 'discord-1',
        name: 'Discord',
        type: 'discord',
        enabled: true,
        config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
      };

      mockGetEnabledProviders.mockResolvedValue([discordProvider]);
      mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

      const results = await notificationService.notify({
        type: 'job_started',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
      });

      expect(results[0].success).toBe(true);
    });

    it('should handle job_completed_with_errors event', async () => {
      const discordProvider = {
        id: 'discord-1',
        name: 'Discord',
        type: 'discord',
        enabled: true,
        config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
      };

      mockGetEnabledProviders.mockResolvedValue([discordProvider]);
      mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

      const results = await notificationService.notify({
        type: 'job_completed_with_errors',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
        errorCount: 5,
      });

      expect(results[0].success).toBe(true);
    });

    it('should handle job_failed event with error message', async () => {
      const discordProvider = {
        id: 'discord-1',
        name: 'Discord',
        type: 'discord',
        enabled: true,
        config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
      };

      mockGetEnabledProviders.mockResolvedValue([discordProvider]);
      mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

      const results = await notificationService.notify({
        type: 'job_failed',
        scheduleName: 'Daily Backup',
        jobType: 'backup',
        jobId: 'job-123',
        timestamp: new Date().toISOString(),
        error: 'Connection refused',
      });

      expect(results[0].success).toBe(true);
    });
  });
});
