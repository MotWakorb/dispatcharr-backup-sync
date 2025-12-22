import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { createMockJobManager } from './helpers.js';

// Mock dependencies before any imports
const mockFsPromises = {
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('test backup content')),
  unlink: vi.fn().mockResolvedValue(undefined),
};

vi.mock('fs', () => ({
  default: {
    promises: mockFsPromises,
  },
  promises: mockFsPromises,
}));

vi.mock('../src/services/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockExport = vi.fn();
const mockImport = vi.fn();

vi.mock('../src/services/exportService.js', () => ({
  exportService: {
    export: mockExport,
  },
}));

vi.mock('../src/services/importService.js', () => ({
  importService: {
    import: mockImport,
  },
}));

const mockJobManager = createMockJobManager('sync-job-123');

vi.mock('../src/services/jobManager.js', () => ({
  jobManager: mockJobManager,
}));

describe('SyncService', () => {
  let SyncService: any;
  let syncService: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockFsPromises.mkdir.mockResolvedValue(undefined);
    mockFsPromises.readFile.mockResolvedValue(Buffer.from('test backup content'));
    mockFsPromises.unlink.mockResolvedValue(undefined);

    // Setup default successful export/import
    mockExport.mockResolvedValue('/tmp/backup-test.zip');
    mockImport.mockResolvedValue(undefined);

    // Mock job manager to track sub-jobs and return completed status
    let jobCounter = 0;
    (mockJobManager.createJob as Mock).mockImplementation((type: string) => {
      jobCounter++;
      return `${type}-sub-${jobCounter}`;
    });
    (mockJobManager.getJob as Mock).mockImplementation((jobId: string) => {
      if (jobId.includes('sub')) {
        return { status: 'completed', result: { imported: { channels: { imported: 5 } } } };
      }
      return { status: 'running' };
    });

    // Import SyncService
    const module = await import('../src/services/syncService.js');
    SyncService = module.SyncService;
    syncService = new SyncService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sync', () => {
    it('should start job and complete sync via export/import', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannels: true },
      };

      await syncService.sync(request, 'sync-job-123');

      expect(mockJobManager.startJob).toHaveBeenCalledWith('sync-job-123', 'Initializing sync...');
      expect(mockExport).toHaveBeenCalled();
      expect(mockImport).toHaveBeenCalled();
      expect(mockJobManager.completeJob).toHaveBeenCalled();
    });

    it('should call export with correct options', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannelGroups: true, syncLogos: true },
      };

      await syncService.sync(request, 'sync-job-123');

      // Verify export was called with source connection and options
      const exportCall = mockExport.mock.calls[0];
      expect(exportCall[0].source).toEqual(request.source);
      expect(exportCall[0].options).toEqual(request.options);
    });

    it('should call import with destination connection and file data', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncM3USources: true },
      };

      await syncService.sync(request, 'sync-job-123');

      // Verify import was called with destination connection
      const importCall = mockImport.mock.calls[0];
      expect(importCall[0].destination).toEqual(request.destination);
      expect(importCall[0].options).toEqual(request.options);
      expect(importCall[0].fileData).toBeDefined();
    });

    it('should handle dry run mode without importing', async () => {
      // In dry run, export returns empty string
      mockExport.mockResolvedValue('');

      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannelGroups: true },
        dryRun: true,
      };

      await syncService.sync(request, 'sync-job-123');

      // In dry run, import should not be called
      expect(mockImport).not.toHaveBeenCalled();
      expect(mockJobManager.completeJob).toHaveBeenCalled();
    });

    it('should handle export failure', async () => {
      mockExport.mockRejectedValue(new Error('Export failed'));

      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannels: true },
      };

      await expect(syncService.sync(request, 'sync-job-123')).rejects.toThrow('Export failed');
      expect(mockJobManager.failJob).toHaveBeenCalled();
    });

    it('should handle import failure', async () => {
      mockImport.mockRejectedValue(new Error('Import failed'));

      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannels: true },
      };

      await expect(syncService.sync(request, 'sync-job-123')).rejects.toThrow('Import failed');
      expect(mockJobManager.failJob).toHaveBeenCalled();
    });

    it('should cleanup temp file after sync', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannels: true },
      };

      await syncService.sync(request, 'sync-job-123');

      // Verify file cleanup was attempted
      expect(mockFsPromises.unlink).toHaveBeenCalledWith('/tmp/backup-test.zip');
    });

    it('should handle job cancellation', async () => {
      // Set job to cancelled state
      (mockJobManager.getJob as Mock).mockImplementation((jobId: string) => {
        if (jobId === 'sync-job-123') {
          return { status: 'cancelled' };
        }
        return { status: 'completed', result: {} };
      });

      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannelGroups: true },
      };

      try {
        await syncService.sync(request, 'sync-job-123');
      } catch (error: any) {
        expect(error.cancelled).toBe(true);
      }
    });
  });

  describe('progress tracking', () => {
    it('should update progress throughout sync', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannelGroups: true },
      };

      await syncService.sync(request, 'sync-job-123');

      // Should have multiple progress updates
      expect((mockJobManager.setProgress as Mock).mock.calls.length).toBeGreaterThan(0);
    });

    it('should log sync via export/import approach', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannels: true },
      };

      await syncService.sync(request, 'sync-job-123');

      // Verify log messages mention export/import approach
      const logMessages = (mockJobManager.addLog as Mock).mock.calls.map((c: any) => c[1]);
      expect(logMessages.some((m: string) => m.includes('export'))).toBe(true);
      expect(logMessages.some((m: string) => m.includes('import'))).toBe(true);
    });
  });

  describe('sub-job creation', () => {
    it('should create export and import sub-jobs', async () => {
      const request = {
        source: { url: 'http://source.local', username: 'admin', password: 'pass' },
        destination: { url: 'http://dest.local', username: 'admin', password: 'pass' },
        options: { syncChannels: true },
      };

      await syncService.sync(request, 'sync-job-123');

      // Should create both backup and import sub-jobs
      const createJobCalls = (mockJobManager.createJob as Mock).mock.calls.map((c: any) => c[0]);
      expect(createJobCalls).toContain('backup');
      expect(createJobCalls).toContain('import');
    });
  });
});
