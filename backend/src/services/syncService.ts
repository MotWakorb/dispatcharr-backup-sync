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
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // 2. Sync EPG Sources
      if (request.options.syncEPGSources) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing EPG sources...');
        results.synced.epgSources = await this.syncEPGSources(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
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
          request.dryRun
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
          request.dryRun
        );
        currentProgress += progressPerStep;
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
          request.dryRun
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
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceGroups = await source.get('/api/channels/groups/');
    const destGroups = await dest.get('/api/channels/groups/');

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (const group of sourceGroups) {
      try {
        const existing = destGroups.find((g: any) => g.name === group.name);

        if (dryRun) {
          synced++;
          continue;
        }

        const groupData = { name: group.name };

        if (existing) {
          await dest.put(`/api/channels/groups/${existing.id}/`, groupData);
        } else {
          await dest.post('/api/channels/groups/', groupData);
        }
        synced++;
      } catch (error) {
        errors++;
      }
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

    // Then, sync the channel associations for each profile
    if (!dryRun) {
      await this.syncChannelProfileAssociations(source, dest);
    }

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

  private async syncChannels(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
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

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const channels = Array.isArray(sourceChannels) ? sourceChannels : sourceChannels.results || [];

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

        // Map stream profile ID if present
        if (channel.stream_profile_id && profileMap[channel.stream_profile_id]) {
          channelData.stream_profile_id = profileMap[channel.stream_profile_id];
        }

        if (existing) {
          await dest.put(`/api/channels/channels/${existing.id}/`, channelData);
        } else {
          await dest.post('/api/channels/channels/', channelData);
        }
        synced++;
      } catch (error) {
        errors++;
      }
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
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceAccounts = await source.get('/api/m3u/accounts/');
    const destAccounts = await dest.get('/api/m3u/accounts/');

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const sourceList = Array.isArray(sourceAccounts) ? sourceAccounts : sourceAccounts.results || [];
    const destList = Array.isArray(destAccounts) ? destAccounts : destAccounts.results || [];

    for (const account of sourceList) {
      try {
        const existing = destList.find((a: any) => a.name === account.name);

        if (dryRun) {
          synced++;
          continue;
        }

        const { id, created_at, updated_at, ...payload } = account;

        if (existing) {
          await dest.put(`/api/m3u/accounts/${existing.id}/`, payload);
        } else {
          await dest.post('/api/m3u/accounts/', payload);
        }
        synced++;
      } catch (error) {
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
    dryRun?: boolean
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
      } catch (error) {
        errors++;
      }
    }

    return { synced, skipped, errors };
  }

  private async syncComskipConfig(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    try {
      const config = await source.get('/api/channels/dvr/comskip-config/');
      if (dryRun) {
        return { synced: 1, skipped: 0, errors: 0 };
      }
      const payload = typeof config === 'string' ? { config } : config;
      await dest.post('/api/channels/dvr/comskip-config/', payload);
      return { synced: 1, skipped: 0, errors: 0 };
    } catch (error) {
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
}

export const syncService = new SyncService();
