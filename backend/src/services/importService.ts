import { DispatcharrClient } from './dispatcharrClient.js';
import { jobManager } from './jobManager.js';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import tar from 'tar';
import type { ImportOptions, ImportRequest } from '../types/index.js';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);

const SECTION_OPTION_MAP = {
  channelGroups: 'syncChannelGroups',
  channelProfiles: 'syncChannelProfiles',
  channels: 'syncChannels',
  m3uSources: 'syncM3USources',
  streamProfiles: 'syncStreamProfiles',
  userAgents: 'syncUserAgents',
  coreSettings: 'syncCoreSettings',
  epgSources: 'syncEPGSources',
  plugins: 'syncPlugins',
  dvrRules: 'syncDVRRules',
  comskipConfig: 'syncComskipConfig',
  users: 'syncUsers',
  logos: 'syncLogos',
} as const;

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
      const data = (configData as any)?.data ?? {};

      const results: any = {
        imported: {},
        skipped: {},
        errors: {},
      };

      let currentProgress = 20;
      const totalSteps = Math.max(this.countDataSections(data, request.options), 1);
      const progressPerStep = 75 / totalSteps;

      // Import Channel Groups
      if (data.channelGroups && this.isEnabled('channelGroups', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing channel groups...');
        results.imported.channelGroups = await this.importChannelGroups(
          client,
          data.channelGroups
        );
        currentProgress += progressPerStep;
      }

      // Import Channel Profiles
      if (data.channelProfiles && this.isEnabled('channelProfiles', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing channel profiles...');
        results.imported.channelProfiles = await this.importChannelProfiles(
          client,
          data.channelProfiles
        );
        currentProgress += progressPerStep;
      }

      // Import Channels
      if (data.channels && this.isEnabled('channels', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing channels...');
        results.imported.channels = await this.importChannels(client, data.channels);
        currentProgress += progressPerStep;
      }

      // Import M3U Sources
      if (data.m3uSources && this.isEnabled('m3uSources', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing M3U sources...');
        results.imported.m3uSources = await this.importM3USources(
          client,
          data.m3uSources
        );
        currentProgress += progressPerStep;
      }

      // Import Stream Profiles
      if (data.streamProfiles && this.isEnabled('streamProfiles', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing stream profiles...');
        results.imported.streamProfiles = await this.importStreamProfiles(
          client,
          data.streamProfiles
        );
        currentProgress += progressPerStep;
      }

      // Import User Agents
      if (data.userAgents && this.isEnabled('userAgents', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing user agents...');
        results.imported.userAgents = await this.importUserAgents(
          client,
          data.userAgents
        );
        currentProgress += progressPerStep;
      }

      if (data.coreSettings && this.isEnabled('coreSettings', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing core settings...');
        results.imported.coreSettings = await this.importCoreSettings(
          client,
          data.coreSettings
        );
        currentProgress += progressPerStep;
      }

      // Import EPG Sources
      if (data.epgSources && this.isEnabled('epgSources', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing EPG sources...');
        results.imported.epgSources = await this.importEPGSources(
          client,
          data.epgSources
        );
        currentProgress += progressPerStep;
      }

      // Import Plugins
      if (data.plugins && this.isEnabled('plugins', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing plugins...');
        results.imported.plugins = await this.importPlugins(client, data.plugins);
        currentProgress += progressPerStep;
      }

      // Import DVR Rules
      if (data.dvrRules && this.isEnabled('dvrRules', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing DVR rules...');
        results.imported.dvrRules = await this.importDVRRules(client, data.dvrRules);
        currentProgress += progressPerStep;
      }

      if (data.comskipConfig && this.isEnabled('comskipConfig', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing comskip config...');
        results.imported.comskipConfig = await this.importComskipConfig(
          client,
          data.comskipConfig
        );
        currentProgress += progressPerStep;
      }

      // Import Users
      if (data.users && this.isEnabled('users', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing users...');
        results.imported.users = await this.importUsers(client, data.users);
        currentProgress += progressPerStep;
      }

      if (data.logos && this.isEnabled('logos', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing logos...');
        results.imported.logos = await this.importLogos(client, data.logos);
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

  private countDataSections(data: any, options?: ImportOptions): number {
    if (!data) return 0;
    const keys = Object.keys(data).filter((k) => !k.startsWith('__comment_'));
    if (!options) return keys.length;
    return keys.filter((k) => {
      const optKey = SECTION_OPTION_MAP[k as keyof typeof SECTION_OPTION_MAP];
      if (!optKey) return true;
      const value = (options as any)[optKey];
      return value !== false;
    }).length;
  }

  private isEnabled(section: keyof typeof SECTION_OPTION_MAP, options?: ImportOptions): boolean {
    const optKey = SECTION_OPTION_MAP[section];
    if (options && optKey in options) {
      return Boolean((options as any)[optKey]);
    }
    return true;
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
        // M3U sources are exposed under /api/m3u/accounts/
        await client.post('/api/m3u/accounts/', source);
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
        // Stream profiles endpoint lives under /api/core/streamprofiles/
        await client.post('/api/core/streamprofiles/', profile);
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
        // User agents endpoint lives under /api/core/useragents/
        await client.post('/api/core/useragents/', agent);
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importEPGSources(
    client: DispatcharrClient,
    sources: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/epg/sources/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const source of sources) {
      try {
        const match = existing.find((s: any) => s.name === source.name);
        const payload = {
          name: source.name,
          source_type: source.source_type,
          url: source.url,
          api_key: source.api_key,
          is_active: source.is_active,
          // include other optional fields if present
          ...(['username', 'password', 'token', 'priority'].reduce((acc: any, key) => {
            if (source[key] !== undefined) acc[key] = source[key];
            return acc;
          }, {})),
        };

        if (match) {
          await client.put(`/api/epg/sources/${match.id}/`, payload);
        } else {
          await client.post('/api/epg/sources/', payload);
        }
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

  private async importCoreSettings(
    client: DispatcharrClient,
    settings: any
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    try {
      const existing = await client.get('/api/core/settings/').catch(() => null);
      const targetId = existing?.id ?? settings?.id;
      if (targetId) {
        await client.put(`/api/core/settings/${targetId}/`, settings);
      } else {
        await client.post('/api/core/settings/', settings);
      }
      return { imported: 1, skipped: 0, errors: 0 };
    } catch (error) {
      console.error('Failed to import core settings', error);
      return { imported: 0, skipped: 0, errors: 1 };
    }
  }

  private async importComskipConfig(
    client: DispatcharrClient,
    config: any
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    try {
      const payload = typeof config === 'string' ? { config } : config;
      await client.post('/api/channels/dvr/comskip-config/', payload);
      return { imported: 1, skipped: 0, errors: 0 };
    } catch (error) {
      console.error('Failed to import comskip config', error);
      return { imported: 0, skipped: 0, errors: 1 };
    }
  }

  private async importLogos(
    client: DispatcharrClient,
    logos: any[]
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    if (!Array.isArray(logos)) {
      return { imported, skipped: logos ? 0 : 1, errors: logos ? 1 : 0 };
    }

    for (let i = 0; i < logos.length; i++) {
      const logo = logos[i];
      const name = logo?.name || logo?.id || `logo-${i}`;
      const base64 = logo?.data;
      if (!base64) {
        skipped++;
        continue;
      }

      try {
        const dataUrl = `data:image/png;base64,${base64}`;
        await client.post('/api/channels/logos/upload/', {
          name,
          url: dataUrl,
        });
        imported++;
      } catch (error) {
        console.error('Failed to import logo', name, error);
        errors++;
      }
    }

    return { imported, skipped, errors };
  }
}

export const importService = new ImportService();
