import { z } from 'zod';

// ============ Common Schemas ============

export const DispatcharrConnectionSchema = z.object({
  url: z.string().url('Invalid URL format').min(1, 'URL is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const SyncOptionsSchema = z.object({
  syncChannelGroups: z.boolean().optional(),
  syncChannelProfiles: z.boolean().optional(),
  syncChannels: z.boolean().optional(),
  syncM3USources: z.boolean().optional(),
  syncStreamProfiles: z.boolean().optional(),
  syncUserAgents: z.boolean().optional(),
  syncCoreSettings: z.boolean().optional(),
  syncLogos: z.boolean().optional(),
  syncPlugins: z.boolean().optional(),
  syncDVRRules: z.boolean().optional(),
  syncComskipConfig: z.boolean().optional(),
  syncUsers: z.boolean().optional(),
  syncEPGSources: z.boolean().optional(),
});

// ============ Export Schemas ============

export const ExportRequestSchema = z.object({
  source: DispatcharrConnectionSchema,
  options: SyncOptionsSchema,
  dryRun: z.boolean().optional(),
});

// ============ Import Schemas ============

export const ImportRequestSchema = z.object({
  destination: DispatcharrConnectionSchema,
  fileData: z.union([z.string(), z.instanceof(Buffer)]).optional(),
  fileName: z.string().optional(),
  format: z.enum(['yaml', 'json']).optional(),
  options: SyncOptionsSchema.optional(),
  uploadId: z.string().optional(),
});

// ============ Sync Schemas ============

export const SyncRequestSchema = z.object({
  source: DispatcharrConnectionSchema,
  destination: DispatcharrConnectionSchema,
  options: SyncOptionsSchema,
  dryRun: z.boolean().optional(),
});

export const ComparePluginsSchema = z.object({
  source: DispatcharrConnectionSchema,
  destination: DispatcharrConnectionSchema,
});

// ============ Connection Schemas ============

export const TestConnectionSchema = DispatcharrConnectionSchema;

export const SavedConnectionInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  instanceUrl: z.string().url('Invalid URL format').min(1, 'Instance URL is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// ============ Schedule Schemas ============

export const SchedulePresetSchema = z.enum(['hourly', 'daily', 'weekly', 'monthly', 'custom']);
export const ScheduledJobTypeSchema = z.enum(['backup', 'sync']);

export const ScheduleInputSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    jobType: ScheduledJobTypeSchema,
    sourceConnectionId: z.string().uuid('Invalid source connection ID'),
    sourceConnectionName: z.string().optional(),
    destinationConnectionId: z.string().uuid('Invalid destination connection ID').optional(),
    destinationConnectionName: z.string().optional(),
    options: SyncOptionsSchema,
    schedulePreset: SchedulePresetSchema,
    cronExpression: z.string().optional(),
    enabled: z.boolean(),
    retentionCount: z.number().int().min(1).max(100).optional(),
  })
  .refine((data) => data.schedulePreset !== 'custom' || !!data.cronExpression, {
    message: 'cronExpression is required for custom schedules',
    path: ['cronExpression'],
  })
  .refine((data) => data.jobType !== 'sync' || !!data.destinationConnectionId, {
    message: 'destinationConnectionId is required for sync jobs',
    path: ['destinationConnectionId'],
  });

export const ScheduleUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  jobType: ScheduledJobTypeSchema.optional(),
  sourceConnectionId: z.string().uuid().optional(),
  sourceConnectionName: z.string().optional(),
  destinationConnectionId: z.string().uuid().optional().nullable(),
  destinationConnectionName: z.string().optional(),
  options: SyncOptionsSchema.optional(),
  schedulePreset: SchedulePresetSchema.optional(),
  cronExpression: z.string().optional(),
  enabled: z.boolean().optional(),
  retentionCount: z.number().int().min(1).max(100).optional(),
});

export const ValidateCronSchema = z.object({
  expression: z.string().min(1, 'Expression is required'),
});

// ============ Notification Schemas ============

export const NotificationTypeSchema = z.enum(['smtp', 'telegram', 'discord', 'slack']);

export const SmtpConfigSchema = z.object({
  host: z.string().min(1, 'SMTP host is required'),
  port: z.number().int().min(1).max(65535).default(25),
  secure: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  fromAddress: z.string().email('Invalid from email address'),
  toAddress: z.string().email('Invalid to email address'),
});

export const TelegramConfigSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
});

export const DiscordConfigSchema = z.object({
  webhookUrl: z
    .string()
    .url('Invalid URL')
    .refine(
      (url) =>
        url.startsWith('https://discord.com/api/webhooks/') ||
        url.startsWith('https://discordapp.com/api/webhooks/'),
      { message: 'Invalid Discord webhook URL' }
    ),
});

export const SlackConfigSchema = z.object({
  webhookUrl: z
    .string()
    .url('Invalid URL')
    .refine((url) => url.startsWith('https://hooks.slack.com/'), {
      message: 'Invalid Slack webhook URL',
    }),
});

export const NotificationProviderInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('smtp'),
    name: z.string().min(1, 'Name is required').max(100),
    config: SmtpConfigSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('telegram'),
    name: z.string().min(1, 'Name is required').max(100),
    config: TelegramConfigSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('discord'),
    name: z.string().min(1, 'Name is required').max(100),
    config: DiscordConfigSchema,
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('slack'),
    name: z.string().min(1, 'Name is required').max(100),
    config: SlackConfigSchema,
    enabled: z.boolean().optional(),
  }),
]);

export const NotificationGlobalSettingsSchema = z.object({
  notifyOnSuccess: z.boolean().optional(),
  notifyOnFailure: z.boolean().optional(),
  notifyOnStart: z.boolean().optional(),
  defaultProviderIds: z.array(z.string().uuid()).optional(),
});

// ============ Plugin Upload Schema ============

export const PluginUploadConnectionSchema = z.object({
  connection: z
    .string()
    .transform((val) => {
      try {
        return JSON.parse(val);
      } catch {
        throw new Error('Invalid connection data');
      }
    })
    .pipe(DispatcharrConnectionSchema),
});

// ============ ID Parameter Schema ============

export const IdParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

export const JobIdParamSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
});

// ============ Query Schemas ============

export const HistoryQuerySchema = z.object({
  limit: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(1).max(100))
    .optional(),
});

// ============ Helper function to validate and get errors ============

export interface ValidationSuccess<T> {
  success: true;
  data: T;
  error?: undefined;
}

export interface ValidationFailure {
  success: false;
  error: string;
  data?: undefined;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function validateRequest<T>(schema: z.ZodType<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errorMessages = result.error.issues
    .map((e) => {
      const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
      return `${path}${e.message}`;
    })
    .join('; ');
  return { success: false, error: errorMessages };
}
