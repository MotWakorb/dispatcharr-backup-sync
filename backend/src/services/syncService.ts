import { DispatcharrClient } from './dispatcharrClient.js';
import { jobManager } from './jobManager.js';
import type { SyncRequest, SyncOptions } from '../types/index.js';

export class SyncService {
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
      const totalSteps = this.countEnabledOptions(request.options);
      const progressPerStep = 80 / totalSteps; // 80% for sync steps, 20% for auth/complete

      // Sync Channel Groups
      if (request.options.syncChannelGroups) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing channel groups...');
        results.synced.channelGroups = await this.syncChannelGroups(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // Sync Channel Profiles
      if (request.options.syncChannelProfiles) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing channel profiles...');
        results.synced.channelProfiles = await this.syncChannelProfiles(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // Sync Channels
      if (request.options.syncChannels) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing channels...');
        results.synced.channels = await this.syncChannels(
          sourceClient,
          destClient,
          request.dryRun
        );
        currentProgress += progressPerStep;
      }

      // Sync Users
      if (request.options.syncUsers) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing users...');
        results.synced.users = await this.syncUsers(sourceClient, destClient, request.dryRun);
        currentProgress += progressPerStep;
      }

      // Sync Plugins
      if (request.options.syncPlugins) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing plugins...');
        results.synced.plugins = await this.syncPlugins(sourceClient, destClient, request.dryRun);
        currentProgress += progressPerStep;
      }

      // Sync DVR Rules
      if (request.options.syncDVRRules) {
        jobManager.setProgress(jobId, currentProgress, 'Syncing DVR rules...');
        results.synced.dvrRules = await this.syncDVRRules(
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
      'syncUsers',
      'syncPlugins',
      'syncDVRRules',
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

    return { synced, skipped, errors };
  }

  private async syncChannels(
    source: DispatcharrClient,
    dest: DispatcharrClient,
    dryRun?: boolean
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const sourceChannels = await source.get('/api/channels/channels/');
    const destChannels = await dest.get('/api/channels/channels/');

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
    const sourcePlugins = await source.get('/api/plugins/plugins/');
    const destPlugins = await dest.get('/api/plugins/plugins/');

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
}

export const syncService = new SyncService();
