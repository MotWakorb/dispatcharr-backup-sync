/**
 * Tests to verify the test infrastructure (mocks, fixtures, helpers) works correctly.
 * This file serves as both verification and documentation of how to use the test utilities.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Import mock utilities
import {
  createMockClient,
  createPaginatedResponse,
  createAxiosError,
  MockDispatcharrClient,
} from './mocks/index.js';

// Import fixtures
import {
  sampleChannels,
  sampleChannelGroups,
  sampleStreams,
  sampleM3UAccounts,
  sampleEpgSources,
  sampleEpgData,
  samplePlugins,
  createChannel,
  createChannels,
  createStream,
  createEpgData,
} from './fixtures/index.js';

// Import helpers
import {
  createMockJobManager,
  waitForCondition,
  sleep,
  createDeferred,
  expectLogContains,
} from './helpers.js';

describe('Test Infrastructure', () => {
  describe('MockDispatcharrClient', () => {
    it('should create a mock client with default responses', async () => {
      const client = createMockClient();

      expect(client.connection.url).toBe('http://test-server.local');
      expect(client.connection.username).toBe('testuser');
    });

    it('should authenticate successfully by default', async () => {
      const client = createMockClient();
      const token = await client.authenticate();

      expect(token).toBe('mock-jwt-token');
    });

    it('should simulate auth failure when configured', async () => {
      const client = createMockClient({ authFailure: true });

      await expect(client.authenticate()).rejects.toThrow('Authentication failed');
    });

    it('should return configured responses for endpoints', async () => {
      const client = createMockClient({
        responses: {
          '/api/channels/channels/': sampleChannels,
          '/api/channels/groups/': sampleChannelGroups,
        },
      });

      const channels = await client.get('/api/channels/channels/');
      const groups = await client.get('/api/channels/groups/');

      expect(channels).toEqual(sampleChannels);
      expect(groups).toEqual(sampleChannelGroups);
    });

    it('should support wildcard pattern matching', async () => {
      const client = createMockClient({
        responses: {
          '/api/channels/*': sampleChannels,
        },
      });

      const result1 = await client.get('/api/channels/channels/');
      const result2 = await client.get('/api/channels/groups/');

      expect(result1).toEqual(sampleChannels);
      expect(result2).toEqual(sampleChannels);
    });

    it('should track API calls for assertions', async () => {
      const client = createMockClient();

      await client.get('/api/test/');
      await client.post('/api/create/', { name: 'test' });
      await client.patch('/api/update/1/', { value: 42 });

      expect(client.getCalls).toHaveLength(1);
      expect(client.getCalls[0].endpoint).toBe('/api/test/');

      expect(client.postCalls).toHaveLength(1);
      expect(client.postCalls[0].data).toEqual({ name: 'test' });

      expect(client.patchCalls).toHaveLength(1);
      expect(client.patchCalls[0].data).toEqual({ value: 42 });
    });

    it('should simulate errors for specific endpoints', async () => {
      const client = createMockClient({
        errorEndpoints: {
          '/api/fail/': 'Simulated error',
        },
      });

      await expect(client.get('/api/fail/')).rejects.toThrow('Simulated error');
    });

    it('should test connection successfully', async () => {
      const client = createMockClient();
      const result = await client.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful!');
    });
  });

  describe('createPaginatedResponse', () => {
    it('should create a paginated response structure', () => {
      const response = createPaginatedResponse(sampleChannels, 1, 100, false);

      expect(response.results).toEqual(sampleChannels);
      expect(response.next).toBeNull();
      expect(response.previous).toBeNull();
      expect(response.count).toBe(sampleChannels.length);
    });

    it('should include next link when hasNext is true', () => {
      const response = createPaginatedResponse(sampleChannels, 1, 100, true);

      expect(response.next).toBe('?page=2&page_size=100');
    });

    it('should include previous link for pages > 1', () => {
      const response = createPaginatedResponse(sampleChannels, 2, 100, false);

      expect(response.previous).toBe('?page=1&page_size=100');
    });
  });

  describe('createAxiosError', () => {
    it('should create an axios-style error', () => {
      const error = createAxiosError(404, 'Not found');

      expect(error.message).toBe('Not found');
      expect((error as any).response.status).toBe(404);
      expect((error as any).isAxiosError).toBe(true);
    });
  });

  describe('Fixtures', () => {
    it('should provide sample channel data', () => {
      expect(sampleChannels.length).toBeGreaterThan(0);
      expect(sampleChannels[0]).toHaveProperty('id');
      expect(sampleChannels[0]).toHaveProperty('name');
      expect(sampleChannels[0]).toHaveProperty('channel_number');
    });

    it('should provide sample stream data', () => {
      expect(sampleStreams.length).toBeGreaterThan(0);
      expect(sampleStreams[0]).toHaveProperty('id');
      expect(sampleStreams[0]).toHaveProperty('url');
    });

    it('should provide sample EPG data', () => {
      expect(sampleEpgSources.length).toBeGreaterThan(0);
      expect(sampleEpgData.length).toBeGreaterThan(0);
    });

    it('should create custom channels with factory', () => {
      const channel = createChannel({ name: 'Custom Channel', channel_number: 999 });

      expect(channel.name).toBe('Custom Channel');
      expect(channel.channel_number).toBe(999);
      expect(channel.active).toBe(true);
    });

    it('should create multiple channels', () => {
      const channels = createChannels(5);

      expect(channels).toHaveLength(5);
      channels.forEach((ch, i) => {
        expect(ch.id).toBe(i + 1);
        expect(ch.name).toBe(`Test Channel ${i + 1}`);
      });
    });

    it('should create custom streams with factory', () => {
      const stream = createStream({ name: 'Custom Stream', m3u_account: 1 });

      expect(stream.name).toBe('Custom Stream');
      expect(stream.m3u_account).toBe(1);
    });

    it('should create custom EPG data with factory', () => {
      const epg = createEpgData({ tvg_id: 'CUSTOM.us', name: 'Custom Channel' });

      expect(epg.tvg_id).toBe('CUSTOM.us');
      expect(epg.name).toBe('Custom Channel');
    });
  });

  describe('MockJobManager', () => {
    let mockJobManager: ReturnType<typeof createMockJobManager>;

    beforeEach(() => {
      mockJobManager = createMockJobManager('job-123');
    });

    it('should create a job', () => {
      const jobId = mockJobManager.createJob('sync');

      expect(jobId).toBe('job-123');
      expect(mockJobManager.createJob).toHaveBeenCalledWith('sync');
    });

    it('should track job status through lifecycle', () => {
      mockJobManager.createJob('sync');
      expect(mockJobManager.currentStatus?.status).toBe('pending');

      mockJobManager.startJob('job-123', 'Starting sync');
      expect(mockJobManager.currentStatus?.status).toBe('running');

      mockJobManager.setProgress('job-123', 50, 'Halfway done');
      expect(mockJobManager.currentStatus?.progress).toBe(50);

      mockJobManager.completeJob('job-123', { synced: 10 });
      expect(mockJobManager.currentStatus?.status).toBe('completed');
      expect(mockJobManager.currentStatus?.progress).toBe(100);
    });

    it('should record logs', () => {
      mockJobManager.addLog('job-123', 'First log');
      mockJobManager.addLog('job-123', 'Second log');

      expect(mockJobManager.logs).toHaveLength(2);
      expect(mockJobManager.logs[0]).toBe('First log');
    });

    it('should track progress updates', () => {
      mockJobManager.setProgress('job-123', 25, 'Quarter done');
      mockJobManager.setProgress('job-123', 50, 'Half done');
      mockJobManager.setProgress('job-123', 75, 'Almost done');

      expect(mockJobManager.progressUpdates).toHaveLength(3);
      expect(mockJobManager.progressUpdates.map((u) => u.progress)).toEqual([25, 50, 75]);
    });

    it('should reset state', () => {
      mockJobManager.addLog('job-123', 'Test log');
      mockJobManager.setProgress('job-123', 50);

      mockJobManager.reset();

      expect(mockJobManager.logs).toHaveLength(0);
      expect(mockJobManager.progressUpdates).toHaveLength(0);
      expect(mockJobManager.currentStatus?.status).toBe('pending');
    });
  });

  describe('Helper utilities', () => {
    it('should wait for condition', async () => {
      let value = false;
      setTimeout(() => {
        value = true;
      }, 50);

      await waitForCondition(() => value, { timeout: 1000 });
      expect(value).toBe(true);
    });

    it('should timeout when condition not met', async () => {
      await expect(
        waitForCondition(() => false, { timeout: 50, message: 'Test timeout' })
      ).rejects.toThrow('Test timeout');
    });

    it('should sleep for specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some timing variance
    });

    it('should create deferred promises', async () => {
      const deferred = createDeferred<string>();

      setTimeout(() => deferred.resolve('done'), 10);

      const result = await deferred.promise;
      expect(result).toBe('done');
    });

    it('should check logs contain message', () => {
      const mockJobManager = createMockJobManager();
      mockJobManager.addLog('job-123', 'Processing channels: 10 items');
      mockJobManager.addLog('job-123', 'Completed successfully');

      expectLogContains(mockJobManager, 'Processing channels');
      expectLogContains(mockJobManager, 'Completed');
    });
  });
});
