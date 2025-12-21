import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Dispatcharr Backup & Sync API',
      version: '1.0.0',
      description: `
API for managing Dispatcharr IPTV configuration backups and synchronization.

## Features
- **Export/Backup**: Export configuration from a Dispatcharr instance
- **Import/Restore**: Restore configuration to a Dispatcharr instance
- **Sync**: Synchronize configuration between two instances
- **Scheduling**: Schedule automated backup and sync jobs
- **Notifications**: Configure alerts for job completion/failure

## Authentication
All Dispatcharr operations require credentials (URL, username, password) to be passed in requests.
The API itself does not require authentication.
      `,
      contact: {
        name: 'Dispatcharr Backup Sync',
      },
    },
    servers: [
      {
        url: 'http://localhost:6001',
        description: 'Development server',
      },
      {
        url: '/api',
        description: 'Production API (relative)',
      },
    ],
    tags: [
      { name: 'Connections', description: 'Test and manage Dispatcharr connections' },
      { name: 'Export', description: 'Export/backup configuration' },
      { name: 'Import', description: 'Import/restore configuration' },
      { name: 'Sync', description: 'Synchronize between instances' },
      { name: 'Jobs', description: 'Job status and history' },
      { name: 'Schedules', description: 'Scheduled backup/sync jobs' },
      { name: 'Saved Connections', description: 'Saved Dispatcharr connection profiles' },
      { name: 'Notifications', description: 'Notification providers and settings' },
      { name: 'Settings', description: 'Application settings' },
    ],
    components: {
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            message: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['success'],
        },
        DispatcharrConnection: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              description: 'Dispatcharr instance URL',
              example: 'http://dispatcharr:8000',
            },
            username: {
              type: 'string',
              description: 'Username for authentication',
              example: 'admin',
            },
            password: {
              type: 'string',
              format: 'password',
              description: 'Password for authentication',
            },
          },
          required: ['url', 'username', 'password'],
        },
        SyncOptions: {
          type: 'object',
          properties: {
            syncChannelGroups: { type: 'boolean', default: false },
            syncChannelProfiles: { type: 'boolean', default: false },
            syncChannels: { type: 'boolean', default: false },
            syncM3USources: { type: 'boolean', default: false },
            syncStreamProfiles: { type: 'boolean', default: false },
            syncUserAgents: { type: 'boolean', default: false },
            syncCoreSettings: { type: 'boolean', default: false },
            syncLogos: { type: 'boolean', default: false },
            syncPlugins: { type: 'boolean', default: false },
            syncDVRRules: { type: 'boolean', default: false },
            syncComskipConfig: { type: 'boolean', default: false },
            syncUsers: { type: 'boolean', default: false },
            syncEPGSources: { type: 'boolean', default: false },
          },
        },
        JobStatus: {
          type: 'object',
          properties: {
            jobId: { type: 'string', description: 'Unique job identifier' },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
            },
            progress: { type: 'number', minimum: 0, maximum: 100 },
            message: { type: 'string' },
            error: { type: 'string' },
            jobType: { type: 'string', enum: ['backup', 'import', 'sync'] },
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time' },
          },
        },
        SavedConnection: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', description: 'Friendly name for the connection' },
            instanceUrl: { type: 'string', format: 'uri' },
            username: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Schedule: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            jobType: { type: 'string', enum: ['backup', 'sync'] },
            sourceConnectionId: { type: 'string', format: 'uuid' },
            destinationConnectionId: { type: 'string', format: 'uuid' },
            options: { $ref: '#/components/schemas/SyncOptions' },
            schedulePreset: {
              type: 'string',
              enum: ['hourly', 'daily', 'weekly', 'monthly', 'custom'],
            },
            cronExpression: { type: 'string' },
            enabled: { type: 'boolean' },
            lastRun: { type: 'string', format: 'date-time' },
            nextRun: { type: 'string', format: 'date-time' },
          },
        },
        SyncRequest: {
          type: 'object',
          required: ['source', 'destination', 'options'],
          properties: {
            source: { $ref: '#/components/schemas/DispatcharrConnection' },
            destination: { $ref: '#/components/schemas/DispatcharrConnection' },
            options: { $ref: '#/components/schemas/SyncOptions' },
          },
        },
        JobLogEntry: {
          type: 'object',
          properties: {
            timestamp: { type: 'string', format: 'date-time' },
            message: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
