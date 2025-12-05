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
  private progressBase = 5;
  private progressSpan = 90;

  private throwIfCancelled(jobId: string) {
    const job = jobManager.getJob(jobId);
    if (job?.status === 'cancelled') {
      const err: any = new Error('Export cancelled by user');
      err.cancelled = true;
      throw err;
    }
  }

  private async getAllPaginated(client: any, endpoint: string, jobId?: string): Promise<any[]> {
    let allResults: any[] = [];
    let page = 1;
    const pageSize = 1000;

    while (true) {
      if (jobId) {
        this.throwIfCancelled(jobId);
      }
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

  private calcProgress(processedUnits: number, totalUnits: number): number {
    if (totalUnits <= 0) return this.progressBase;
    const ratio = Math.min(processedUnits / totalUnits, 1);
    return Math.min(
      this.progressBase + Math.floor(ratio * this.progressSpan),
      this.progressBase + this.progressSpan
    );
  }

  private async getCount(client: any, endpoint: string): Promise<number> {
    try {
      const resp = await client.get(`${endpoint}?page=1&page_size=1`);
      if (typeof resp?.count === 'number') return resp.count;
      if (Array.isArray(resp)) return resp.length;
      if (Array.isArray(resp?.results)) return resp.results.length;
      return 0;
    } catch {
      return 0;
    }
  }

  private async estimateWork(client: DispatcharrClient, options: ExportOptions): Promise<{
    totalUnits: number;
    logoCount: number;
  }> {
    let totalUnits = 0;
    let logoCount = 0;

    if (options.syncChannelGroups) totalUnits += await this.getCount(client, '/api/channels/groups/');
    if (options.syncChannelProfiles) totalUnits += await this.getCount(client, '/api/channels/profiles/');
    if (options.syncChannels) totalUnits += await this.getCount(client, '/api/channels/channels/');
    if (options.syncM3USources) totalUnits += await this.getCount(client, '/api/m3u/accounts/');
    if (options.syncStreamProfiles) totalUnits += await this.getCount(client, '/api/core/streamprofiles/');
    if (options.syncUserAgents) totalUnits += await this.getCount(client, '/api/core/useragents/');
    if (options.syncEPGSources) totalUnits += await this.getCount(client, '/api/epg/sources/');
    if (options.syncPlugins) totalUnits += await this.getCount(client, '/api/plugins/plugins/');
    if (options.syncDVRRules) totalUnits += await this.getCount(client, '/api/channels/recurring-rules/');
    if (options.syncComskipConfig) totalUnits += 1;
    if (options.syncUsers) totalUnits += await this.getCount(client, '/api/accounts/users/');
    if (options.downloadLogos) {
      logoCount = await this.getCount(client, '/api/channels/logos/');
      totalUnits += logoCount;
    }
    // Core settings always count as 1 unit when selected
    if (options.syncCoreSettings) totalUnits += 1;

    if (totalUnits === 0) totalUnits = 1;

    return { totalUnits, logoCount };
  }

  async export(request: ExportRequest, jobId: string): Promise<string> {
    try {
      jobManager.startJob(jobId, 'Initializing export...');
      this.throwIfCancelled(jobId);
      jobManager.addLog(jobId, 'Preparing export job');

      // Ensure temp directory exists
      await mkdir(this.tempDir, { recursive: true });

      const client = new DispatcharrClient(request.source);

      // Authenticate
      jobManager.setProgress(jobId, this.progressBase, 'Authenticating...');
      await client.authenticate();
      jobManager.addLog(jobId, 'Authenticated to source instance');

      // Pre-calculate work units for realistic progress
      const { totalUnits, logoCount } = await this.estimateWork(client, request.options);
      jobManager.addLog(
        jobId,
        `Estimated work: ${totalUnits} items${logoCount ? `, ${logoCount} logos` : ''}`
      );
      let processedUnits = 0;

      const bumpProgress = (units: number, message?: string) => {
        processedUnits += units;
        const percent = this.calcProgress(processedUnits, totalUnits);
        jobManager.setProgress(jobId, percent, message);
      };

      const exportData: any = {
        exported_at: new Date().toISOString(),
        source_url: request.source.url,
        data: {},
      };

      // Export Channel Groups
      if (request.options.syncChannelGroups) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting channel groups...');
        const allGroups = await client.get('/api/channels/groups/');
        // Filter out groups created by M3U sources (those with m3u_account_count > 0)
        const manualGroups = Array.isArray(allGroups)
          ? allGroups.filter((group: any) => !group.m3u_account_count || group.m3u_account_count === 0)
          : allGroups;
        exportData.data.channelGroups = manualGroups;
        bumpProgress(Array.isArray(manualGroups) ? manualGroups.length : 1, 'Exporting channel groups...');
        jobManager.addLog(jobId, `Exported ${Array.isArray(manualGroups) ? manualGroups.length : 0} channel groups`);
      }

      // Export Channel Profiles
      if (request.options.syncChannelProfiles) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting channel profiles...');
        const profiles = await client.get('/api/channels/profiles/');
        exportData.data.channelProfiles = profiles;
        bumpProgress(Array.isArray(profiles) ? profiles.length : 1, 'Exporting channel profiles...');
        jobManager.addLog(jobId, `Exported ${Array.isArray(profiles) ? profiles.length : 0} channel profiles`);
      }

      // Export Channels
      if (request.options.syncChannels) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting channels...');
        const allChannels = await this.getAllPaginated(client, '/api/channels/channels/', jobId);
        // Filter out auto-created channels (those created via M3U auto channel sync)
        const manualChannels = allChannels
          .filter((channel: any) => !channel.auto_created)
          .sort((a: any, b: any) => {
            const aNum = Number(a.channel_number) || 0;
            const bNum = Number(b.channel_number) || 0;
            return aNum - bNum;
          });
        exportData.data.channels = manualChannels;
        bumpProgress(manualChannels.length, 'Exporting channels...');
        jobManager.addLog(jobId, `Exported ${manualChannels.length} channels`);
      }

      // Export M3U Sources
      if (request.options.syncM3USources) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting M3U sources...');
        // Swagger path uses /api/m3u/accounts/ for M3U source definitions
        const accounts = await this.getAllPaginated(client, '/api/m3u/accounts/', jobId);
        // Ensure credentials (username/password) are included if present on the source
        exportData.data.m3uSources = accounts.map((acct: any) => {
          const { username, password, ...rest } = acct;
          return {
            ...rest,
            ...(username ? { username } : {}),
            ...(password ? { password } : {}),
          };
        });
        bumpProgress(accounts.length, 'Exporting M3U sources...');
        jobManager.addLog(jobId, `Exported ${accounts.length} M3U sources`);
      }

      // Export Stream Profiles
      if (request.options.syncStreamProfiles) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting stream profiles...');
        // Stream profiles live under /api/core/streamprofiles/ per swagger
        exportData.data.streamProfiles = await this.getAllPaginated(
          client,
          '/api/core/streamprofiles/',
          jobId
        );
        bumpProgress(exportData.data.streamProfiles.length, 'Exporting stream profiles...');
        jobManager.addLog(jobId, `Exported ${exportData.data.streamProfiles.length} stream profiles`);
      }

      // Export User Agents
      if (request.options.syncUserAgents) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting user agents...');
        // User agents endpoint is /api/core/useragents/
        exportData.data.userAgents = await this.getAllPaginated(
          client,
          '/api/core/useragents/',
          jobId
        );
        bumpProgress(exportData.data.userAgents.length, 'Exporting user agents...');
        jobManager.addLog(jobId, `Exported ${exportData.data.userAgents.length} user agents`);
      }

      // Export Core Settings
      if (request.options.syncCoreSettings) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting core settings...');
        const coreSettings = await client.get('/api/core/settings/');
        exportData.data.coreSettings = coreSettings;
        bumpProgress(1, 'Exporting core settings...');
        jobManager.addLog(jobId, 'Exported core settings');
      }

      // Export EPG Sources
      if (request.options.syncEPGSources) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting EPG sources...');
        exportData.data.epgSources = await this.getAllPaginated(client, '/api/epg/sources/', jobId);
        bumpProgress(exportData.data.epgSources.length, 'Exporting EPG sources...');
        jobManager.addLog(jobId, `Exported ${exportData.data.epgSources.length} EPG sources`);
      }

      // Export Logos
      let logosResult: { zipPath: string; fileName: string; count: number } | null = null;

      if (request.options.downloadLogos && !request.dryRun) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Downloading logos...');
        logosResult = await this.downloadLogos(client, jobId, logoCount, (processed) => {
          const percent = this.calcProgress(processedUnits + processed, totalUnits);
          jobManager.setProgress(jobId, percent, 'Downloading logos...');
        });
        bumpProgress(logosResult.count || logoCount, 'Downloading logos...');
        jobManager.addLog(jobId, `Downloaded ${logosResult.count || 0} logos`);
      }

      // Export Plugins
      if (request.options.syncPlugins) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting plugins...');
        const plugins = await client.get('/api/plugins/plugins/');
        exportData.data.plugins = plugins;
        bumpProgress(Array.isArray(plugins) ? plugins.length : 1, 'Exporting plugins...');
        jobManager.addLog(jobId, `Exported ${Array.isArray(plugins) ? plugins.length : 0} plugins`);
      }

      // Export DVR Rules
      if (request.options.syncDVRRules) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting DVR rules...');
        const dvrRules = await client.get('/api/channels/recurring-rules/');
        exportData.data.dvrRules = dvrRules;
        bumpProgress(Array.isArray(dvrRules) ? dvrRules.length : 1, 'Exporting DVR rules...');
        jobManager.addLog(jobId, `Exported ${Array.isArray(dvrRules) ? dvrRules.length : 0} DVR rules`);
      }

      // Export Comskip Config
      if (request.options.syncComskipConfig) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting comskip config...');
        exportData.data.comskipConfig = await client.get('/api/channels/comskip-config/');
        bumpProgress(1, 'Exporting comskip config...');
        jobManager.addLog(jobId, 'Exported comskip config');
      }

      // Export Users
      if (request.options.syncUsers) {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Exporting users...');
        const allUsers = await this.getAllPaginated(client, '/api/accounts/users/', jobId);
        // Keep all returned users (including admins); sort for stable output
        exportData.data.users = allUsers.sort((a: any, b: any) =>
          (a.username || '').localeCompare(b.username || '')
        );
        bumpProgress(exportData.data.users.length, 'Exporting users...');
        jobManager.addLog(jobId, `Exported ${exportData.data.users.length} users`);
      }

      if (request.dryRun) {
        jobManager.completeJob(jobId, {
          message: 'Dry run completed - no files created',
          summary: this.generateSummary(exportData),
        });
        return '';
      }

      // Write config file
      jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Writing configuration file...');
      this.throwIfCancelled(jobId);
      const format = request.options.format || 'yaml';
      const configFileName = `dispatcharr-config-${Date.now()}.${format}`;
      const configFilePath = path.join(this.tempDir, configFileName);

      const configContent = this.formatExportContent(exportData, format);

      await writeFile(configFilePath, configContent, 'utf-8');

      // Handle compression
      const compress = request.options.compress || 'none';
      let finalFilePath = configFilePath;

      if (compress !== 'none') {
        jobManager.setProgress(jobId, this.calcProgress(processedUnits, totalUnits), 'Compressing...');
        finalFilePath = await this.compressFile(configFilePath, compress, exportData.data.logos);
      }

      jobManager.completeJob(jobId, {
        filePath: finalFilePath,
        fileName: path.basename(finalFilePath),
        logosFilePath: logosResult?.zipPath,
        logosFileName: logosResult?.fileName,
        summary: this.generateSummary(exportData, logosResult?.count),
      });

      return finalFilePath;
    } catch (error: any) {
      if (error?.cancelled) {
        jobManager.cancelJob(jobId, error.message);
      } else {
        jobManager.failJob(jobId, error.message);
      }
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
    jobId: string,
    expectedCount: number,
    onProgress?: (downloaded: number) => void
  ): Promise<{ zipPath: string; fileName: string; count: number }> {
    try {
      const logoList = await this.getAllPaginated(client, '/api/channels/logos/', jobId);
      let downloaded = 0;

      const fileName = `dispatcharr-logos-${Date.now()}.zip`;
      const zipPath = path.join(this.tempDir, fileName);

      await mkdir(this.tempDir, { recursive: true });
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      const zipPromise = new Promise<void>((resolve, reject) => {
        output.on('close', () => resolve());
        archive.on('error', reject);
      });

      archive.pipe(output);

      for (let i = 0; i < logoList.length; i++) {
        this.throwIfCancelled(jobId);
        const logo = logoList[i];
        if (logo.url) {
          try {
            const response = await client.get(logo.url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response);
            const safeName = `${logo.id || `logo-${i}`}.png`;
            archive.append(buffer, { name: safeName });
          } catch (error) {
            console.error(`Failed to download logo ${logo.id}:`, error);
          }
        }

        downloaded++;
        if (onProgress && (i % 10 === 0 || downloaded === expectedCount)) {
          onProgress(downloaded);
        }
      }

      await archive.finalize();
      await zipPromise;

      return { zipPath, fileName, count: downloaded };
    } catch (error) {
      console.error('Error downloading logos:', error);
      throw error;
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

  private generateSummary(exportData: any, logosCount?: number): any {
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
    if (logosCount !== undefined) {
      summary.counts.logos = logosCount;
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
