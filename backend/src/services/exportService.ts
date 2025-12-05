import { DispatcharrClient } from './dispatcharrClient.js';
import { jobManager } from './jobManager.js';
import yaml from 'js-yaml';
import archiver from 'archiver';
import tar from 'tar';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import type { ExportRequest, ExportOptions } from '../types/index.js';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);

export class ExportService {
  private tempDir = path.join(process.cwd(), 'temp');

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

  async export(request: ExportRequest, jobId: string): Promise<string> {
    try {
      jobManager.startJob(jobId, 'Initializing export...');

      // Ensure temp directory exists
      await mkdir(this.tempDir, { recursive: true });

      const client = new DispatcharrClient(request.source);

      // Authenticate
      jobManager.setProgress(jobId, 5, 'Authenticating...');
      await client.authenticate();

      const exportData: any = {
        exported_at: new Date().toISOString(),
        source_url: request.source.url,
        data: {},
      };

      let currentProgress = 10;
      const totalSteps = this.countEnabledOptions(request.options);
      const progressPerStep = 80 / totalSteps;

      // Export Channel Groups
      if (request.options.syncChannelGroups) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting channel groups...');
        const allGroups = await client.get('/api/channels/groups/');
        // Filter out groups created by M3U sources (those with m3u_account_count > 0)
        const manualGroups = Array.isArray(allGroups)
          ? allGroups.filter((group: any) => !group.m3u_account_count || group.m3u_account_count === 0)
          : allGroups;
        exportData.data.channelGroups = manualGroups;
        currentProgress += progressPerStep;
      }

      // Export Channel Profiles
      if (request.options.syncChannelProfiles) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting channel profiles...');
        exportData.data.channelProfiles = await client.get('/api/channels/profiles/');
        currentProgress += progressPerStep;
      }

      // Export Channels
      if (request.options.syncChannels) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting channels...');
        const allChannels = await this.getAllPaginated(client, '/api/channels/channels/');
        // Filter out auto-created channels (those created via M3U auto channel sync)
        const manualChannels = allChannels
          .filter((channel: any) => !channel.auto_created)
          .sort((a: any, b: any) => {
            const aNum = Number(a.channel_number) || 0;
            const bNum = Number(b.channel_number) || 0;
            return aNum - bNum;
          });
        exportData.data.channels = manualChannels;
        currentProgress += progressPerStep;
      }

      // Export M3U Sources
      if (request.options.syncM3USources) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting M3U sources...');
        // Swagger path uses /api/m3u/accounts/ for M3U source definitions
        const accounts = await this.getAllPaginated(client, '/api/m3u/accounts/');
        // Ensure credentials (username/password) are included if present on the source
        exportData.data.m3uSources = accounts.map((acct: any) => {
          const { username, password, ...rest } = acct;
          return {
            ...rest,
            ...(username ? { username } : {}),
            ...(password ? { password } : {}),
          };
        });
        currentProgress += progressPerStep;
      }

      // Export Stream Profiles
      if (request.options.syncStreamProfiles) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting stream profiles...');
        // Stream profiles live under /api/core/streamprofiles/ per swagger
        exportData.data.streamProfiles = await this.getAllPaginated(
          client,
          '/api/core/streamprofiles/'
        );
        currentProgress += progressPerStep;
      }

      // Export User Agents
      if (request.options.syncUserAgents) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting user agents...');
        // User agents endpoint is /api/core/useragents/
        exportData.data.userAgents = await this.getAllPaginated(
          client,
          '/api/core/useragents/'
        );
        currentProgress += progressPerStep;
      }

      // Export Core Settings
      if (request.options.syncCoreSettings) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting core settings...');
        exportData.data.coreSettings = await client.get('/api/core/settings/');
        currentProgress += progressPerStep;
      }

      // Export EPG Sources
      if (request.options.syncEPGSources) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting EPG sources...');
        exportData.data.epgSources = await this.getAllPaginated(client, '/api/epg/sources/');
        currentProgress += progressPerStep;
      }

      // Export Logos
      if (request.options.downloadLogos && !request.dryRun) {
        jobManager.setProgress(jobId, currentProgress, 'Downloading logos...');
        exportData.data.logos = await this.downloadLogos(client, jobId);
        currentProgress += progressPerStep;
      }

      // Export Plugins
      if (request.options.syncPlugins) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting plugins...');
        exportData.data.plugins = await client.get('/api/plugins/plugins/');
        currentProgress += progressPerStep;
      }

      // Export DVR Rules
      if (request.options.syncDVRRules) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting DVR rules...');
        exportData.data.dvrRules = await client.get('/api/channels/recurring-rules/');
        currentProgress += progressPerStep;
      }

      // Export Comskip Config
      if (request.options.syncComskipConfig) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting comskip config...');
        exportData.data.comskipConfig = await client.get('/api/channels/comskip-config/');
        currentProgress += progressPerStep;
      }

      // Export Users
      if (request.options.syncUsers) {
        jobManager.setProgress(jobId, currentProgress, 'Exporting users...');
        const allUsers = await this.getAllPaginated(client, '/api/accounts/users/');
        // Keep all returned users (including admins); sort for stable output
        exportData.data.users = allUsers.sort((a: any, b: any) =>
          (a.username || '').localeCompare(b.username || '')
        );
        currentProgress += progressPerStep;
      }

      if (request.dryRun) {
        jobManager.completeJob(jobId, {
          message: 'Dry run completed - no files created',
          summary: this.generateSummary(exportData),
        });
        return '';
      }

      // Write config file
      jobManager.setProgress(jobId, 90, 'Writing configuration file...');
      const format = request.options.format || 'yaml';
      const configFileName = `dispatcharr-config-${Date.now()}.${format}`;
      const configFilePath = path.join(this.tempDir, configFileName);

      const configContent = this.formatExportContent(exportData, format);

      await writeFile(configFilePath, configContent, 'utf-8');

      // Handle compression
      const compress = request.options.compress || 'none';
      let finalFilePath = configFilePath;

      if (compress !== 'none') {
        jobManager.setProgress(jobId, 95, 'Compressing...');
        finalFilePath = await this.compressFile(configFilePath, compress, exportData.data.logos);
      }

      jobManager.completeJob(jobId, {
        filePath: finalFilePath,
        fileName: path.basename(finalFilePath),
        summary: this.generateSummary(exportData),
      });

      return finalFilePath;
    } catch (error: any) {
      jobManager.failJob(jobId, error.message);
      throw error;
    }
  }

  private countEnabledOptions(options: ExportOptions): number {
    return Object.entries(options)
      .filter(([key, value]) => {
        return (
          value === true &&
          key !== 'format' &&
          key !== 'compress' &&
          key !== 'downloadLogos'
        );
      }).length;
  }

  private async downloadLogos(
    client: DispatcharrClient,
    jobId: string
  ): Promise<{ [key: string]: string }> {
    try {
      const logos = await client.get('/api/channels/logos/');
      const logoData: { [key: string]: string } = {};

      const logoList = Array.isArray(logos) ? logos : logos.results || [];

      for (let i = 0; i < logoList.length; i++) {
        const logo = logoList[i];
        if (logo.url) {
          try {
            // Download logo as base64
            const response = await client.get(logo.url, { responseType: 'arraybuffer' });
            logoData[logo.id] = Buffer.from(response).toString('base64');
          } catch (error) {
            console.error(`Failed to download logo ${logo.id}:`, error);
          }
        }

        // Update progress
        if (i % 10 === 0) {
          const progress = 70 + Math.floor((i / logoList.length) * 20);
          jobManager.setProgress(jobId, progress, `Downloaded ${i}/${logoList.length} logos...`);
        }
      }

      return logoData;
    } catch (error) {
      console.error('Error downloading logos:', error);
      return {};
    }
  }

  private async compressFile(
    configFilePath: string,
    format: string,
    logos?: any
  ): Promise<string> {
    const baseName = path.basename(configFilePath, path.extname(configFilePath));

    if (format === 'zip') {
      const zipPath = path.join(this.tempDir, `${baseName}.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      return new Promise((resolve, reject) => {
        output.on('close', () => resolve(zipPath));
        archive.on('error', reject);

        archive.pipe(output);
        archive.file(configFilePath, { name: path.basename(configFilePath) });

        if (logos) {
          // Add logos as separate files
          Object.entries(logos).forEach(([id, base64Data]: [string, any]) => {
            const buffer = Buffer.from(base64Data, 'base64');
            archive.append(buffer, { name: `logos/${id}.png` });
          });
        }

        archive.finalize();
      });
    } else if (format === 'targz') {
      const tarPath = path.join(this.tempDir, `${baseName}.tar.gz`);

      // Create tar.gz using tar library
      await tar.create(
        {
          gzip: true,
          file: tarPath,
          cwd: path.dirname(configFilePath),
        },
        [path.basename(configFilePath)]
      );

      return tarPath;
    }

    return configFilePath;
  }

  private generateSummary(exportData: any): any {
    const summary: any = {
      exported_at: exportData.exported_at,
      source_url: exportData.source_url,
      counts: {},
    };

    if (exportData.data.channelGroups) {
      summary.counts.channelGroups = exportData.data.channelGroups.length;
    }
    if (exportData.data.channelProfiles) {
      summary.counts.channelProfiles = exportData.data.channelProfiles.length;
    }
    if (exportData.data.channels) {
      summary.counts.channels = exportData.data.channels.length;
    }
    if (exportData.data.m3uSources) {
      summary.counts.m3uSources = exportData.data.m3uSources.length;
    }
    if (exportData.data.streamProfiles) {
      summary.counts.streamProfiles = exportData.data.streamProfiles.length;
    }
    if (exportData.data.userAgents) {
      summary.counts.userAgents = exportData.data.userAgents.length;
    }
    if (exportData.data.epgSources) {
      summary.counts.epgSources = exportData.data.epgSources.length;
    }
    if (exportData.data.plugins) {
      summary.counts.plugins = exportData.data.plugins.length;
    }
    if (exportData.data.dvrRules) {
      summary.counts.dvrRules = exportData.data.dvrRules.length;
    }
    if (exportData.data.users) {
      summary.counts.users = exportData.data.users.length;
    }
    if (exportData.data.logos) {
      summary.counts.logos = Object.keys(exportData.data.logos).length;
    }

    return summary;
  }

  private formatExportContent(exportData: any, format: 'yaml' | 'json'): string {
    const sections: { key: string; label: string }[] = [
      { key: 'channelGroups', label: 'Channel Groups' },
      { key: 'channelProfiles', label: 'Channel Profiles' },
      { key: 'channels', label: 'Channels' },
      { key: 'm3uSources', label: 'M3U Sources' },
      { key: 'streamProfiles', label: 'Stream Profiles' },
      { key: 'userAgents', label: 'User Agents' },
      { key: 'coreSettings', label: 'Core Settings' },
      { key: 'epgSources', label: 'EPG Sources' },
      { key: 'logos', label: 'Logos' },
      { key: 'plugins', label: 'Plugins' },
      { key: 'dvrRules', label: 'DVR Rules' },
      { key: 'comskipConfig', label: 'Comskip Config' },
      { key: 'users', label: 'Users' },
    ];

    if (format === 'json') {
      // Insert marker keys so the JSON stays valid but shows section boundaries
      const dataWithComments: any = {};
      for (const section of sections) {
        const value = exportData.data[section.key];
        if (value !== undefined) {
          dataWithComments[`__comment_${section.key}`] = `--- ${section.label} ---`;
          dataWithComments[section.key] = value;
        }
      }

      const exportWithComments = {
        ...exportData,
        data: dataWithComments,
      };

      return JSON.stringify(exportWithComments, null, 2);
    }

    // YAML: add real comment lines between sections for readability
    const indentLines = (text: string, spaces = 2) =>
      text
        .split('\n')
        .map((line) => (line ? ' '.repeat(spaces) + line : line))
        .join('\n');

    const header = yaml.dump(
      {
        exported_at: exportData.exported_at,
        source_url: exportData.source_url,
      },
      { lineWidth: -1 }
    );

    const parts: string[] = [header.trimEnd(), 'data:'];

    for (const section of sections) {
      const value = exportData.data[section.key];
      if (value === undefined) continue;

      parts.push(`  # --- ${section.label} ---`);
      const sectionYaml = yaml
        .dump({ [section.key]: value }, { lineWidth: -1 })
        .replace(/\n$/, '');
      parts.push(indentLines(sectionYaml));
    }

    return parts.join('\n') + '\n';
  }

  async cleanup(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      console.error('Failed to cleanup file:', error);
    }
  }
}

export const exportService = new ExportService();
