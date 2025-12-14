import { DispatcharrClient } from './dispatcharrClient.js';
import { jobManager } from './jobManager.js';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import type { ExportRequest, ExportOptions } from '../types/index.js';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

export class ExportService {
  private backupDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'backups') : path.join(process.cwd(), 'data', 'backups');

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

  // Weights for progress calculation - logos takes much longer due to individual file downloads
  private readonly optionWeights: Record<string, number> = {
    syncChannelGroups: 1,
    syncChannelProfiles: 1,
    syncChannels: 1,
    syncM3USources: 1,
    syncStreamProfiles: 1,
    syncUserAgents: 1,
    syncCoreSettings: 1,
    syncEPGSources: 2, // EPG sources + EPG data
    syncPlugins: 1,
    syncDVRRules: 1,
    syncComskipConfig: 1,
    syncUsers: 1,
    syncLogos: 5, // Logos take significantly longer - each file is downloaded individually
  };

  private countEnabledOptions(options: ExportOptions): number {
    return Object.entries(options)
      .filter(([key, value]) => value === true && key in this.optionWeights)
      .reduce((sum, [key]) => sum + (this.optionWeights[key] || 1), 0);
  }

  private getOptionWeight(optionKey: string): number {
    return this.optionWeights[optionKey] || 1;
  }

  async export(request: ExportRequest, jobId: string): Promise<string> {
    try {
      jobManager.startJob(jobId, 'Initializing export...');
      this.throwIfCancelled(jobId);
      jobManager.addLog(jobId, 'Preparing export job');

      // Ensure backup directory exists
      await mkdir(this.backupDir, { recursive: true });

      const client = new DispatcharrClient(request.source);

      // Authenticate
      jobManager.setProgress(jobId, 5, 'Authenticating...');
      await client.authenticate();
      jobManager.addLog(jobId, 'Authenticated to source instance');

      // Calculate weighted progress (logos take longer due to individual file downloads)
      let currentProgress = 10;
      const totalWeight = Math.max(this.countEnabledOptions(request.options), 1);
      const progressPerWeight = 85 / totalWeight; // 85% for export steps, 10% for auth, 5% for finalize

      const exportData: any = {
        exported_at: new Date().toISOString(),
        source_url: request.source.url,
        data: {},
      };

      // Export Channel Groups
      if (request.options.syncChannelGroups) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting channel groups...');
        const allGroups = await client.get('/api/channels/groups/');
        // Filter out groups created by M3U sources (those with m3u_account_count > 0)
        const manualGroups = Array.isArray(allGroups)
          ? allGroups.filter((group: any) => !group.m3u_account_count || group.m3u_account_count === 0)
          : allGroups;
        exportData.data.channelGroups = manualGroups;
        currentProgress += progressPerWeight * this.getOptionWeight('syncChannelGroups');
        jobManager.addLog(jobId, `Exported ${Array.isArray(manualGroups) ? manualGroups.length : 0} channel groups`);
      }

      // Export Channel Profiles
      if (request.options.syncChannelProfiles) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting channel profiles...');
        const profiles = await client.get('/api/channels/profiles/');

        // The profile objects already contain the channel IDs in the 'channels' array
        const profilesWithChannels = (Array.isArray(profiles) ? profiles : []).map((profile: any) => {
          const channelIds = Array.isArray(profile.channels) ? profile.channels : [];
          jobManager.addLog(jobId, `Profile "${profile.name}" (ID: ${profile.id}): has ${channelIds.length} channels`);

          return {
            ...profile,
            enabled_channels: channelIds
          };
        });

        exportData.data.channelProfiles = profilesWithChannels;
        currentProgress += progressPerWeight * this.getOptionWeight('syncChannelProfiles');
        jobManager.addLog(jobId, `Exported ${Array.isArray(profiles) ? profiles.length : 0} channel profiles with channel associations`);
      }

      // Export Channels
      if (request.options.syncChannels) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting channels...');
        const allChannels = await this.getAllPaginated(client, '/api/channels/channels/', jobId);
        const allStreams = await this.getAllPaginated(client, '/api/channels/streams/', jobId);
        const streamMap = new Map<number, any>();
        allStreams.forEach((s: any) => {
          if (s?.id != null) {
            streamMap.set(s.id, {
              id: s.id,
              name: s.name,
              tvg_id: s.tvg_id,
              stream_hash: s.stream_hash || s.hash,
              hash: s.hash || s.stream_hash,
              m3u_account: s.m3u_account,
              channel_group: s.channel_group,
              url: s.url,
              tvc_guide_stationid: (s as any)?.tvc_guide_stationid,
            });
          }
        });

        // Filter out auto-created channels (those created via M3U auto channel sync)
        const manualChannels = allChannels
          .filter((channel: any) => !channel.auto_created)
          .sort((a: any, b: any) => {
            const aNum = Number(a.channel_number) || 0;
            const bNum = Number(b.channel_number) || 0;
            return aNum - bNum;
          });
        const channelsWithStreams = manualChannels.map((ch: any) => {
          if (!Array.isArray(ch?.streams)) return ch;
          const streams = ch.streams
            .map((ref: any) => {
              if (ref && typeof ref === 'object') {
                return {
                  id: ref.id,
                  name: ref.name,
                  tvg_id: ref.tvg_id || ref.tvgId,
                  stream_hash: ref.stream_hash || ref.hash,
                  hash: ref.hash || ref.stream_hash,
                  m3u_account: ref.m3u_account,
                  channel_group: ref.channel_group,
                  url: ref.url,
                  tvc_guide_stationid: ref.tvc_guide_stationid,
                  stream_profile_id: ref.stream_profile_id,
                };
              }
              const mapped = streamMap.get(ref);
              return mapped || { id: ref };
            })
            .filter(Boolean);
          return { ...ch, streams };
        });

        // Debug: Log first few channels to see what fields are present
        if (channelsWithStreams.length > 0) {
          const firstChannel = channelsWithStreams[0];
          const channelKeys = Object.keys(firstChannel).filter(k => !k.startsWith('_') && k !== 'streams');
          jobManager.addLog(jobId, `Sample exported channel fields: ${channelKeys.join(', ')}`);
          jobManager.addLog(jobId, `First channel stream_profile_id: ${firstChannel.stream_profile_id}`);
        }

        exportData.data.channels = channelsWithStreams;
        currentProgress += progressPerWeight * this.getOptionWeight('syncChannels');
        jobManager.addLog(jobId, `Exported ${manualChannels.length} channels`);
      }

      // Export M3U Sources
      let channelGroupMap: Record<number, string> = {};
      if (request.options.syncM3USources) {
        try {
          const groups = await client.get('/api/channels/groups/');
          if (Array.isArray(groups)) {
            channelGroupMap = Object.fromEntries(groups.map((g: any) => [g.id, g.name]));
          }
        } catch {
          channelGroupMap = {};
        }

        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting M3U sources...');
        // Swagger path uses /api/m3u/accounts/ for M3U source definitions
        const accounts = await this.getAllPaginated(client, '/api/m3u/accounts/', jobId);
        // Ensure credentials (username/password) are included if present on the source
        exportData.data.m3uSources = accounts.map((acct: any) => {
          const { username, password, ...rest } = acct;
          const channel_groups = Array.isArray(rest.channel_groups)
            ? rest.channel_groups.map((cg: any) => ({
              ...cg,
              channel_group_name:
                cg?.channel_group_name ||
                (cg?.channel_group != null ? channelGroupMap[cg.channel_group] : undefined),
            }))
            : rest.channel_groups;

          return {
            ...rest,
            ...(channel_groups ? { channel_groups } : {}),
            ...(username ? { username } : {}),
            ...(password ? { password } : {}),
          };
        });
        currentProgress += progressPerWeight * this.getOptionWeight('syncM3USources');
        jobManager.addLog(jobId, `Exported ${accounts.length} M3U sources`);
      }

      // Export Stream Profiles
      if (request.options.syncStreamProfiles) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting stream profiles...');
        // Stream profiles live under /api/core/streamprofiles/ per swagger
        exportData.data.streamProfiles = await this.getAllPaginated(
          client,
          '/api/core/streamprofiles/',
          jobId
        );
        currentProgress += progressPerWeight * this.getOptionWeight('syncStreamProfiles');
        jobManager.addLog(jobId, `Exported ${exportData.data.streamProfiles.length} stream profiles`);
      }

      // Export User Agents
      if (request.options.syncUserAgents) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting user agents...');
        // User agents endpoint is /api/core/useragents/
        exportData.data.userAgents = await this.getAllPaginated(
          client,
          '/api/core/useragents/',
          jobId
        );
        currentProgress += progressPerWeight * this.getOptionWeight('syncUserAgents');
        jobManager.addLog(jobId, `Exported ${exportData.data.userAgents.length} user agents`);
      }

      // Export Core Settings
      if (request.options.syncCoreSettings) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting core settings...');
        const coreSettingsResp = await this.getAllPaginated(client, '/api/core/settings/', jobId);
        const coreSettings = Array.isArray(coreSettingsResp)
          ? coreSettingsResp
          : coreSettingsResp
            ? [coreSettingsResp]
            : [];
        exportData.data.coreSettings = coreSettings;
        currentProgress += progressPerWeight * this.getOptionWeight('syncCoreSettings');
        jobManager.addLog(jobId, `Exported ${coreSettings.length || 0} core settings`);
      }

      // Export EPG Sources (weight of 2 covers both EPG sources and EPG data)
      if (request.options.syncEPGSources) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting EPG sources...');
        exportData.data.epgSources = await this.getAllPaginated(client, '/api/epg/sources/', jobId);
        jobManager.addLog(jobId, `Exported ${exportData.data.epgSources.length || 0} EPG sources`);

        // Export EPG data rows so channel mappings stay intact
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting EPG data...');
        exportData.data.epgData = await this.getAllPaginated(client, '/api/epg/epgdata/', jobId);
        currentProgress += progressPerWeight * this.getOptionWeight('syncEPGSources');
        const epgDataCount = exportData.data.epgData.length || 0;
        jobManager.addLog(jobId, `Exported ${epgDataCount} EPG data rows`);

        if (epgDataCount === 0) {
          jobManager.addLog(jobId, 'WARNING: No EPG data found on source instance! EPG sources may not have downloaded/parsed data yet. Channel EPG matching during import will rely on Dispatcharr\'s server-side matcher.');
        } else {
          jobManager.addLog(jobId, `EPG data will be included in backup file for accurate channel matching during import`);
        }
      }

      // Export Plugins
      if (request.options.syncPlugins) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting plugins...');
        const pluginsResp = await client.get('/api/plugins/plugins/');
        // API returns {"plugins": [...]} - extract the array
        const plugins = Array.isArray(pluginsResp) ? pluginsResp : (pluginsResp?.plugins || []);
        exportData.data.plugins = plugins;
        currentProgress += progressPerWeight * this.getOptionWeight('syncPlugins');
        jobManager.addLog(jobId, `Exported ${plugins.length} plugins`);
      }

      // Export DVR Rules
      if (request.options.syncDVRRules) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting DVR rules...');
        const dvrRules = await client.get('/api/channels/recurring-rules/');
        exportData.data.dvrRules = dvrRules;
        currentProgress += progressPerWeight * this.getOptionWeight('syncDVRRules');
        jobManager.addLog(jobId, `Exported ${Array.isArray(dvrRules) ? dvrRules.length : 0} DVR rules`);
      }

      // Export Comskip Config
      if (request.options.syncComskipConfig) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting comskip config...');
        exportData.data.comskipConfig = await client.get('/api/channels/dvr/comskip-config/');
        currentProgress += progressPerWeight * this.getOptionWeight('syncComskipConfig');
        jobManager.addLog(jobId, 'Exported comskip config');
      }

      // Export Users
      if (request.options.syncUsers) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting users...');
        const allUsers = await this.getAllPaginated(client, '/api/accounts/users/', jobId);
        // Keep all returned users (including admins); sort for stable output
        exportData.data.users = allUsers.sort((a: any, b: any) =>
          (a.username || '').localeCompare(b.username || '')
        );
        currentProgress += progressPerWeight * this.getOptionWeight('syncUsers');
        jobManager.addLog(jobId, `Exported ${exportData.data.users.length} users`);
      }

      // Export Logos
      if (request.options.syncLogos) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting logos...');

        // Get all logos from the logos API - export ALL logos
        // The logos API contains manually uploaded logos that should all be backed up
        // (Channels reference logos by URL, not by logo_id, so filtering by channel references doesn't work)
        const allLogos = await this.getAllPaginated(client, '/api/channels/logos/', jobId);

        jobManager.addLog(jobId, `Found ${allLogos.length} logos to export`);

        // Store logo metadata and buffers for later file writing
        const logoMetadata: any[] = [];
        const logoBuffers: Map<string, Buffer> = new Map();

        for (const logo of allLogos) {
          if (!logo?.url) continue;
          try {
            // Check if URL is external (starts with http) vs local path
            const isExternalUrl = logo.url.startsWith('http://') || logo.url.startsWith('https://');

            let buffer: Buffer;
            if (isExternalUrl) {
              // For external URLs, use axios directly with User-Agent header to avoid 403s
              const axios = (await import('axios')).default;
              const response = await axios.get(logo.url, {
                responseType: 'arraybuffer',
                headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; DBAS/1.0; +https://github.com/motwakorb/dispatcharr-backup-sync)',
                },
                timeout: 30000,
              });
              buffer = Buffer.from(response.data);
            } else {
              // For local paths, try multiple URL patterns since Dispatcharr stores internal paths
              // The stored path might be /data/logos/X but served from /media/logos/X or /logos/X
              const pathsToTry = [logo.url];

              // Transform /data/logos/X to other common serving paths
              if (logo.url.startsWith('/data/logos/')) {
                const filename = logo.url.replace('/data/logos/', '');
                pathsToTry.push(`/media/logos/${filename}`);
                pathsToTry.push(`/logos/${filename}`);
                pathsToTry.push(`/static/logos/${filename}`);
              }

              // Also try fetching by logo ID if available
              if (logo.id) {
                pathsToTry.push(`/api/channels/logos/${logo.id}/file/`);
                pathsToTry.push(`/api/channels/logos/${logo.id}/download/`);
              }

              let downloaded = false;
              let lastError: any = null;

              for (const tryPath of pathsToTry) {
                try {
                  const response = await client.get(tryPath, { responseType: 'arraybuffer' });
                  buffer = Buffer.isBuffer(response) ? response : Buffer.from(response);
                  downloaded = true;
                  break;
                } catch (err) {
                  lastError = err;
                  // Continue to next path
                }
              }

              if (!downloaded) {
                throw lastError || new Error('All download paths failed');
              }
            }

            // Determine file extension from URL
            const urlLower = logo.url.toLowerCase();
            let ext = 'png';
            if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) {
              ext = 'jpg';
            } else if (urlLower.includes('.webp')) {
              ext = 'webp';
            } else if (urlLower.includes('.gif')) {
              ext = 'gif';
            } else if (urlLower.includes('.svg')) {
              ext = 'svg';
            }

            // Create safe filename
            const logoName = String(logo.name || logo.id).replace(/[^a-zA-Z0-9_-]/g, '_');
            const filename = `${logoName}.${ext}`;

            logoMetadata.push({
              id: logo.id, // Original logo ID for mapping during import
              name: logo.name || logo.id,
              filename: filename,
            });
            logoBuffers.set(filename, buffer);
          } catch (e: any) {
            const errMsg = e?.response?.status
              ? `HTTP ${e.response.status}`
              : e?.message || 'Unknown error';
            jobManager.addLog(jobId, `Warning: Failed to download logo "${logo.name || logo.id}" (URL: ${logo.url}) - ${errMsg}`);
          }
        }

        // Store logo metadata (not the actual data) - files will be written separately
        exportData.data.logos = logoMetadata;
        exportData._logoBuffers = logoBuffers; // Temporary storage for file writing
        currentProgress += progressPerWeight * this.getOptionWeight('syncLogos');
        jobManager.addLog(jobId, `Exported ${logoMetadata.length} logos`);
      }

      if (request.dryRun) {
        jobManager.completeJob(jobId, {
          message: 'Dry run completed - no files created',
          summary: this.generateSummary(exportData),
        });
        return '';
      }

      // Write config file (JSON) and pack into archive
      jobManager.setProgress(jobId, 95, 'Writing configuration file...');
      this.throwIfCancelled(jobId);

      const workDir = path.join(this.backupDir, `backup-${jobId}`);
      await mkdir(workDir, { recursive: true });

      // Write logo files to logos/ subdirectory if we have any
      const logoBuffers = exportData._logoBuffers as Map<string, Buffer> | undefined;
      if (logoBuffers && logoBuffers.size > 0) {
        const logosDir = path.join(workDir, 'logos');
        await mkdir(logosDir, { recursive: true });

        for (const [filename, buffer] of logoBuffers) {
          const logoPath = path.join(logosDir, filename);
          await writeFile(logoPath, buffer);
        }
        jobManager.addLog(jobId, `Wrote ${logoBuffers.size} logo files to logos/ directory`);
      }

      // Remove temporary _logoBuffers before writing JSON
      const jsonPath = path.join(workDir, 'config.json');
      const configData = {
        ...exportData,
        data: { ...exportData.data },
      };
      delete (configData as any)._logoBuffers;

      await writeFile(jsonPath, this.formatExportContent(configData), 'utf-8');

      jobManager.setProgress(jobId, 98, 'Compressing...');
      const finalFilePath = await this.compressDirectory(workDir);

      jobManager.completeJob(jobId, {
        filePath: finalFilePath,
        fileName: path.basename(finalFilePath),
        summary: this.generateSummary(exportData),
      });

      await this.cleanupDirectory(workDir);

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

  private async compressDirectory(workDir: string): Promise<string> {
    const baseName = path.basename(workDir);
    const zipPath = path.join(this.backupDir, `${baseName}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => resolve(zipPath));
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(workDir, false);
      archive.finalize();
    });
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
      summary.counts.logos = exportData.data.logos.length;
    }

    return summary;
  }

  private formatExportContent(exportData: any): string {
    const sections: { key: string; label: string }[] = [
      { key: 'channelGroups', label: 'Channel Groups' },
      { key: 'channelProfiles', label: 'Channel Profiles' },
      { key: 'channels', label: 'Channels' },
      { key: 'm3uSources', label: 'M3U Sources' },
      { key: 'streamProfiles', label: 'Stream Profiles' },
      { key: 'userAgents', label: 'User Agents' },
      { key: 'coreSettings', label: 'Core Settings' },
      { key: 'epgSources', label: 'EPG Sources' },
      { key: 'epgData', label: 'EPG Data' },
      { key: 'plugins', label: 'Plugins' },
      { key: 'dvrRules', label: 'DVR Rules' },
      { key: 'comskipConfig', label: 'Comskip Config' },
      { key: 'users', label: 'Users' },
      { key: 'logos', label: 'Logos' },
    ];

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

  async cleanup(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      console.error('Failed to cleanup file:', error);
    }
  }

  async cleanupDirectory(dirPath: string): Promise<void> {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup directory:', error);
    }
  }

  /**
   * Cleanup old backups based on retention policy
   * @param jobIdsToDelete Array of job IDs whose backup files should be deleted
   */
  async cleanupOldBackups(jobIdsToDelete: string[]): Promise<{ deleted: string[]; errors: string[] }> {
    const deleted: string[] = [];
    const errors: string[] = [];

    for (const jobId of jobIdsToDelete) {
      const backupPath = path.join(this.backupDir, `backup-${jobId}.zip`);
      try {
        await fs.promises.access(backupPath);
        await unlink(backupPath);
        deleted.push(jobId);
        console.log(`Retention cleanup: Deleted backup file backup-${jobId}.zip`);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, skip silently
          console.log(`Retention cleanup: Backup file backup-${jobId}.zip not found, skipping`);
        } else {
          errors.push(`Failed to delete backup-${jobId}.zip: ${error.message}`);
          console.error(`Retention cleanup: Failed to delete backup-${jobId}.zip:`, error);
        }
      }
    }

    return { deleted, errors };
  }

  /**
   * Get the backup directory path (for external use)
   */
  getBackupDir(): string {
    return this.backupDir;
  }
}

export const exportService = new ExportService();
