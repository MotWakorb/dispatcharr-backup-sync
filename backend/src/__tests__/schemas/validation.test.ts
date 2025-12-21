import { describe, it, expect } from 'vitest';
import {
  DispatcharrConnectionSchema,
  SyncOptionsSchema,
  ExportRequestSchema,
  SyncRequestSchema,
  SavedConnectionInputSchema,
  ScheduleInputSchema,
  NotificationProviderInputSchema,
  validateRequest,
} from '../../schemas/index.js';

describe('Zod Validation Schemas', () => {
  describe('DispatcharrConnectionSchema', () => {
    it('should validate a valid connection', () => {
      const result = DispatcharrConnectionSchema.safeParse({
        url: 'http://localhost:8000',
        username: 'admin',
        password: 'secret',
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid URL', () => {
      const result = DispatcharrConnectionSchema.safeParse({
        url: 'not-a-url',
        username: 'admin',
        password: 'secret',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty username', () => {
      const result = DispatcharrConnectionSchema.safeParse({
        url: 'http://localhost:8000',
        username: '',
        password: 'secret',
      });

      expect(result.success).toBe(false);
    });

    it('should reject missing password', () => {
      const result = DispatcharrConnectionSchema.safeParse({
        url: 'http://localhost:8000',
        username: 'admin',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('SyncOptionsSchema', () => {
    it('should validate empty options', () => {
      const result = SyncOptionsSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    it('should validate all boolean options', () => {
      const result = SyncOptionsSchema.safeParse({
        syncChannelGroups: true,
        syncChannelProfiles: false,
        syncChannels: true,
        syncM3USources: true,
        syncStreamProfiles: false,
        syncUserAgents: true,
        syncCoreSettings: false,
        syncLogos: true,
        syncPlugins: false,
        syncDVRRules: true,
        syncComskipConfig: false,
        syncUsers: true,
        syncEPGSources: false,
      });

      expect(result.success).toBe(true);
    });

    it('should reject non-boolean values', () => {
      const result = SyncOptionsSchema.safeParse({
        syncChannels: 'yes',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ExportRequestSchema', () => {
    it('should validate a valid export request', () => {
      const result = ExportRequestSchema.safeParse({
        source: {
          url: 'http://localhost:8000',
          username: 'admin',
          password: 'secret',
        },
        options: {
          syncChannels: true,
        },
      });

      expect(result.success).toBe(true);
    });

    it('should accept optional dryRun', () => {
      const result = ExportRequestSchema.safeParse({
        source: {
          url: 'http://localhost:8000',
          username: 'admin',
          password: 'secret',
        },
        options: {},
        dryRun: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dryRun).toBe(true);
      }
    });
  });

  describe('SyncRequestSchema', () => {
    it('should validate a valid sync request', () => {
      const result = SyncRequestSchema.safeParse({
        source: {
          url: 'http://source:8000',
          username: 'admin',
          password: 'secret1',
        },
        destination: {
          url: 'http://dest:8000',
          username: 'admin',
          password: 'secret2',
        },
        options: {
          syncChannels: true,
        },
      });

      expect(result.success).toBe(true);
    });

    it('should reject missing destination', () => {
      const result = SyncRequestSchema.safeParse({
        source: {
          url: 'http://source:8000',
          username: 'admin',
          password: 'secret1',
        },
        options: {},
      });

      expect(result.success).toBe(false);
    });
  });

  describe('SavedConnectionInputSchema', () => {
    it('should validate a valid saved connection', () => {
      const result = SavedConnectionInputSchema.safeParse({
        name: 'Production Server',
        instanceUrl: 'http://prod:8000',
        username: 'admin',
        password: 'secret',
      });

      expect(result.success).toBe(true);
    });

    it('should reject name over 100 characters', () => {
      const result = SavedConnectionInputSchema.safeParse({
        name: 'x'.repeat(101),
        instanceUrl: 'http://prod:8000',
        username: 'admin',
        password: 'secret',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ScheduleInputSchema', () => {
    it('should validate a backup schedule', () => {
      const result = ScheduleInputSchema.safeParse({
        name: 'Daily Backup',
        jobType: 'backup',
        sourceConnectionId: '550e8400-e29b-41d4-a716-446655440000',
        options: { syncChannels: true },
        schedulePreset: 'daily',
        enabled: true,
      });

      expect(result.success).toBe(true);
    });

    it('should require cronExpression for custom schedules', () => {
      const result = ScheduleInputSchema.safeParse({
        name: 'Custom Backup',
        jobType: 'backup',
        sourceConnectionId: '550e8400-e29b-41d4-a716-446655440000',
        options: {},
        schedulePreset: 'custom',
        enabled: true,
      });

      expect(result.success).toBe(false);
    });

    it('should require destinationConnectionId for sync jobs', () => {
      const result = ScheduleInputSchema.safeParse({
        name: 'Sync Job',
        jobType: 'sync',
        sourceConnectionId: '550e8400-e29b-41d4-a716-446655440000',
        options: {},
        schedulePreset: 'daily',
        enabled: true,
      });

      expect(result.success).toBe(false);
    });

    it('should validate a sync schedule with destination', () => {
      const result = ScheduleInputSchema.safeParse({
        name: 'Sync Job',
        jobType: 'sync',
        sourceConnectionId: '550e8400-e29b-41d4-a716-446655440000',
        destinationConnectionId: '550e8400-e29b-41d4-a716-446655440001',
        options: {},
        schedulePreset: 'daily',
        enabled: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('NotificationProviderInputSchema', () => {
    it('should validate SMTP provider', () => {
      const result = NotificationProviderInputSchema.safeParse({
        type: 'smtp',
        name: 'Email Notifications',
        config: {
          host: 'smtp.example.com',
          port: 587,
          fromAddress: 'noreply@example.com',
          toAddress: 'admin@example.com',
        },
      });

      expect(result.success).toBe(true);
    });

    it('should validate Telegram provider', () => {
      const result = NotificationProviderInputSchema.safeParse({
        type: 'telegram',
        name: 'Telegram Bot',
        config: {
          botToken: '123456:ABC-DEF',
          chatId: '-1001234567890',
        },
      });

      expect(result.success).toBe(true);
    });

    it('should validate Discord webhook URL format', () => {
      const validResult = NotificationProviderInputSchema.safeParse({
        type: 'discord',
        name: 'Discord Webhook',
        config: {
          webhookUrl: 'https://discord.com/api/webhooks/123/abc',
        },
      });

      expect(validResult.success).toBe(true);

      const invalidResult = NotificationProviderInputSchema.safeParse({
        type: 'discord',
        name: 'Discord Webhook',
        config: {
          webhookUrl: 'https://example.com/webhook',
        },
      });

      expect(invalidResult.success).toBe(false);
    });

    it('should validate Slack webhook URL format', () => {
      const validResult = NotificationProviderInputSchema.safeParse({
        type: 'slack',
        name: 'Slack Webhook',
        config: {
          webhookUrl: 'https://hooks.slack.com/services/T00/B00/XXX',
        },
      });

      expect(validResult.success).toBe(true);
    });
  });

  describe('validateRequest helper', () => {
    it('should return success with data for valid input', () => {
      const result = validateRequest(DispatcharrConnectionSchema, {
        url: 'http://localhost:8000',
        username: 'admin',
        password: 'secret',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.url).toBe('http://localhost:8000');
        expect(result.error).toBeUndefined();
      }
    });

    it('should return failure with formatted error message', () => {
      const result = validateRequest(DispatcharrConnectionSchema, {
        url: 'not-a-url',
        username: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('url:');
        expect(result.error).toContain('username:');
        expect(result.data).toBeUndefined();
      }
    });
  });
});
