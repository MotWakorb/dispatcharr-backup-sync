import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs promises module before importing scheduleStore
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue('{"schedules": [], "entries": []}'),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock uuid to return predictable values
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-123'),
}));

// Set test data directory
process.env.DATA_DIR = '/tmp/dispatcharr-test-data';

describe('ScheduleStore', () => {
  let scheduleStore: any;
  let mockReadFile: any;
  let mockWriteFile: any;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    vi.resetModules();

    // Get fresh references to mocked functions
    const fs = await import('fs');
    mockReadFile = fs.promises.readFile;
    mockWriteFile = fs.promises.writeFile;

    // Import fresh instance
    const module = await import('../src/services/scheduleStore.js');
    scheduleStore = module.scheduleStore;
  });

  describe('getAll', () => {
    it('should return empty array when no schedules exist', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: [] }));

      const schedules = await scheduleStore.getAll();

      expect(schedules).toEqual([]);
    });

    it('should return all schedules', async () => {
      const mockSchedules = [
        { id: '1', name: 'Daily Backup', enabled: true },
        { id: '2', name: 'Weekly Sync', enabled: false },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: mockSchedules }));

      const schedules = await scheduleStore.getAll();

      expect(schedules).toEqual(mockSchedules);
      expect(schedules.length).toBe(2);
    });
  });

  describe('getById', () => {
    it('should return schedule when found', async () => {
      const mockSchedules = [
        { id: '1', name: 'Daily Backup' },
        { id: '2', name: 'Weekly Sync' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: mockSchedules }));

      const schedule = await scheduleStore.getById('1');

      expect(schedule).toEqual({ id: '1', name: 'Daily Backup' });
    });

    it('should return undefined when schedule not found', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: [] }));

      const schedule = await scheduleStore.getById('non-existent');

      expect(schedule).toBeUndefined();
    });
  });

  describe('create', () => {
    it('should create a new schedule with generated id and timestamps', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: [] }));

      const input = {
        name: 'New Schedule',
        enabled: true,
        cronExpression: '0 0 * * *',
        jobType: 'backup' as const,
        jobConfig: {},
      };

      const schedule = await scheduleStore.create(input);

      expect(schedule.id).toBe('test-uuid-123');
      expect(schedule.name).toBe('New Schedule');
      expect(schedule.enabled).toBe(true);
      expect(schedule.createdAt).toBeDefined();
      expect(schedule.updatedAt).toBeDefined();

      // Verify writeFile was called with the new schedule
      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);
      expect(writtenData.schedules.length).toBe(1);
      expect(writtenData.schedules[0].id).toBe('test-uuid-123');
    });
  });

  describe('update', () => {
    it('should update an existing schedule', async () => {
      const existingSchedule = {
        id: '1',
        name: 'Old Name',
        enabled: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: [existingSchedule] }));

      const updated = await scheduleStore.update('1', { name: 'New Name' });

      expect(updated.name).toBe('New Name');
      expect(updated.id).toBe('1');
      expect(updated.updatedAt).not.toBe(existingSchedule.updatedAt);
    });

    it('should throw error when schedule not found', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: [] }));

      await expect(scheduleStore.update('non-existent', { name: 'New Name' })).rejects.toThrow(
        'Schedule not found'
      );
    });
  });

  describe('delete', () => {
    it('should delete a schedule and its history', async () => {
      const schedules = [
        { id: '1', name: 'Schedule 1' },
        { id: '2', name: 'Schedule 2' },
      ];
      const historyEntries = [
        { scheduleId: '1', jobId: 'job-1' },
        { scheduleId: '2', jobId: 'job-2' },
      ];

      // First two reads are for schedules file, third and fourth for history
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify({ schedules }))
        .mockResolvedValueOnce(JSON.stringify({ entries: historyEntries }));

      await scheduleStore.delete('1');

      // Verify schedules file was written without deleted schedule
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      const schedulesWriteCall = mockWriteFile.mock.calls[0];
      const writtenSchedules = JSON.parse(schedulesWriteCall[1]);
      expect(writtenSchedules.schedules.length).toBe(1);
      expect(writtenSchedules.schedules[0].id).toBe('2');

      // Verify history file was written without deleted schedule's history
      const historyWriteCall = mockWriteFile.mock.calls[1];
      const writtenHistory = JSON.parse(historyWriteCall[1]);
      expect(writtenHistory.entries.length).toBe(1);
      expect(writtenHistory.entries[0].scheduleId).toBe('2');
    });
  });

  describe('updateLastRun', () => {
    it('should update schedule last run information', async () => {
      const existingSchedule = {
        id: '1',
        name: 'Test Schedule',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: [existingSchedule] }));

      await scheduleStore.updateLastRun('1', 'job-123', 'completed');

      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);
      expect(writtenData.schedules[0].lastRunJobId).toBe('job-123');
      expect(writtenData.schedules[0].lastRunStatus).toBe('completed');
      expect(writtenData.schedules[0].lastRunAt).toBeDefined();
    });

    it('should do nothing when schedule not found', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: [] }));

      await scheduleStore.updateLastRun('non-existent', 'job-123', 'completed');

      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('updateNextRunTime', () => {
    it('should update schedule next run time', async () => {
      const existingSchedule = { id: '1', name: 'Test Schedule' };
      mockReadFile.mockResolvedValue(JSON.stringify({ schedules: [existingSchedule] }));

      const nextRunAt = '2024-12-25T00:00:00.000Z';
      await scheduleStore.updateNextRunTime('1', nextRunAt);

      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);
      expect(writtenData.schedules[0].nextRunAt).toBe(nextRunAt);
    });
  });

  describe('recordRunStart', () => {
    it('should record a new run history entry', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ entries: [] }));

      await scheduleStore.recordRunStart('schedule-1', 'job-123');

      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);
      expect(writtenData.entries.length).toBe(1);
      expect(writtenData.entries[0].scheduleId).toBe('schedule-1');
      expect(writtenData.entries[0].jobId).toBe('job-123');
      expect(writtenData.entries[0].status).toBe('running');
      expect(writtenData.entries[0].startedAt).toBeDefined();
    });
  });

  describe('recordRunComplete', () => {
    it('should update run history entry with completion info', async () => {
      // First read for history file in recordRunComplete
      // Then read for schedules file in updateLastRun (called internally)
      const historyEntry = {
        scheduleId: 'schedule-1',
        jobId: 'job-123',
        startedAt: '2024-01-01T00:00:00.000Z',
        status: 'running',
      };
      const schedule = { id: 'schedule-1', name: 'Test Schedule' };

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify({ entries: [historyEntry] }))
        .mockResolvedValueOnce(JSON.stringify({ schedules: [schedule] }));

      await scheduleStore.recordRunComplete('schedule-1', 'job-123', 'completed');

      // First write is for history, second for schedules
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      const historyWriteCall = mockWriteFile.mock.calls[0];
      const writtenHistory = JSON.parse(historyWriteCall[1]);
      expect(writtenHistory.entries[0].status).toBe('completed');
      expect(writtenHistory.entries[0].completedAt).toBeDefined();
    });

    it('should include error message when status is failed', async () => {
      const historyEntry = {
        scheduleId: 'schedule-1',
        jobId: 'job-123',
        startedAt: '2024-01-01T00:00:00.000Z',
        status: 'running',
      };
      const schedule = { id: 'schedule-1', name: 'Test Schedule' };

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify({ entries: [historyEntry] }))
        .mockResolvedValueOnce(JSON.stringify({ schedules: [schedule] }));

      await scheduleStore.recordRunComplete('schedule-1', 'job-123', 'failed', 'Connection timeout');

      const historyWriteCall = mockWriteFile.mock.calls[0];
      const writtenHistory = JSON.parse(historyWriteCall[1]);
      expect(writtenHistory.entries[0].status).toBe('failed');
      expect(writtenHistory.entries[0].error).toBe('Connection timeout');
    });
  });

  describe('getRunHistory', () => {
    it('should return history entries for a schedule sorted by date descending', async () => {
      const entries = [
        { scheduleId: 'schedule-1', jobId: 'job-1', startedAt: '2024-01-01T00:00:00.000Z' },
        { scheduleId: 'schedule-1', jobId: 'job-2', startedAt: '2024-01-03T00:00:00.000Z' },
        { scheduleId: 'schedule-1', jobId: 'job-3', startedAt: '2024-01-02T00:00:00.000Z' },
        { scheduleId: 'schedule-2', jobId: 'job-4', startedAt: '2024-01-04T00:00:00.000Z' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ entries }));

      const history = await scheduleStore.getRunHistory('schedule-1');

      expect(history.length).toBe(3);
      expect(history[0].jobId).toBe('job-2'); // Most recent first
      expect(history[1].jobId).toBe('job-3');
      expect(history[2].jobId).toBe('job-1');
    });

    it('should respect limit parameter', async () => {
      const entries = [
        { scheduleId: 'schedule-1', jobId: 'job-1', startedAt: '2024-01-01T00:00:00.000Z' },
        { scheduleId: 'schedule-1', jobId: 'job-2', startedAt: '2024-01-02T00:00:00.000Z' },
        { scheduleId: 'schedule-1', jobId: 'job-3', startedAt: '2024-01-03T00:00:00.000Z' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ entries }));

      const history = await scheduleStore.getRunHistory('schedule-1', 2);

      expect(history.length).toBe(2);
    });
  });

  describe('getCompletedBackupJobIds', () => {
    it('should return completed job IDs sorted by date descending', async () => {
      const entries = [
        { scheduleId: 'schedule-1', jobId: 'job-1', status: 'completed', startedAt: '2024-01-01T00:00:00.000Z' },
        { scheduleId: 'schedule-1', jobId: 'job-2', status: 'failed', startedAt: '2024-01-02T00:00:00.000Z' },
        { scheduleId: 'schedule-1', jobId: 'job-3', status: 'completed', startedAt: '2024-01-03T00:00:00.000Z' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ entries }));

      const jobIds = await scheduleStore.getCompletedBackupJobIds('schedule-1');

      expect(jobIds).toEqual(['job-3', 'job-1']); // Excludes failed, sorted by date desc
    });
  });

  describe('deleteHistoryEntries', () => {
    it('should delete history entries for specified job IDs', async () => {
      const entries = [
        { scheduleId: 'schedule-1', jobId: 'job-1' },
        { scheduleId: 'schedule-1', jobId: 'job-2' },
        { scheduleId: 'schedule-1', jobId: 'job-3' },
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ entries }));

      await scheduleStore.deleteHistoryEntries(['job-1', 'job-3']);

      expect(mockWriteFile).toHaveBeenCalled();
      const writeCall = mockWriteFile.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);
      expect(writtenData.entries.length).toBe(1);
      expect(writtenData.entries[0].jobId).toBe('job-2');
    });
  });
});
