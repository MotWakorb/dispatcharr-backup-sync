import { DispatcharrClient } from './dispatcharrClient.js';
import { jobManager } from './jobManager.js';
import type { SyncRequest, SyncOptions } from '../types/index.js';

export class SyncService {
  private async getAllPaginated(client: any, endpoint: string): Promise<any[]> {
    let allResults: any[] = [];
    let page = 1;
    const pageSize = 1000;

    while (true) {
      const response = await client.get(`${endpoint}?page=${page}&page_size=${pageSize}`);

      if (response.results && Array.isArray(response.results)) {
        allResults = allResults.concat(response.results);
        if (!response.next) {
          break;
        }
        page++;
      } else if (Array.isArray(response)) {
        // Non-paginated response
        return response;
      } else {
        // Single object response
        return [response];
      }
    }

    return allResults;
  }

  private async assignEpgToChannels(
    sourceClient: DispatcharrClient,
    destClient: DispatcharrClient,
    jobId: string
  ): Promise<{ assigned: number; skipped: number; errors: number }> {
    let assigned = 0;
    let skipped = 0;
    let errors = 0;

    try {
      // Fetch data from both source and destination
      // Source: channels (with epg_data_id) and EPG data (for metadata lookup)
      // Destination: channels and EPG data
      const [sourceChannels, sourceEpgData, destChannels, destEpgData] = await Promise.all([
        this.getAllPaginated(sourceClient, '/api/channels/channels/').catch(() => []),
        this.getAllPaginated(sourceClient, '/api/epg/epgdata/').catch(() => []),
        this.getAllPaginated(destClient, '/api/channels/channels/').catch(() => []),
        this.getAllPaginated(destClient, '/api/epg/epgdata/').catch(() => []),
      ]);

      if (!Array.isArray(destChannels) || !Array.isArray(destEpgData) || destEpgData.length === 0) {
        jobManager.addLog(jobId, `EPG assignment: No destination EPG data available (${destEpgData?.length || 0} entries)`);
        return { assigned: 0, skipped: destChannels?.length || 0, errors: 0 };
      }

      jobManager.addLog(jobId, `EPG assignment: Source has ${sourceChannels?.length || 0} channels, ${sourceEpgData?.length || 0} EPG entries`);
      jobManager.addLog(jobId, `EPG assignment: Destination has ${destChannels.length} channels, ${destEpgData.length} EPG entries`);

      // Build source EPG lookup by ID (to get metadata from source EPG)
      const sourceEpgById: Record<number, any> = {};
      if (Array.isArray(sourceEpgData)) {
        for (const epg of sourceEpgData) {
          if (epg?.id != null) {
            sourceEpgById[epg.id] = epg;
          }
        }
      }

      // Build destination EPG lookup by tvg_id and name
      const destEpgByTvg: Record<string, number> = {};
      const destEpgByName: Record<string, number> = {};
      const destEpgIds = new Set<number>();

      for (const epg of destEpgData) {
        if (!epg?.id) continue;
        destEpgIds.add(epg.id);
        const tvgKey = this.normalizeKey(epg.tvg_id);
        if (tvgKey && !(tvgKey in destEpgByTvg)) destEpgByTvg[tvgKey] = epg.id;
        const nameKey = this.normalizeKey(epg.name);
        if (nameKey && !(nameKey in destEpgByName)) destEpgByName[nameKey] = epg.id;
      }

      // Build destination channel lookup by name+number and tvg_id
      const destByNameNumber: Record<string, any> = {};
      const destByTvg: Record<string, any> = {};
      const destByNameOnly: Record<string, any> = {};

      for (const ch of destChannels) {
        if (!ch?.id) continue;
        const nameKey = this.normalizeKey(ch?.name);
        const tvgKey = this.normalizeKey(ch?.tvg_id);
        const num = ch?.channel_number != null ? String(ch.channel_number) : '';
        if (nameKey) {
          destByNameOnly[nameKey] = ch;
          const composite = `${nameKey}|${num}`;
          destByNameNumber[composite] = ch;
        }
        if (tvgKey) {
          destByTvg[tvgKey] = ch;
        }
      }

      // Find channels that need EPG assignment using source channel relationships
      const channelsToUpdate: { channel: any; epgId: number; strategy: string }[] = [];
      let matchStats = {
        sourceEpgTvg: 0,
        sourceEpgName: 0,
        channelTvg: 0,
        channelStation: 0,
        channelName: 0,
        noMatch: 0,
        alreadyCorrect: 0, // Already has correct EPG (optimization - skip update)
      };

      if (Array.isArray(sourceChannels)) {
        for (const srcChannel of sourceChannels) {
          if (!srcChannel) continue;

          // Find matching destination channel
          const nameKey = this.normalizeKey(srcChannel?.name);
          const num = srcChannel?.channel_number != null ? String(srcChannel.channel_number) : '';
          const tvgKey = this.normalizeKey(srcChannel?.tvg_id);
          const stationKey = this.normalizeKey(srcChannel?.tvc_guide_stationid);
          const composite = nameKey ? `${nameKey}|${num}` : '';

          const destChannel = (composite && destByNameNumber[composite]) ||
                              (tvgKey && destByTvg[tvgKey]) ||
                              (nameKey && destByNameOnly[nameKey]);

          if (!destChannel) continue;

          // Note: Unlike import (which works on new channels), sync must handle
          // destination channels that may already have EPG assigned. We DON'T skip
          // these - we always re-match EPG from source to ensure destination matches source.
          const existingEpgId = destChannel.epg_data_id;

          let epgId: number | undefined;
          let matchStrategy: string | undefined;

          // Get source EPG metadata if source channel has an EPG assignment
          const sourceEpg = srcChannel?.epg_data_id != null ? sourceEpgById[srcChannel.epg_data_id] : undefined;
          const sourceEpgTvgKey = this.normalizeKey(sourceEpg?.tvg_id);
          const sourceEpgNameKey = this.normalizeKey(sourceEpg?.name);

          // Try to match by source EPG metadata first (most reliable)
          if (sourceEpgTvgKey && destEpgByTvg[sourceEpgTvgKey]) {
            epgId = destEpgByTvg[sourceEpgTvgKey];
            matchStrategy = 'source-epg-tvg-id';
            matchStats.sourceEpgTvg++;
          } else if (sourceEpgNameKey && destEpgByName[sourceEpgNameKey]) {
            epgId = destEpgByName[sourceEpgNameKey];
            matchStrategy = 'source-epg-name';
            matchStats.sourceEpgName++;
          } else {
            // Fallback: try channel metadata
            if (tvgKey && destEpgByTvg[tvgKey]) {
              epgId = destEpgByTvg[tvgKey];
              matchStrategy = 'channel-tvg-id';
              matchStats.channelTvg++;
            } else if (stationKey && destEpgByName[stationKey]) {
              epgId = destEpgByName[stationKey];
              matchStrategy = 'channel-station-id';
              matchStats.channelStation++;
            } else if (nameKey && destEpgByName[nameKey]) {
              epgId = destEpgByName[nameKey];
              matchStrategy = 'channel-name';
              matchStats.channelName++;
            }
          }

          if (epgId && matchStrategy) {
            // Optimization: skip if destination already has the correct EPG assigned
            if (existingEpgId === epgId) {
              matchStats.alreadyCorrect++;
              skipped++;
            } else {
              channelsToUpdate.push({ channel: destChannel, epgId, strategy: matchStrategy });
            }
          } else {
            matchStats.noMatch++;
            skipped++;
          }
        }
      }

      jobManager.addLog(jobId, `EPG from source: sourceEpgTvg=${matchStats.sourceEpgTvg}, sourceEpgName=${matchStats.sourceEpgName}, channelTvg=${matchStats.channelTvg}, channelStation=${matchStats.channelStation}, channelName=${matchStats.channelName}, noMatch=${matchStats.noMatch}, alreadyCorrect=${matchStats.alreadyCorrect}`);

      // Log first few matches for debugging
      for (let i = 0; i < Math.min(5, channelsToUpdate.length); i++) {
        const { channel, epgId, strategy } = channelsToUpdate[i];
        jobManager.addLog(jobId, `EPG match example: "${channel.name}" -> EPG ID ${epgId} via ${strategy}`);
      }

      // Second pass: fill remaining channels using target metadata (like import does)
      const alreadyQueued = new Set(channelsToUpdate.map(c => c.channel.id));
      let targetMetadataMatches = 0;

      for (const ch of destChannels) {
        if (!ch?.id || ch?.epg_data_id) continue;
        if (alreadyQueued.has(ch.id)) continue;

        const tvgKey = this.normalizeKey(ch?.tvg_id);
        const stationKey = this.normalizeKey(ch?.tvc_guide_stationid);
        const nameKey = this.normalizeKey(ch?.name);

        let epgId: number | undefined;
        let strategy: string | undefined;

        if (tvgKey && destEpgByTvg[tvgKey]) {
          epgId = destEpgByTvg[tvgKey];
          strategy = 'target-tvg-id';
        } else if (stationKey && destEpgByName[stationKey]) {
          epgId = destEpgByName[stationKey];
          strategy = 'target-station-id';
        } else if (nameKey && destEpgByName[nameKey]) {
          epgId = destEpgByName[nameKey];
          strategy = 'target-name';
        }

        if (epgId && strategy) {
          channelsToUpdate.push({ channel: ch, epgId, strategy });
          targetMetadataMatches++;
        }
      }

      if (targetMetadataMatches > 0) {
        jobManager.addLog(jobId, `EPG from target metadata: ${targetMetadataMatches} additional matches`);
      }

      jobManager.addLog(jobId, `EPG assignment: Total ${channelsToUpdate.length} EPG associations to apply`);

      if (channelsToUpdate.length === 0) {
        jobManager.addLog(jobId, 'No EPG associations found - channels may need manual EPG assignment');
        return { assigned: 0, skipped, errors: 0 };
      }

      // Apply EPG assignments
      for (let i = 0; i < channelsToUpdate.length; i++) {
        const { channel, epgId } = channelsToUpdate[i];
        try {
          await destClient.put(`/api/channels/channels/${channel.id}/`, {
            ...channel,
            epg_data_id: epgId,
          });
          assigned++;

          // Log progress every 100 channels
          if ((i + 1) % 100 === 0) {
            jobManager.addLog(jobId, `EPG assignment progress: ${i + 1}/${channelsToUpdate.length}`);
          }
        } catch (error: any) {
          errors++;
          if (errors <= 5) {
            jobManager.addLog(jobId, `EPG assignment failed for channel "${channel.name}": ${error.message}`);
          }
        }
      }

      jobManager.addLog(jobId, `EPG assignment: ${assigned} assigned, ${skipped} skipped, ${errors} errors`);
    } catch (error: any) {
      jobManager.addLog(jobId, `EPG assignment error: ${error.message}`);
    }

    return { assigned, skipped, errors };
  }

  private async waitForEpgData(
    client: DispatcharrClient,
    jobId: string,
    timeoutMs: number = 600000, // 10 minutes - EPG downloads and parsing can take time
    intervalMs: number = 10000, // Check every 10 seconds
    stabilityChecks: number = 12 // Wait for count to be stable for 12 checks (2 minutes of stability)
  ): Promise<void> {
    const start = Date.now();
    let previousCount = 0;
    let stableCount = 0;
    const dataAppearanceTimeout = 360000; // 6 minutes to wait for data to appear
    const minObservationTime = 180000; // Minimum 3 minutes observation after first growth

    jobManager.addLog(jobId, 'Waiting for EPG data to be downloaded and parsed...');

    // Get initial count
    try {
      const initialResp = await client.get('/api/epg/epgdata/?page=1&page_size=10000');
      if (Array.isArray(initialResp)) {
        previousCount = initialResp.length;
      } else if (initialResp?.count != null) {
        previousCount = initialResp.count;
      } else if (initialResp?.results) {
        previousCount = initialResp.results.length;
      } else {
        previousCount = 0;
      }
      jobManager.addLog(jobId, `Initial EPG data count: ${previousCount}`);
    } catch (error) {
      jobManager.addLog(jobId, 'Could not get initial EPG data count, will wait for data to appear');
    }

    // Phase 1: Wait for EPG data to appear (count > 0)
    if (previousCount === 0) {
      jobManager.addLog(jobId, 'Waiting for EPG sources to download and parse data (this may take several minutes)...');
      const phaseStart = Date.now();
      let checkCount = 0;
      while (Date.now() - phaseStart < dataAppearanceTimeout && Date.now() - start < timeoutMs) {
        try {
          const resp = await client.get('/api/epg/epgdata/?page=1&page_size=10000');
          let currentCount = 0;
          if (Array.isArray(resp)) {
            currentCount = resp.length;
          } else if (resp?.count != null) {
            currentCount = resp.count;
          } else if (resp?.results) {
            currentCount = resp.results.length;
          }
          checkCount++;

          // Log every 3rd check (every 30 seconds)
          if (checkCount % 3 === 0) {
            jobManager.addLog(jobId, `Still waiting for EPG data... (count: ${currentCount}, elapsed: ${Math.floor((Date.now() - phaseStart) / 1000)}s)`);
          }

          if (currentCount > 0) {
            jobManager.addLog(jobId, `EPG data started appearing: ${currentCount} entries found`);
            previousCount = currentCount;
            break;
          }
        } catch (error) {
          // ignore and retry
        }
        await new Promise((res) => globalThis.setTimeout(res, intervalMs));
      }

      // If still 0 after waiting, warn and proceed
      if (previousCount === 0) {
        jobManager.addLog(jobId, 'Warning: No EPG data appeared after 6 minutes. EPG sources may not be configured or have no data. Proceeding anyway...');
        return;
      }
    }

    // Phase 2: Wait for EPG data to stabilize (stop growing)
    jobManager.addLog(jobId, `EPG data found (${previousCount} entries), waiting for parsing to complete...`);
    const observationStart = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await client.get('/api/epg/epgdata/?page=1&page_size=10000');
        let currentCount = 0;
        if (Array.isArray(resp)) {
          currentCount = resp.length;
        } else if (resp?.count != null) {
          currentCount = resp.count;
        } else if (resp?.results) {
          currentCount = resp.results.length;
        }

        const observationTime = Date.now() - observationStart;

        if (currentCount === previousCount) {
          stableCount++;
          // Require both stability AND minimum observation time
          if (stableCount >= stabilityChecks && observationTime >= minObservationTime) {
            jobManager.addLog(jobId, `EPG data stable at ${currentCount} entries after ${Math.floor(observationTime / 1000)}s, proceeding with EPG assignment`);
            return;
          } else if (stableCount >= stabilityChecks && observationTime < minObservationTime) {
            const remaining = Math.floor((minObservationTime - observationTime) / 1000);
            jobManager.addLog(jobId, `EPG appears stable at ${currentCount} entries, but waiting ${remaining}s more to ensure all sources are parsed...`);
          }
        } else {
          // Count changed, reset stability counter
          stableCount = 0;
          jobManager.addLog(jobId, `EPG data growing: ${previousCount} -> ${currentCount} entries`);
          previousCount = currentCount;
        }
      } catch (error) {
        // ignore and retry
      }
      await new Promise((res) => globalThis.setTimeout(res, intervalMs));
    }

    jobManager.addLog(jobId, `Timed out waiting for EPG data to stabilize (current count: ${previousCount}), proceeding anyway`);
  }

  private async waitForStreams(
    client: DispatcharrClient,
    jobId: string,
    timeoutMs: number = 120000,
    intervalMs: number = 3000
  ): Promise<void> {
    const start = Date.now();
    let lastCount = 0;
    let stableChecks = 0;
    const requiredStableChecks = 3;

    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await client.get('/api/channels/streams/?page=1&page_size=1');
        const count = resp?.count || (Array.isArray(resp?.results) ? resp.results.length : 0);

        if (count > 0) {
          if (count === lastCount) {
            stableChecks++;
            if (stableChecks >= requiredStableChecks) {
              jobManager.addLog(jobId, `Streams stable at ${count} entries; proceeding with channel-stream mapping`);
              return;
            }
          } else {
            stableChecks = 0;
            if (lastCount > 0) {
              jobManager.addLog(jobId, `Streams still loading: ${lastCount} -> ${count}`);
            }
            lastCount = count;
          }
        }
      } catch {
        // ignore and retry
      }
      await new Promise((res) => globalThis.setTimeout(res, intervalMs));
    }
    jobManager.addLog(jobId, `Timed out waiting for streams (count: ${lastCount}); channel-stream mapping may be incomplete`);
  }

  async sync(request: SyncRequest, jobId: string): Promise<void> {
    try {
      jobManager.startJob(jobId, 'Initializing sync...');

      const sourceClient = new DispatcharrClient(request.source);
      const destClient = new DispatcharrClient(request.destination);

      // Authenticate both clients
      jobManager.setProgress(jobId, 5, 'Authenticating to source...');
      await sourceClient.authenticate();

      jobManager.setProgress(jobId, 10, 'Authenticating to destination...');
      await destClient.authenticate();

      const results: any = {
        synced: {},
        skipped: {},
        errors: {},
      };

      let currentProgress = 15;
      const totalSteps = Math.max(this.countEnabledOptions(request.options), 1);
      const progressPerStep = 80 / totalSteps; // 80% for sync steps, 20% for auth/complete

      // Order matches importService.ts for proper dependency handling:
      // 1. M3U Sources (needed for streams)
      // 2. EPG Sources (needed for EPG data)
      // 3. Channel Profiles (needed for channel associations)
      // 4. Channel Groups (needed for channel assignment)
      // 5. Stream Profiles (needed for channel stream_profile_id)
      // 6. Channels (depends on groups and stream profiles)
      // 7. User Agents
      // 8. Core Settings
      // 9. Plugins
      // 10. DVR Rules
      // 11. Comskip Config
      // 12. Users
      // 13. Logos

      // 1. Sync M3U Sources
      if (request.options.syncM3USources) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing M3U sources...');
        results.synced.m3uSources = await this.syncM3USources(
          sourceClient,
          destClient,
          request.dryRun,
          jobId
        );
        currentProgress += progressPerStep;
      }

      // 2. Sync EPG Sources
      if (request.options.syncEPGSources) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing EPG sources...');
        results.synced.epgSources = await this.syncEPGSources(
          sourceClient,
          destClient,
          request.dryRun,
          jobId
        );
        currentProgress += progressPerStep;

        // Trigger EPG refresh to force sources to download fresh data
        // (existing sources may not auto-refresh when updated via PUT)
        if (!request.dryRun) {
          jobManager.setProgress(jobId, currentProgress, 'Triggering EPG sources to download data...');
          await this.triggerEpgRefresh(destClient, jobId);
        }

        // Wait for EPG data to be downloaded BEFORE syncing channels
        // (matches import order: EPG sources → wait for EPG data → channel profiles → channels)
        if (!request.dryRun) {
          jobManager.setProgress(jobId, currentProgress, 'Waiting for EPG data to be downloaded from sources...');
          await this.waitForEpgData(destClient, jobId);
        }
      }

      // 3. Sync Channel Profiles
      if (request.options.syncChannelProfiles) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing channel profiles...');
        results.synced.channelProfiles = await this.syncChannelProfiles(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // 4. Sync Channel Groups
      if (request.options.syncChannelGroups) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing channel groups...');
        results.synced.channelGroups = await this.syncChannelGroups(
          sourceClient,
          destClient,
          request.dryRun,
          jobId
        );
        currentProgress += progressPerStep;
      }

      // 5. Sync Stream Profiles
      if (request.options.syncStreamProfiles) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing stream profiles...');
        results.synced.streamProfiles = await this.syncStreamProfiles(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // 6. Sync Channels
      if (request.options.syncChannels) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing channels...');
        results.synced.channels = await this.syncChannels(
          sourceClient,
          destClient,
          request.dryRun,
          jobId
        );
        currentProgress += progressPerStep;

        // Assign EPG to channels IMMEDIATELY after channel sync
        // (matches import order: channels → EPG assignment → channel profile associations)
        // NOTE: Do this regardless of syncEPGSources - dest may already have EPG data from previous sync/import
        if (!request.dryRun) {
          jobManager.setProgress(jobId, currentProgress, 'Assigning EPG data to channels...');
          results.synced.epgAssignment = await this.assignEpgToChannels(sourceClient, destClient, jobId);
        }

        // Apply channel profile associations AFTER channels are synced
        // (matches import order: channels → EPG assignment → channel profile associations)
        if (request.options.syncChannelProfiles && !request.dryRun) {
          jobManager.setProgress(jobId, currentProgress, 'Applying channel profile associations...');
          await this.syncChannelProfileAssociations(sourceClient, destClient);
          jobManager.addLog(jobId, 'Channel profile associations synced');
        }
      }

      // 7. Sync User Agents
      if (request.options.syncUserAgents) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing user agents...');
        results.synced.userAgents = await this.syncUserAgents(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // 8. Sync Core Settings
      if (request.options.syncCoreSettings) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing core settings...');
        results.synced.coreSettings = await this.syncCoreSettings(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // 9. Sync Plugins
      if (request.options.syncPlugins) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing plugins...');
        results.synced.plugins = await this.syncPlugins(sourceClient, destClient, request.dryRun);
        currentProgress += progressPerStep;
      }

      // 10. Sync DVR Rules
      if (request.options.syncDVRRules) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing DVR rules...');
        results.synced.dvrRules = await this.syncDVRRules(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // 11. Sync Comskip Config
      if (request.options.syncComskipConfig) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing comskip config...');
        results.synced.comskipConfig = await this.syncComskipConfig(
          sourceClient,
          destClient,
          request.dryRun,
          jobId
        );
        currentProgress += progressPerStep;
      }

      // 12. Sync Users
      if (request.options.syncUsers) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing users...');
        results.synced.users = await this.syncUsers(sourceClient, destClient, request.dryRun);
        currentProgress += progressPerStep;
      }

      // 13. Sync Logos
      if (request.options.syncLogos) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing logos...');
        results.synced.logos = await this.syncLogos(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // 14. Trigger EPG refresh after sync to ensure EPG data is assigned to channels
      // (matches import order: final step to toggle EPG sources and trigger re-download)
      if (request.options.syncEPGSources && !request.dryRun) {
        jobManager.setProgress(jobId, 95, 'Triggering EPG refresh to assign data to channels...');
        try {
          await this.triggerEpgRefresh(destClient, jobId);
        } catch (error: any) {
          jobManager.addLog(jobId, `Warning: EPG refresh trigger failed: ${error.message}`);
        }
      }

      jobManager.completeJob(jobId, results);
    } catch (error: any) {
      jobManager.failJob(jobId, error.message);
      throw error;
    }
  }

  private countEnabledOptions(options: SyncOptions): number {
    const supportedKeys = new Set([
      'syncChannelGroups',
      'syncChannelProfiles',
      'syncChannels',
      'syncM3USources',
      'syncStreamProfiles',
      'syncUserAgents',
      'syncCoreSettings',
      'syncEPGSources',
      'syncUsers',
      'syncPlugins',
      'syncDVRRules',
      'syncComskipConfig',
      'syncLogos',
    ]);

    return Object.entries(options).filter(([key, value]) => value === true && supportedKeys.has(key)).length;
  }

  private async syncChannelGroups(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean,
    jobId?: string
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceGroups = await source.get('/api/channels/groups/');
    // Fetch current dest groups - M3U refresh may have already created many of them
    const destGroups = await dest.get('/api/channels/groups/');
    const destGroupList = Array.isArray(destGroups) ? destGroups : destGroups.results || [];

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const sourceList = Array.isArray(sourceGroups) ? sourceGroups : sourceGroups.results || [];

    for (const group of sourceList) {
      try {
        const existing = destGroupList.find((g: any) => g.name?.toLowerCase() === group.name?.toLowerCase());

        // Skip if group already exists on destination (likely created by M3U refresh)
        if (existing) {
          skipped++;
          continue;
        }

        if (dryRun) {
          synced++;
          continue;
        }

        const groupData = { name: group.name };
        await dest.post('/api/channels/groups/', groupData);
        synced++;
      } catch (error: any) {
        const errMsg = error?.response?.data?.error || error?.response?.data?.detail || error?.message || 'Unknown error';
        if (jobId) {
          jobManager.addLog(jobId, `Channel group "${group.name}": Failed - ${errMsg}`);
        }
        errors++;
      }
    }

    if (jobId && skipped > 0) {
      jobManager.addLog(jobId, `Channel groups: ${skipped} already existed (from M3U refresh), ${synced} created`);
    }

    return { synced, skipped, errors };
  }

  private async syncChannelProfiles(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceProfiles = await source.get('/api/channels/profiles/');
    const destProfiles = await dest.get('/api/channels/profiles/');

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    // First, sync the profiles themselves
    for (const profile of sourceProfiles) {
      try {
        const existing = destProfiles.find((p: any) => p.name === profile.name);

        if (dryRun) {
          synced++;
          continue;
        }

        const profileData = { name: profile.name };

        if (existing) {
          await dest.put(`/api/channels/profiles/${existing.id}/`, profileData);
        } else {
          await dest.post('/api/channels/profiles/', profileData);
        }
        synced++;
      } catch (error) {
        errors++;
      }
    }

    // Note: Channel profile associations are synced AFTER channels are synced
    // (matching import order). See sync() method.

    return { synced, skipped, errors };
  }

  private async syncChannelProfileAssociations(
    source: DispatcharrClient,
    dest: DispatcharrClient
  ): Promise<void> {
    const sourceProfiles = await source.get('/api/channels/profiles/');
    const destProfiles = await dest.get('/api/channels/profiles/');
    const sourceChannels = await source.get('/api/channels/channels/').catch(() => ({ results: [] }));
    const destChannels = await dest.get('/api/channels/channels/').catch(() => ({ results: [] }));

    const sourceChannelsList = Array.isArray(sourceChannels) ? sourceChannels : sourceChannels.results || [];
    const destChannelsList = Array.isArray(destChannels) ? destChannels : destChannels.results || [];

    // Build channel mapping (source channel -> dest channel)
    const channelMap: Record<number, number> = {};
    for (const sourceChannel of sourceChannelsList) {
      const destChannel = destChannelsList.find(
        (dc: any) => dc.name === sourceChannel.name && dc.channel_number === sourceChannel.channel_number
      );
      if (sourceChannel.id && destChannel?.id) {
        channelMap[sourceChannel.id] = destChannel.id;
      }
    }

    // For each profile, sync the channel associations
    for (const sourceProfile of sourceProfiles) {
      try {
        const destProfile = destProfiles.find((p: any) => p.name === sourceProfile.name);
        if (!destProfile) continue;

        // Get channel IDs from source profile (already in profile.channels array)
        const sourceChannelIds = Array.isArray(sourceProfile.channels) ? sourceProfile.channels : [];

        // Map to destination channel IDs
        const enabledDestChannelIds = sourceChannelIds
          .map((sid: number) => channelMap[sid])
          .filter((id: number | undefined) => id != null);

        if (enabledDestChannelIds.length > 0) {
          // Enable each channel individually using the per-channel endpoint
          for (const channelId of enabledDestChannelIds) {
            try {
              await dest.patch(`/api/channels/profiles/${destProfile.id}/channels/${channelId}/`, {
                enabled: true
              });
            } catch (err) {
              // Continue with other channels even if one fails
            }
          }
        }
      } catch (error) {
        // Continue with other profiles even if one fails
      }
    }
  }

  private normalizeKey(value: any): string {
    if (value == null) return '';
    return String(value).toLowerCase().trim();
  }

  private async syncChannels(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean,
    jobId?: string
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceChannels = await source.get('/api/channels/channels/');
    const destChannels = await dest.get('/api/channels/channels/');

    // Build stream profile mapping by name
    const sourceProfiles = await source.get('/api/core/streamprofiles/').catch(() => []);
    const destProfiles = await dest.get('/api/core/streamprofiles/').catch(() => []);
    const profileMap: Record<number, number> = {};

    for (const sourceProfile of (Array.isArray(sourceProfiles) ? sourceProfiles : [])) {
      const destProfile = (Array.isArray(destProfiles) ? destProfiles : []).find(
        (p: any) => p.name === sourceProfile.name
      );
      if (sourceProfile.id && destProfile?.id) {
        profileMap[sourceProfile.id] = destProfile.id;
      }
    }

    // Build channel group mapping by name
    const sourceGroups = await source.get('/api/channels/groups/').catch(() => []);
    const destGroups = await dest.get('/api/channels/groups/').catch(() => []);
    const sourceGroupList = Array.isArray(sourceGroups) ? sourceGroups : sourceGroups.results || [];
    const destGroupList = Array.isArray(destGroups) ? destGroups : destGroups.results || [];

    const sourceGroupIdToName: Record<number, string> = {};
    for (const g of sourceGroupList) {
      if (g?.id != null && g?.name) {
        sourceGroupIdToName[g.id] = g.name;
      }
    }

    const destGroupNameToId: Record<string, number> = {};
    for (const g of destGroupList) {
      if (g?.id != null && g?.name) {
        destGroupNameToId[g.name.toLowerCase()] = g.id;
      }
    }

    // Wait for destination streams to be available (M3U refresh may still be running)
    if (jobId) {
      jobManager.addLog(jobId, 'Waiting for destination streams to be available...');
      await this.waitForStreams(dest, jobId);
    }

    // Fetch SOURCE streams to get their metadata (the channel.streams array may just contain IDs)
    const sourceStreams = await this.getAllPaginated(source, '/api/channels/streams/').catch(() => []);
    const sourceStreamById: Record<number, any> = {};
    if (Array.isArray(sourceStreams)) {
      for (const stream of sourceStreams) {
        if (stream?.id != null) {
          sourceStreamById[stream.id] = stream;
        }
      }
    }

    if (jobId) {
      jobManager.addLog(jobId, `Fetched ${Object.keys(sourceStreamById).length} source streams for metadata lookup`);
    }

    // Fetch destination streams and build lookup tables for stream matching
    const destStreams = await this.getAllPaginated(dest, '/api/channels/streams/').catch(() => []);
    const streamByHash: Record<string, number> = {};
    const streamByTvgId: Record<string, number[]> = {};
    const streamByName: Record<string, number[]> = {};
    const streamByStation: Record<string, number[]> = {};

    const pushMatch = (map: Record<string, number[]>, key: string, id: number) => {
      if (!map[key]) map[key] = [];
      if (!map[key].includes(id)) map[key].push(id);
    };

    if (Array.isArray(destStreams)) {
      for (const stream of destStreams) {
        const hashKey = this.normalizeKey(stream?.stream_hash || stream?.hash);
        if (hashKey && stream?.id != null) {
          streamByHash[hashKey] = stream.id;
        }
        const tvgKey = this.normalizeKey(stream?.tvg_id);
        if (tvgKey && stream?.id != null) {
          pushMatch(streamByTvgId, tvgKey, stream.id);
        }
        const nameKey = this.normalizeKey(stream?.name);
        if (nameKey && stream?.id != null) {
          pushMatch(streamByName, nameKey, stream.id);
        }
        const stationKey = this.normalizeKey(stream?.tvc_guide_stationid);
        if (stationKey && stream?.id != null) {
          pushMatch(streamByStation, stationKey, stream.id);
        }
      }
    }

    if (jobId) {
      jobManager.addLog(jobId, `Dest stream lookup sizes -> byHash:${Object.keys(streamByHash).length} byTvg:${Object.keys(streamByTvgId).length} byName:${Object.keys(streamByName).length} byStation:${Object.keys(streamByStation).length}`);
    }

    let synced = 0;
    let skipped = 0;
    let errors = 0;
    let streamsMatched = 0;
    let streamsUnmatched = 0;
    let groupsAssigned = 0;
    let customStreamsCreated = 0;
    let debugLogged = 0;
    const debugLimit = 5;

    const allChannels = Array.isArray(sourceChannels) ? sourceChannels : sourceChannels.results || [];
    // Filter out auto-created channels (those created via M3U auto channel sync)
    const channels = allChannels.filter((c: any) => !c.auto_created);

    if (jobId && allChannels.length !== channels.length) {
      jobManager.addLog(jobId, `Skipping ${allChannels.length - channels.length} auto-created channels (from M3U auto sync)`);
    }

    for (const channel of channels) {
      try {
        const destChannelList = Array.isArray(destChannels)
          ? destChannels
          : destChannels.results || [];
        const existing = destChannelList.find(
          (c: any) => c.name === channel.name && c.channel_number === channel.channel_number
        );

        if (dryRun) {
          synced++;
          continue;
        }

        const channelData: any = {
          name: channel.name,
        };

        if (channel.channel_number != null) {
          channelData.channel_number = channel.channel_number;
        }

        // Map channel group ID
        if (channel.channel_group_id != null) {
          const groupName = sourceGroupIdToName[channel.channel_group_id];
          if (groupName) {
            const destGroupId = destGroupNameToId[groupName.toLowerCase()];
            if (destGroupId) {
              channelData.channel_group_id = destGroupId;
            }
          }
        }

        // Fallback: if no group ID was mapped and channel has a group name, try to find by name
        if (channelData.channel_group_id == null && channel.channel_group) {
          const destGroupId = destGroupNameToId[channel.channel_group.toLowerCase()];
          if (destGroupId) {
            channelData.channel_group_id = destGroupId;
          }
        }

        if (channelData.channel_group_id != null) {
          groupsAssigned++;
        }

        // Debug logging for first few channels
        if (jobId && debugLogged < debugLimit) {
          jobManager.addLog(jobId, `Channel "${channel.name}" #${channel.channel_number}: group_id=${channel.channel_group_id}->${channelData.channel_group_id}, tvg_id=${channel.tvg_id}`);
          debugLogged++;
        }

        // Copy tvg_id and tvc_guide_stationid
        if (channel.tvg_id != null) {
          channelData.tvg_id = channel.tvg_id;
        }
        if (channel.tvc_guide_stationid != null) {
          channelData.tvc_guide_stationid = channel.tvc_guide_stationid;
        }

        // Map stream profile ID if present
        if (channel.stream_profile_id && profileMap[channel.stream_profile_id]) {
          channelData.stream_profile_id = profileMap[channel.stream_profile_id];
        }

        // Match streams using lookup tables (similar to importService logic)
        const matchedStreams = new Set<number>();

        const addStreams = (ids?: number[]) => {
          ids?.forEach((id) => matchedStreams.add(id));
        };

        // Match by tvg_id
        const tvgKey = this.normalizeKey(channel?.tvg_id);
        if (tvgKey && streamByTvgId[tvgKey]) {
          addStreams(streamByTvgId[tvgKey]);
        }

        // Match by tvc_guide_stationid
        const stationKey = this.normalizeKey(channel?.tvc_guide_stationid);
        if (stationKey && streamByStation[stationKey]) {
          addStreams(streamByStation[stationKey]);
        }

        // Match by name (try full name and suffix after delimiter)
        const nameVariants: string[] = [];
        const nameKey = this.normalizeKey(channel?.name);
        if (nameKey) nameVariants.push(nameKey);
        const parts = typeof channel?.name === 'string' ? channel.name.split('|') : [];
        if (parts.length > 1) {
          const suffix = this.normalizeKey(parts.slice(1).join('|'));
          if (suffix) nameVariants.push(suffix);
        }
        for (const nk of nameVariants) {
          if (nk && streamByName[nk]) {
            addStreams(streamByName[nk]);
          }
        }

        // If source channel has streams array, look up source stream metadata and match to destination
        if (Array.isArray(channel.streams)) {
          for (const s of channel.streams) {
            // s could be a number (ID) or an object
            let sourceStream: any = null;

            if (typeof s === 'number') {
              // Look up stream metadata from source
              sourceStream = sourceStreamById[s];
            } else if (s && typeof s === 'object') {
              // Use the object directly, but also try to enrich from sourceStreamById
              sourceStream = s.id != null ? { ...sourceStreamById[s.id], ...s } : s;
            }

            if (sourceStream) {
              const hashKey = this.normalizeKey(sourceStream.stream_hash || sourceStream.hash);
              if (hashKey && streamByHash[hashKey]) {
                matchedStreams.add(streamByHash[hashKey]);
              }
              const stvgKey = this.normalizeKey(sourceStream.tvg_id || sourceStream.tvgId);
              if (stvgKey && streamByTvgId[stvgKey]) {
                addStreams(streamByTvgId[stvgKey]);
              }
              const snameKey = this.normalizeKey(sourceStream.name);
              if (snameKey && streamByName[snameKey]) {
                addStreams(streamByName[snameKey]);
              }
            }
          }
        }

        // If no matches found and channel has streams with URLs, try creating custom streams
        // (Similar to import logic for hand-made channels with direct URLs)
        if (matchedStreams.size === 0 && Array.isArray(channel.streams)) {
          const creatableStreams = channel.streams
            .map((s: any) => {
              // Get full stream metadata from source
              if (typeof s === 'number') {
                return sourceStreamById[s];
              } else if (s && typeof s === 'object') {
                return s.id != null ? { ...sourceStreamById[s.id], ...s } : s;
              }
              return null;
            })
            .filter((s: any) => s && s.url); // Only streams with URLs can be created

          for (const stream of creatableStreams) {
            try {
              const streamPayload: any = {
                name: stream.name || channel.name,
                url: stream.url,
              };

              // Add optional fields if present
              if (stream.tvg_id) streamPayload.tvg_id = stream.tvg_id;
              if (stream.stream_hash || stream.hash) {
                streamPayload.stream_hash = stream.stream_hash || stream.hash;
              }
              if (stream.tvc_guide_stationid) {
                streamPayload.tvc_guide_stationid = stream.tvc_guide_stationid;
              }

              // Map stream profile if present
              const mappedProfileId = stream.stream_profile_id ? profileMap[stream.stream_profile_id] : undefined;
              if (mappedProfileId) {
                streamPayload.stream_profile_id = mappedProfileId;
              }

              // Map channel group if present
              if (stream.channel_group != null) {
                const groupName = sourceGroupIdToName[stream.channel_group];
                if (groupName) {
                  const destGroupId = destGroupNameToId[groupName.toLowerCase()];
                  if (destGroupId) {
                    streamPayload.channel_group = destGroupId;
                  }
                }
              }

              // Create the custom stream
              const created = await dest.post('/api/channels/streams/', streamPayload);
              if (created?.id) {
                matchedStreams.add(created.id);
                customStreamsCreated++;
                if (jobId && customStreamsCreated <= 5) {
                  jobManager.addLog(jobId, `Created custom stream "${streamPayload.name}" for channel "${channel.name}"`);
                }
              }
            } catch (err: any) {
              if (jobId) {
                jobManager.addLog(jobId, `Failed to create custom stream for "${channel.name}": ${err.message}`);
              }
            }
          }
        }

        if (matchedStreams.size > 0) {
          channelData.streams = Array.from(matchedStreams);
          streamsMatched++;
        } else {
          streamsUnmatched++;
        }

        if (existing) {
          await dest.put(`/api/channels/channels/${existing.id}/`, channelData);
        } else {
          await dest.post('/api/channels/channels/', channelData);
        }
        synced++;
      } catch (error: any) {
        const errMsg = error?.response?.data?.error || error?.response?.data?.detail || error?.message || 'Unknown error';
        if (jobId) {
          jobManager.addLog(jobId, `Channel "${channel.name}" (#${channel.channel_number}): Failed - ${errMsg}`);
        }
        errors++;
      }
    }

    if (jobId) {
      jobManager.addLog(jobId, `Channels: ${streamsMatched} with streams matched, ${streamsUnmatched} without stream matches, ${groupsAssigned} with groups assigned, ${customStreamsCreated} custom streams created`);
    }

    return { synced, skipped, errors };
  }

  private async syncUsers(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceUsers = await source.get('/api/accounts/users/');
    const destUsers = await dest.get('/api/accounts/users/');

    // Filter out admin users
    const filteredUsers = sourceUsers.filter(
      (u: any) => !u.is_staff && u.user_level !== 0
    );

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of filteredUsers) {
      try {
        const existing = destUsers.find((u: any) => u.username === user.username);

        if (dryRun) {
          synced++;
          continue;
        }

        const userData: any = {
          username: user.username,
          email: user.email,
          user_level: user.user_level,
          is_active: user.is_active,
        };

        if (user.custom_properties) {
          userData.custom_properties = user.custom_properties;
        }

        if (existing) {
          await dest.put(`/api/accounts/users/${existing.id}/`, userData);
        } else {
          if (user.password) {
            userData.password = user.password;
          }
          await dest.post('/api/accounts/users/', userData);
        }
        synced++;
      } catch (error) {
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async syncPlugins(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourcePluginsResp = await source.get('/api/plugins/plugins/');
    const destPluginsResp = await dest.get('/api/plugins/plugins/');

    // API returns {"plugins": [...]} - extract the array
    const sourcePlugins = Array.isArray(sourcePluginsResp) ? sourcePluginsResp : (sourcePluginsResp?.plugins || []);
    const destPlugins = Array.isArray(destPluginsResp) ? destPluginsResp : (destPluginsResp?.plugins || []);

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const plugin of sourcePlugins) {
      try {
        if (!plugin.key) {
          skipped++;
          continue;
        }

        const existing = destPlugins.find((p: any) => p.key === plugin.key);

        if (!existing) {
          skipped++;
          continue;
        }

        if (!plugin.settings) {
          skipped++;
          continue;
        }

        if (dryRun) {
          synced++;
          continue;
        }

        await dest.post(`/api/plugins/plugins/${plugin.key}/settings/`, plugin.settings);
        synced++;
      } catch (error) {
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async syncDVRRules(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceRules = await source.get('/api/channels/recurring-rules/');
    const destRules = await dest.get('/api/channels/recurring-rules/');

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const rule of sourceRules) {
      try {
        const existing = destRules.find(
          (r: any) =>
            r.name === rule.name &&
            r.start_time === rule.start_time &&
            r.end_time === rule.end_time
        );

        if (dryRun) {
          synced++;
          continue;
        }

        const ruleData: any = {
          start_time: rule.start_time,
          end_time: rule.end_time,
          enabled: rule.enabled,
        };

        if (rule.name) ruleData.name = rule.name;
        if (rule.days_of_week) ruleData.days_of_week = rule.days_of_week;
        if (rule.channel) ruleData.channel = rule.channel;

        if (existing) {
          await dest.put(`/api/channels/recurring-rules/${existing.id}/`, ruleData);
        } else {
          await dest.post('/api/channels/recurring-rules/', ruleData);
        }
        synced++;
      } catch (error) {
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async syncM3USources(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean,
    jobId?: string
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceAccounts = await source.get('/api/m3u/accounts/');
    const destAccounts = await dest.get('/api/m3u/accounts/');

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const sourceList = Array.isArray(sourceAccounts) ? sourceAccounts : sourceAccounts.results || [];
    const destList = Array.isArray(destAccounts) ? destAccounts : destAccounts.results || [];

    // Build channel group mappings for ID translation
    const sourceGroups = await source.get('/api/channels/groups/').catch(() => []);
    const destGroups = await dest.get('/api/channels/groups/').catch(() => []);

    const sourceGroupList = Array.isArray(sourceGroups) ? sourceGroups : sourceGroups.results || [];
    const destGroupList = Array.isArray(destGroups) ? destGroups : destGroups.results || [];

    // Source ID -> name mapping
    const sourceGroupIdToName: Record<number, string> = {};
    for (const g of sourceGroupList) {
      if (g?.id != null && g?.name) {
        sourceGroupIdToName[g.id] = g.name;
      }
    }

    // Dest name -> ID mapping
    const destGroupNameToId: Record<string, number> = {};
    for (const g of destGroupList) {
      if (g?.id != null && g?.name) {
        destGroupNameToId[g.name.toLowerCase()] = g.id;
      }
    }

    // Helper to ensure a channel group exists on dest
    const ensureDestGroup = async (name: string): Promise<number | undefined> => {
      const lowerName = name.toLowerCase();
      if (destGroupNameToId[lowerName]) {
        return destGroupNameToId[lowerName];
      }
      try {
        const created = await dest.post('/api/channels/groups/', { name });
        if (created?.id) {
          destGroupNameToId[lowerName] = created.id;
          return created.id;
        }
      } catch {
        // Group might already exist, try to find it
        const refreshed = await dest.get('/api/channels/groups/').catch(() => []);
        const refreshedList = Array.isArray(refreshed) ? refreshed : refreshed.results || [];
        const found = refreshedList.find((g: any) => g.name?.toLowerCase() === lowerName);
        if (found?.id) {
          destGroupNameToId[lowerName] = found.id;
          return found.id;
        }
      }
      return undefined;
    };

    for (const account of sourceList) {
      try {
        const existing = destList.find((a: any) => a.name === account.name);

        if (dryRun) {
          synced++;
          continue;
        }

        const { id, created_at, updated_at, channel_groups, ...basePayload } = account;

        // Transform channel_groups to use destination IDs
        let transformedChannelGroups: any[] | undefined;
        if (Array.isArray(channel_groups) && channel_groups.length > 0) {
          transformedChannelGroups = [];
          for (const cg of channel_groups) {
            const sourceGroupId = cg.channel_group;
            const groupName = cg.channel_group_name || sourceGroupIdToName[sourceGroupId];

            if (!groupName) {
              if (jobId) {
                jobManager.addLog(jobId, `M3U ${account.name}: Could not find name for source group ID ${sourceGroupId}, skipping`);
              }
              continue;
            }

            // Find or create the group on dest
            const destGroupId = await ensureDestGroup(groupName);
            if (!destGroupId) {
              if (jobId) {
                jobManager.addLog(jobId, `M3U ${account.name}: Could not map group "${groupName}" to destination, skipping`);
              }
              continue;
            }

            // Copy all settings, replacing the channel_group ID
            transformedChannelGroups.push({
              ...cg,
              channel_group: destGroupId,
              channel_group_name: groupName, // Preserve name for reference
            });
          }

        }

        // Create/update the M3U account WITHOUT channel_groups
        let accountId: number;
        if (existing) {
          await dest.put(`/api/m3u/accounts/${existing.id}/`, basePayload);
          accountId = existing.id;
        } else {
          const created = await dest.post('/api/m3u/accounts/', basePayload);
          accountId = created.id;
        }

        // If we have channel_groups settings to apply, refresh and then PATCH
        if (transformedChannelGroups && transformedChannelGroups.length > 0) {
          // Trigger refresh to discover channel groups
          await dest.post(`/api/m3u/refresh/${accountId}/`).catch(() => null);

          // Wait for refresh to complete
          const maxWait = 60000;
          const pollInterval = 2000;
          const startTime = Date.now();
          while (Date.now() - startTime < maxWait) {
            await new Promise(r => globalThis.setTimeout(r, pollInterval));
            const acct = await dest.get(`/api/m3u/accounts/${accountId}/`).catch(() => null);
            if (acct && acct.status !== 'refreshing' && acct.status !== 'pending_setup') {
              break;
            }
          }

          // Get discovered groups and build the complete payload
          const currentAccount = await dest.get(`/api/m3u/accounts/${accountId}/`);
          const discoveredGroups = currentAccount?.channel_groups || [];

          // Refresh dest group mapping
          const refreshedDestGroups = await dest.get('/api/channels/groups/').catch(() => []);
          const refreshedDestList = Array.isArray(refreshedDestGroups) ? refreshedDestGroups : refreshedDestGroups.results || [];
          for (const g of refreshedDestList) {
            if (g?.id != null && g?.name) {
              destGroupNameToId[g.name.toLowerCase()] = g.id;
            }
          }

          // Build ID -> name mapping for discovered groups
          const destGroupIdToName: Record<number, string> = {};
          for (const g of refreshedDestList) {
            if (g?.id != null && g?.name) {
              destGroupIdToName[g.id] = g.name;
            }
          }

          // Map source settings to discovered groups by name
          const sourceSettingsByName: Record<string, any> = {};
          for (const cg of transformedChannelGroups) {
            const name = cg.channel_group_name?.toLowerCase();
            if (name) {
              sourceSettingsByName[name] = cg;
            }
          }

          // Build complete payload with discovered groups + source settings
          const completePayload = discoveredGroups.map((dg: any) => {
            const groupName = destGroupIdToName[dg.channel_group] || dg.channel_group_name || '';
            const sourceSettings = sourceSettingsByName[groupName.toLowerCase()];

            if (sourceSettings) {
              return {
                channel_group: dg.channel_group,
                enabled: sourceSettings.enabled !== undefined ? sourceSettings.enabled : dg.enabled,
                ...(sourceSettings.auto_channel_sync !== undefined && { auto_channel_sync: sourceSettings.auto_channel_sync }),
                ...(sourceSettings.auto_sync_channel_start !== undefined && { auto_sync_channel_start: sourceSettings.auto_sync_channel_start }),
                ...(sourceSettings.custom_properties !== undefined && { custom_properties: sourceSettings.custom_properties }),
              };
            } else {
              return {
                channel_group: dg.channel_group,
                enabled: false,
              };
            }
          });

          const enabledCount = completePayload.filter((cg: any) => cg.enabled).length;
          const autoSyncCount = completePayload.filter((cg: any) => cg.auto_channel_sync).length;
          if (jobId) {
            jobManager.addLog(jobId, `M3U ${account.name}: Applying ${enabledCount} enabled, ${completePayload.length - enabledCount} disabled channel groups`);
          }

          // Apply channel group settings via PATCH
          await dest.patch(`/api/m3u/accounts/${accountId}/`, {
            channel_groups: completePayload,
          });

          // Also try dedicated group-settings endpoint for auto_channel_sync settings
          // Note: Dispatcharr API may not persist these values (known limitation)
          if (autoSyncCount > 0) {
            const autoSyncGroups = completePayload.filter((cg: any) => cg.auto_channel_sync);
            await dest.patch(`/api/m3u/accounts/${accountId}/group-settings/`, {
              channel_groups: autoSyncGroups,
            }).catch(() => null);
          }

          // Trigger another refresh to apply the enabled/disabled states
          await dest.post(`/api/m3u/refresh/${accountId}/`).catch(() => null);
        }

        synced++;
      } catch (error) {
        if (jobId) {
          jobManager.addLog(jobId, `M3U ${account?.name}: Sync failed - ${error instanceof Error ? error.message : error}`);
        }
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async syncStreamProfiles(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceProfiles = await source.get('/api/core/streamprofiles/');
    const destProfiles = await dest.get('/api/core/streamprofiles/');

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const sourceList = Array.isArray(sourceProfiles) ? sourceProfiles : sourceProfiles.results || [];
    const destList = Array.isArray(destProfiles) ? destProfiles : destProfiles.results || [];

    for (const profile of sourceList) {
      try {
        const existing = destList.find((p: any) => p.name === profile.name);

        if (dryRun) {
          synced++;
          continue;
        }

        const { id, ...payload } = profile;

        if (existing) {
          await dest.put(`/api/core/streamprofiles/${existing.id}/`, payload);
        } else {
          await dest.post('/api/core/streamprofiles/', payload);
        }
        synced++;
      } catch (error) {
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async syncUserAgents(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceAgents = await source.get('/api/core/useragents/');
    const destAgents = await dest.get('/api/core/useragents/');

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const sourceList = Array.isArray(sourceAgents) ? sourceAgents : sourceAgents.results || [];
    const destList = Array.isArray(destAgents) ? destAgents : destAgents.results || [];

    for (const agent of sourceList) {
      try {
        const existing = destList.find((a: any) => a.name === agent.name);

        if (dryRun) {
          synced++;
          continue;
        }

        const { id, ...payload } = agent;

        if (existing) {
          await dest.put(`/api/core/useragents/${existing.id}/`, payload);
        } else {
          await dest.post('/api/core/useragents/', payload);
        }
        synced++;
      } catch (error) {
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async syncCoreSettings(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    try {
      const sourceResp = await source.get('/api/core/settings/');
      const sourceList = Array.isArray(sourceResp)
        ? sourceResp.filter((s) => s && typeof s === 'object')
        : sourceResp
          ? [sourceResp]
          : [];

      if (!sourceList.length) {
        return { synced: 0, skipped: 1, errors: 0 };
      }

      if (dryRun) {
        return { synced: sourceList.length, skipped: 0, errors: 0 };
      }

      const destResp = await dest.get('/api/core/settings/').catch(() => []);
      const destList = Array.isArray(destResp)
        ? destResp
        : destResp
          ? [destResp]
          : [];
      const destByKey = new Map<string, any>(
        destList
          .filter((s: any) => s?.key)
          .map((s: any) => [s.key, s])
      );

      let synced = 0;
      let errors = 0;

      for (const setting of sourceList) {
        const key = setting.key;
        if (!key) continue;

        const payload = { ...setting };
        delete (payload as any).id;

        try {
          const match = destByKey.get(key);
          if (match?.id) {
            await dest.put(`/api/core/settings/${match.id}/`, payload);
          } else {
            await dest.post('/api/core/settings/', payload);
          }
          synced++;
        } catch (error: any) {
          const status = error?.response?.status;
          if (status === 404) {
            try {
              await dest.post('/api/core/settings/', payload);
              synced++;
              continue;
            } catch {
              errors++;
              continue;
            }
          }
          errors++;
        }
      }

      return { synced, skipped: 0, errors };
    } catch (error) {
      return { synced: 0, skipped: 0, errors: 1 };
    }
  }

  private async syncEPGSources(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean,
    jobId?: string
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceSources = await source.get('/api/epg/sources/');
    const destSources = await dest.get('/api/epg/sources/');

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const sourceList = Array.isArray(sourceSources) ? sourceSources : sourceSources.results || [];
    const destList = Array.isArray(destSources) ? destSources : destSources.results || [];

    for (const sourceItem of sourceList) {
      try {
        const match = destList.find((s: any) => s.name === sourceItem.name);
        if (dryRun) {
          synced++;
          continue;
        }

        const payload = {
          name: sourceItem.name,
          source_type: sourceItem.source_type,
          url: sourceItem.url,
          api_key: sourceItem.api_key,
          is_active: sourceItem.is_active,
          ...(['username', 'password', 'token', 'priority'].reduce((acc: any, key) => {
            if (sourceItem[key] !== undefined) acc[key] = sourceItem[key];
            return acc;
          }, {})),
        };

        if (match) {
          await dest.put(`/api/epg/sources/${match.id}/`, payload);
        } else {
          await dest.post('/api/epg/sources/', payload);
        }
        synced++;
      } catch (error: any) {
        const errMsg = error?.response?.data?.error || error?.response?.data?.detail || error?.message || 'Unknown error';
        if (jobId) {
          jobManager.addLog(jobId, `EPG source "${sourceItem.name}": Failed - ${errMsg}`);
        }
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async syncComskipConfig(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean,
    jobId?: string
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    try {
      const config = await source.get('/api/channels/dvr/comskip-config/');

      // Check if config is empty, null, or doesn't exist on source
      // The API returns {"path":"","exists":false} when no config is set
      if (!config || config.exists === false) {
        if (jobId) {
          jobManager.addLog(jobId, 'Comskip config: No configuration found on source, skipping');
        }
        return { synced: 0, skipped: 1, errors: 0 };
      }

      if (dryRun) {
        return { synced: 1, skipped: 0, errors: 0 };
      }

      // The comskip config endpoint might expect different payload formats
      // Try to determine the correct format based on what we received
      let payload: any;
      if (typeof config === 'string') {
        payload = { config };
      } else if (config.config !== undefined) {
        // Already in the right format
        payload = config;
      } else {
        // Pass through as-is
        payload = config;
      }

      await dest.post('/api/channels/dvr/comskip-config/', payload);
      if (jobId) {
        jobManager.addLog(jobId, 'Comskip config: Synced successfully');
      }
      return { synced: 1, skipped: 0, errors: 0 };
    } catch (error: any) {
      const errMsg = error?.response?.data?.error || error?.response?.data?.detail || error?.message || 'Unknown error';
      const statusCode = error?.response?.status || 'N/A';
      console.error(`[syncComskipConfig] Failed with status ${statusCode}: ${errMsg}`);
      if (jobId) {
        jobManager.addLog(jobId, `Comskip config: Failed (HTTP ${statusCode}) - ${errMsg}`);
      }
      return { synced: 0, skipped: 0, errors: 1 };
    }
  }

  private async syncLogos(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const logos = await source.get('/api/channels/logos/');
    const logoList = Array.isArray(logos) ? logos : logos.results || [];

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < logoList.length; i++) {
      const logo = logoList[i];
      if (!logo?.url) {
        skipped++;
        continue;
      }

      if (dryRun) {
        synced++;
        continue;
      }

      try {
        const response = await source.get(logo.url, { responseType: 'arraybuffer' });
        const buffer = Buffer.isBuffer(response) ? response : Buffer.from(response);
        const name = logo.name || logo.id || `logo-${i}`;
        await dest.post('/api/channels/logos/upload/', {
          name,
          url: `data:image/png;base64,${buffer.toString('base64')}`,
        });
        synced++;
      } catch (error) {
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async triggerEpgRefresh(
    client: DispatcharrClient,
    jobId: string
  ): Promise<void> {
    try {
      jobManager.addLog(jobId, 'Triggering EPG refresh by toggling EPG sources...');

      // Get all EPG sources
      const epgSources = await client.get('/api/epg/sources/').catch(() => []);

      if (!Array.isArray(epgSources) || epgSources.length === 0) {
        jobManager.addLog(jobId, 'No EPG sources found to refresh');
        return;
      }

      jobManager.addLog(jobId, `Found ${epgSources.length} EPG source(s) to refresh`);

      // Toggle each active EPG source to trigger a refresh
      for (const source of epgSources) {
        if (!source?.id) continue;

        try {
          const wasActive = source.is_active !== false; // Default to true if undefined

          if (wasActive) {
            jobManager.addLog(jobId, `EPG source "${source.name || source.id}": Toggling to trigger refresh...`);

            // Toggle off
            await client.patch(`/api/epg/sources/${source.id}/`, { is_active: false });
            await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));

            // Toggle back on
            await client.patch(`/api/epg/sources/${source.id}/`, { is_active: true });

            jobManager.addLog(jobId, `EPG source "${source.name || source.id}": Refresh triggered`);
          } else {
            jobManager.addLog(jobId, `EPG source "${source.name || source.id}": Skipped (inactive)`);
          }
        } catch (error: any) {
          jobManager.addLog(jobId, `EPG source refresh failed for "${source.name || source.id}": ${error.message}`);
        }
      }

      jobManager.addLog(jobId, 'EPG refresh triggered for all active sources');
    } catch (error: any) {
      jobManager.addLog(jobId, `EPG refresh trigger failed: ${error.message}`);
    }
  }
}

export const syncService = new SyncService();
