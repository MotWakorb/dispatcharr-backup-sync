import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createMockClient,
  createPaginatedResponse,
  MockDispatcharrClient,
} from './mocks/index.js';
import { createMockJobManager } from './helpers.js';
import {
  sampleChannels,
  sampleChannelGroups,
  sampleChannelProfiles,
  sampleStreams,
  sampleStreamProfiles,
  sampleEpgSources,
  sampleEpgData,
  sampleM3UAccounts,
  samplePlugins,
  sampleUsers,
  sampleUserAgents,
  sampleSettings,
  sampleLogos,
} from './fixtures/index.js';

// Mock fs module with callback-style functions for promisify
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdir: vi.fn((path: string, opts: any, cb: Function) => cb && cb(null)),
    writeFile: vi.fn((path: string, data: any, cb: Function) => cb && cb(null)),
    unlink: vi.fn((path: string, cb: Function) => cb && cb(null)),
    readFile: vi.fn((path: string, opts: any, cb: Function) => cb && cb(null, '{}')),
    createWriteStream: vi.fn(() => ({
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'close') setTimeout(cb, 10);
        return { on: vi.fn() };
      }),
      pipe: vi.fn(),
    })),
    createReadStream: vi.fn(),
    promises: {
      rm: vi.fn(() => Promise.resolve()),
      access: vi.fn(() => Promise.resolve()),
      mkdir: vi.fn(() => Promise.resolve()),
      writeFile: vi.fn(() => Promise.resolve()),
      readFile: vi.fn(() => Promise.resolve('{}')),
      unlink: vi.fn(() => Promise.resolve()),
    },
  },
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdir: vi.fn((path: string, opts: any, cb: Function) => cb && cb(null)),
  writeFile: vi.fn((path: string, data: any, cb: Function) => cb && cb(null)),
  unlink: vi.fn((path: string, cb: Function) => cb && cb(null)),
  readFile: vi.fn((path: string, opts: any, cb: Function) => cb && cb(null, '{}')),
  createWriteStream: vi.fn(() => ({
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'close') setTimeout(cb, 10);
      return { on: vi.fn() };
    }),
    pipe: vi.fn(),
  })),
  createReadStream: vi.fn(),
  promises: {
    rm: vi.fn(() => Promise.resolve()),
    access: vi.fn(() => Promise.resolve()),
    mkdir: vi.fn(() => Promise.resolve()),
    writeFile: vi.fn(() => Promise.resolve()),
    readFile: vi.fn(() => Promise.resolve('{}')),
    unlink: vi.fn(() => Promise.resolve()),
  },
}));

// Mock archiver
vi.mock('archiver', () => ({
  default: vi.fn(() => ({
    pipe: vi.fn(),
    directory: vi.fn(),
    finalize: vi.fn(),
    on: vi.fn((event, cb) => {
      if (event === 'close') setTimeout(cb, 10);
    }),
  })),
}));

// Mock dependencies
vi.mock('../src/services/jobManager.js', () => ({
  jobManager: createMockJobManager('export-job-123'),
}));

vi.mock('../src/services/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../src/services/dispatcharrClient.js', () => ({
  DispatcharrClient: vi.fn(),
}));

describe('ExportService', () => {
  let mockJobManager: ReturnType<typeof createMockJobManager>;
  let ExportService: any;
  let exportService: any;
  let mockClient: MockDispatcharrClient;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create fresh mock job manager
    mockJobManager = createMockJobManager('export-job-123');

    // Update the mocked jobManager
    const jobManagerModule = await import('../src/services/jobManager.js');
    Object.assign(jobManagerModule.jobManager, mockJobManager);

    // Create mock client with sample responses
    mockClient = createMockClient({
      responses: {
        '/api/channels/channels/*': createPaginatedResponse(sampleChannels),
        '/api/channels/groups/*': sampleChannelGroups,
        '/api/channels/streams/*': createPaginatedResponse(sampleStreams),
        '/api/channels/profiles/*': sampleChannelProfiles,
        '/api/channels/logos/*': createPaginatedResponse(sampleLogos),
        '/api/core/streamprofiles/*': createPaginatedResponse(sampleStreamProfiles),
        '/api/core/useragents/*': createPaginatedResponse(sampleUserAgents),
        '/api/core/settings/*': createPaginatedResponse(sampleSettings),
        '/api/epg/sources/*': createPaginatedResponse(sampleEpgSources),
        '/api/epg/epgdata/*': createPaginatedResponse(sampleEpgData),
        '/api/m3u/accounts/*': createPaginatedResponse(sampleM3UAccounts),
        '/api/plugins/plugins/*': { plugins: samplePlugins },
        '/api/accounts/users/*': createPaginatedResponse(sampleUsers),
        '/api/channels/recurring-rules/*': [],
        '/api/channels/dvr/comskip-config/*': { exists: false },
      },
    });

    // Mock DispatcharrClient constructor - must use regular function (not arrow) for constructors
    const dispatcharrModule = await import('../src/services/dispatcharrClient.js');
    (dispatcharrModule.DispatcharrClient as any).mockImplementation(function() {
      return mockClient;
    });

    // Import fresh ExportService instance
    vi.resetModules();
    const module = await import('../src/services/exportService.js');
    ExportService = module.ExportService;
    exportService = new ExportService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('export', () => {
    it('should start job and authenticate', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: {},
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      expect(mockJobManager.startJob).toHaveBeenCalledWith('export-job-123', 'Initializing export...');
    });

    it('should export channel groups when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncChannelGroups: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const groupCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/channels/groups')
      );
      expect(groupCalls.length).toBeGreaterThan(0);
    });

    it('should export channels when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncChannels: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const channelCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/channels/channels')
      );
      expect(channelCalls.length).toBeGreaterThan(0);
    });

    it('should export channel profiles when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncChannelProfiles: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const profileCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/channels/profiles')
      );
      expect(profileCalls.length).toBeGreaterThan(0);
    });

    it('should export M3U sources when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncM3USources: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const m3uCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/m3u/accounts')
      );
      expect(m3uCalls.length).toBeGreaterThan(0);
    });

    it('should export stream profiles when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncStreamProfiles: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const profileCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/core/streamprofiles')
      );
      expect(profileCalls.length).toBeGreaterThan(0);
    });

    it('should export user agents when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncUserAgents: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const agentCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/core/useragents')
      );
      expect(agentCalls.length).toBeGreaterThan(0);
    });

    it('should export core settings when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncCoreSettings: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const settingsCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/core/settings')
      );
      expect(settingsCalls.length).toBeGreaterThan(0);
    });

    it('should export EPG sources and data when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncEPGSources: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const epgSourceCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/epg/sources')
      );
      const epgDataCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/epg/epgdata')
      );
      expect(epgSourceCalls.length).toBeGreaterThan(0);
      expect(epgDataCalls.length).toBeGreaterThan(0);
    });

    it('should export plugins when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncPlugins: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const pluginCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/plugins/plugins')
      );
      expect(pluginCalls.length).toBeGreaterThan(0);
    });

    it('should export users when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncUsers: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const userCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/accounts/users')
      );
      expect(userCalls.length).toBeGreaterThan(0);
    });

    it('should export DVR rules when option enabled', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncDVRRules: true },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      const dvrCalls = mockClient.getCalls.filter(c =>
        c.endpoint.includes('/api/channels/recurring-rules')
      );
      expect(dvrCalls.length).toBeGreaterThan(0);
    });

    it('should handle dry run by not creating files', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: { syncChannelGroups: true },
        dryRun: true,
      };

      const result = await exportService.export(request, 'export-job-123');

      // Dry run should return empty string
      expect(result).toBe('');
      expect(mockJobManager.completeJob).toHaveBeenCalled();
    });

    it('should handle authentication failure', async () => {
      mockClient = createMockClient({ authFailure: true });

      const dispatcharrModule = await import('../src/services/dispatcharrClient.js');
      (dispatcharrModule.DispatcharrClient as any).mockImplementation(function() {
        return mockClient;
      });

      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'wrong' },
        options: {},
        dryRun: true,
      };

      await expect(exportService.export(request, 'export-job-123')).rejects.toThrow('Authentication failed');
    });
  });

  describe('countEnabledOptions', () => {
    it('should count enabled export options', () => {
      const service = new ExportService();
      const count = (service as any).countEnabledOptions({
        syncChannelGroups: true,
        syncChannels: true,
        syncEPGSources: true, // Counts as 2 (sources + data)
      });

      expect(count).toBe(4); // 1 + 1 + 2
    });

    it('should count logos option', () => {
      const service = new ExportService();
      const count = (service as any).countEnabledOptions({
        syncLogos: true,
      });

      expect(count).toBe(1);
    });
  });

  describe('generateSummary', () => {
    it('should generate export summary with counts', () => {
      const service = new ExportService();
      const exportData = {
        exported_at: '2024-01-15T10:00:00Z',
        source_url: 'http://test.local',
        data: {
          channelGroups: [{ id: 1 }, { id: 2 }],
          channels: [{ id: 1 }, { id: 2 }, { id: 3 }],
          plugins: [{ key: 'test' }],
        },
      };

      const summary = (service as any).generateSummary(exportData);

      expect(summary.counts.channelGroups).toBe(2);
      expect(summary.counts.channels).toBe(3);
      expect(summary.counts.plugins).toBe(1);
    });

    it('should handle logos count in both formats', () => {
      const service = new ExportService();

      // Array format (dry run)
      const summaryArray = (service as any).generateSummary({
        exported_at: '2024-01-15T10:00:00Z',
        source_url: 'http://test.local',
        data: {
          logos: [{ id: 1 }, { id: 2 }],
        },
      });
      expect(summaryArray.counts.logos).toBe(2);

      // Object format (actual export)
      const summaryObject = (service as any).generateSummary({
        exported_at: '2024-01-15T10:00:00Z',
        source_url: 'http://test.local',
        data: {
          logos: { count: 5, failed: 1, tooSmall: 0 },
        },
      });
      expect(summaryObject.counts.logos).toBe(5);
    });
  });

  describe('progress tracking', () => {
    it('should update progress during export', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        options: {
          syncChannelGroups: true,
          syncChannels: true,
        },
        dryRun: true,
      };

      await exportService.export(request, 'export-job-123');

      expect(mockJobManager.setProgress.mock.calls.length).toBeGreaterThan(0);

      // Check that authentication progress was reported
      const progressMessages = mockJobManager.setProgress.mock.calls.map(c => c[2]);
      expect(progressMessages.some(m => m?.includes('Authenticating'))).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should have cleanup method', () => {
      expect(typeof exportService.cleanup).toBe('function');
    });

    it('should have cleanupOldBackups method', () => {
      expect(typeof exportService.cleanupOldBackups).toBe('function');
    });

    it('should return backup directory path', () => {
      const backupDir = exportService.getBackupDir();
      expect(typeof backupDir).toBe('string');
      expect(backupDir).toContain('backups');
    });
  });
});
