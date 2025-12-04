import { DispatcharrClient } from './dispatcharrClient.js';
import { jobManager } from './jobManager.js';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import tar from 'tar';
import type { ImportRequest } from '../types/index.js';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);

export class ImportService {
  private tempDir = path.join(process.cwd(), 'temp');

  async import(request: ImportRequest, jobId: string): Promise<void> {
    try {
      jobManager.startJob(jobId, 'Initializing import...');

      // Ensure temp directory exists
      await mkdir(this.tempDir, { recursive: true });

      const client = new DispatcharrClient(request.destination);

      // Authenticate
      jobManager.setProgress(jobId, 5, 'Authenticating...');
      await client.authenticate();

      // Decode and save uploaded file
      jobManager.setProgress(jobId, 10, 'Processing uploaded file...');
      const tempFilePath = path.join(this.tempDir, request.fileName);
      const fileBuffer = Buffer.from(request.fileData, 'base64');
      await writeFile(tempFilePath, fileBuffer);

      // Extract if compressed
      let configFilePath = tempFilePath;
      const ext = path.extname(request.fileName).toLowerCase();

      if (ext === '.zip') {
        configFilePath = await this.extractZip(tempFilePath);
      } else if (ext === '.gz' || ext === '.tgz') {
        configFilePath = await this.extractTarGz(tempFilePath);
      }

      // Read and parse config file
      jobManager.setProgress(jobId, 15, 'Reading configuration...');
      const configContent = await readFile(configFilePath, 'utf-8');

      const format = request.format || this.detectFormat(configFilePath);
      const configData = format === 'yaml' ? yaml.load(configContent) : JSON.parse(configContent);

      const results: any = {
        imported: {},
        skipped: {},
        errors: {},
      };

      let currentProgress = 20;
      const totalSteps = this.countDataSections(configData);
      const progressPerStep = 75 / totalSteps;

      // Import Channel Groups
      if (configData.data?.channelGroups) {
        jobManager.setProgress(jobId, currentProgress, 'Importing channel groups...');
        results.imported.channelGroups = await this.importChannelGroups(
          client,
          configData.data.channelGroups
        );
        currentProgress += progressPerStep;
      }

      // Import Channel Profiles
      if (configData.data?.channelProfiles) {
        jobManager.setProgress(jobId, currentProgress, 'Importing channel profiles...');
        results.imported.channelProfiles = await this.importChannelProfiles(
          client,
          configData.data.channelProfiles
        );
        currentProgress += progressPerStep;
      }

      // Import Channels
      if (configData.data?.channels) {
        jobManager.setProgress(jobId, currentProgress, 'Importing channels...');
        results.imported.channels = await this.importChannels(client, configData.data.channels);
        currentProgress += progressPerStep;
      }

      // Import M3U Sources
      if (configData.data?.m3uSources) {
        jobManager.setProgress(jobId, currentProgress, 'Importing M3U sources...');
        results.imported.m3uSources = await this.importM3USources(
          client,
          configData.data.m3uSources
        );
        currentProgress += progressPerStep;
      }

      // Import Stream Profiles
      if (configData.data?.streamProfiles) {
        jobManager.setProgress(jobId, currentProgress, 'Importing stream profiles...');
        results.imported.streamProfiles = await this.importStreamProfiles(
          client,
          configData.data.streamProfiles
        );
        currentProgress += progressPerStep;
      }

      // Import User Agents
      if (configData.data?.userAgents) {
        jobManager.setProgress(jobId, currentProgress, 'Importing user agents...');
        results.imported.userAgents = await this.importUserAgents(
          client,
          configData.data.userAgents
        );
        currentProgress += progressPerStep;
      }

      // Import Plugins
      if (configData.data?.plugins) {
        jobManager.setProgress(jobId, currentProgress, 'Importing plugins...');
        results.imported.plugins = await this.importPlugins(client, configData.data.plugins);
        currentProgress += progressPerStep;
      }

      // Import DVR Rules
      if (configData.data?.dvrRules) {
        jobManager.setProgress(jobId, currentProgress, 'Importing DVR rules...');
        results.imported.dvrRules = await this.importDVRRules(client, configData.data.dvrRules);
        currentProgress += progressPerStep;
      }

      // Import Users
      if (configData.data?.users) {
        jobManager.setProgress(jobId, currentProgress, 'Importing users...');
        results.imported.users = await this.importUsers(client, configData.data.users);
        currentProgress += progressPerStep;
      }

      // Cleanup temp files
      try {
        await unlink(tempFilePath);
        if (configFilePath !== tempFilePath) {
          await unlink(configFilePath);
        }
      } catch (error) {
        console.error('Failed to cleanup temp files:', error);
      }

      jobManager.completeJob(jobId, results);
    } catch (error: any) {
      jobManager.failJob(jobId, error.message);
      throw error;
    }
  }

  private async extractZip(zipPath: string): Promise<string> {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    // Find config file (yaml or json)
    const configEntry = zipEntries.find(
      (entry) =>
        !entry.isDirectory &&
        (entry.entryName.endsWith('.yaml') ||
          entry.entryName.endsWith('.yml') ||
          entry.entryName.endsWith('.json'))
    );

    if (!configEntry) {
      throw new Error('No configuration file found in archive');
    }

    const extractPath = path.join(this.tempDir, configEntry.entryName);
    await writeFile(extractPath, configEntry.getData());
    return extractPath;
  }

  private async extractTarGz(tarPath: string): Promise<string> {
    const extractDir = path.join(this.tempDir, 'extract-' + Date.now());
    await mkdir(extractDir, { recursive: true });

    await tar.extract({
      file: tarPath,
      cwd: extractDir,
    });

    // Find config file
    const files = fs.readdirSync(extractDir);
    const configFile = files.find(
      (file) => file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')
    );

    if (!configFile) {
      throw new Error('No configuration file found in archive');
    }

    return path.join(extractDir, configFile);
  }

  private detectFormat(filePath: string): 'yaml' | 'json' {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') return 'json';
    return 'yaml';
  }

  private countDataSections(configData: any): number {
    if (!configData.data) return 0;
    return Object.keys(configData.data).length;
  }

  private async importChannelGroups(
    client: DispatcharrClient,
    groups: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/channels/groups/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const group of groups) {
      try {
        const existingGroup = existing.find((g: any) => g.name === group.name);
        const groupData = { name: group.name };

        if (existingGroup) {
          await client.put(`/api/channels/groups/${existingGroup.id}/`, groupData);
        } else {
          await client.post('/api/channels/groups/', groupData);
        }
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importChannelProfiles(
    client: DispatcharrClient,
    profiles: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/channels/profiles/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const profile of profiles) {
      try {
        const existingProfile = existing.find((p: any) => p.name === profile.name);
        const profileData = { name: profile.name };

        if (existingProfile) {
          await client.put(`/api/channels/profiles/${existingProfile.id}/`, profileData);
        } else {
          await client.post('/api/channels/profiles/', profileData);
        }
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importChannels(
    client: DispatcharrClient,
    channels: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/channels/channels/');
    const existingList = Array.isArray(existing) ? existing : existing.results || [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const channel of channels) {
      try {
        const existingChannel = existingList.find(
          (c: any) => c.name === channel.name && c.channel_number === channel.channel_number
        );

        const channelData: any = {
          name: channel.name,
        };

        if (channel.channel_number != null) {
          channelData.channel_number = channel.channel_number;
        }

        if (existingChannel) {
          await client.put(`/api/channels/channels/${existingChannel.id}/`, channelData);
        } else {
          await client.post('/api/channels/channels/', channelData);
        }
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importM3USources(
    client: DispatcharrClient,
    sources: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const source of sources) {
      try {
        await client.post('/api/channels/m3u-sources/', source);
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importStreamProfiles(
    client: DispatcharrClient,
    profiles: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const profile of profiles) {
      try {
        await client.post('/api/channels/stream-profiles/', profile);
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importUserAgents(
    client: DispatcharrClient,
    agents: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const agent of agents) {
      try {
        await client.post('/api/channels/user-agents/', agent);
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importPlugins(
    client: DispatcharrClient,
    plugins: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/plugins/plugins/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const plugin of plugins) {
      try {
        if (!plugin.key || !plugin.settings) {
          skipped++;
          continue;
        }

        const existingPlugin = existing.find((p: any) => p.key === plugin.key);
        if (!existingPlugin) {
          skipped++;
          continue;
        }

        await client.post(`/api/plugins/plugins/${plugin.key}/settings/`, plugin.settings);
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importDVRRules(
    client: DispatcharrClient,
    rules: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/channels/recurring-rules/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const rule of rules) {
      try {
        const existingRule = existing.find(
          (r: any) =>
            r.name === rule.name && r.start_time === rule.start_time && r.end_time === rule.end_time
        );

        const ruleData: any = {
          start_time: rule.start_time,
          end_time: rule.end_time,
          enabled: rule.enabled,
        };

        if (rule.name) ruleData.name = rule.name;
        if (rule.days_of_week) ruleData.days_of_week = rule.days_of_week;
        if (rule.channel) ruleData.channel = rule.channel;

        if (existingRule) {
          await client.put(`/api/channels/recurring-rules/${existingRule.id}/`, ruleData);
        } else {
          await client.post('/api/channels/recurring-rules/', ruleData);
        }
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importUsers(
    client: DispatcharrClient,
    users: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/accounts/users/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      try {
        const existingUser = existing.find((u: any) => u.username === user.username);

        const userData: any = {
          username: user.username,
          email: user.email,
          user_level: user.user_level,
          is_active: user.is_active,
        };

        if (user.custom_properties) {
          userData.custom_properties = user.custom_properties;
        }

        if (existingUser) {
          await client.put(`/api/accounts/users/${existingUser.id}/`, userData);
        } else {
          if (user.password) {
            userData.password = user.password;
          }
          await client.post('/api/accounts/users/', userData);
        }
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }
}

export const importService = new ImportService();
