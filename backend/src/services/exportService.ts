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
  private tempDir = path.join(process.cwd(), 'temp');

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

  private countEnabledOptions(options: ExportOptions): number {
    let count = 0;
    if (options.syncChannelGroups) count++;
    if (options.syncChannelProfiles) count++;
    if (options.syncChannels) count++;
    if (options.syncM3USources) count++;
    if (options.syncStreamProfiles) count++;
    if (options.syncUserAgents) count++;
    if (options.syncCoreSettings) count++;
    if (options.syncEPGSources) count += 2; // EPG sources + EPG data
    if (options.syncPlugins) count++;
    if (options.syncDVRRules) count++;
    if (options.syncComskipConfig) count++;
    if (options.syncUsers) count++;
    if (options.syncLogos) count++;
    return count;
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
      jobManager.setProgress(jobId, 5, 'Authenticating...');
      await client.authenticate();
      jobManager.addLog(jobId, 'Authenticated to source instance');

      // Calculate step-based progress (like sync/import)
      let currentProgress = 10;
      const totalSteps = Math.max(this.countEnabledOptions(request.options), 1);
      const progressPerStep = 85 / totalSteps; // 85% for export steps, 10% for auth, 5% for finalize
      const wantLogos = request.options.syncLogos !== false;

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
        currentProgress += progressPerStep;
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
        currentProgress += progressPerStep;
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
        currentProgress += progressPerStep;
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
        currentProgress += progressPerStep;
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
        currentProgress += progressPerStep;
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
        currentProgress += progressPerStep;
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
        currentProgress += progressPerStep;
        jobManager.addLog(jobId, `Exported ${coreSettings.length || 0} core settings`);
      }

      // Export EPG Sources
      if (request.options.syncEPGSources) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting EPG sources...');
        exportData.data.epgSources = await this.getAllPaginated(client, '/api/epg/sources/', jobId);
        currentProgress += progressPerStep;
        jobManager.addLog(jobId, `Exported ${exportData.data.epgSources.length || 0} EPG sources`);

        // Export EPG data rows so channel mappings stay intact
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting EPG data...');
        exportData.data.epgData = await this.getAllPaginated(client, '/api/epg/epgdata/', jobId);
        currentProgress += progressPerStep;
        const epgDataCount = exportData.data.epgData.length || 0;
        jobManager.addLog(jobId, `Exported ${epgDataCount} EPG data rows`);

        if (epgDataCount === 0) {
          jobManager.addLog(jobId, 'WARNING: No EPG data found on source instance! EPG sources may not have downloaded/parsed data yet. Channel EPG matching during import will rely on Dispatcharr\'s server-side matcher.');
        } else {
          jobManager.addLog(jobId, `EPG data will be included in backup file for accurate channel matching during import`);
        }
      }

      // Export Logos
      let logosResult: {
        zipPath: string;
        fileName: string;
        count: number;
        logos?: { id?: string | number; name?: string; data: string }[];
      } | null = null;

      if (wantLogos && !request.dryRun) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Downloading logos...');
        logosResult = await this.downloadLogos(client, jobId, 0, undefined, true);
        currentProgress += progressPerStep;
        jobManager.addLog(jobId, `Downloaded ${logosResult.count || 0} logos`);
      }

      // Export Plugins
      if (request.options.syncPlugins) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting plugins...');
        const pluginsResp = await client.get('/api/plugins/plugins/');
        // API returns {"plugins": [...]} - extract the array
        const plugins = Array.isArray(pluginsResp) ? pluginsResp : (pluginsResp?.plugins || []);
        exportData.data.plugins = plugins;
        currentProgress += progressPerStep;
        jobManager.addLog(jobId, `Exported ${plugins.length} plugins`);
      }

      // Export DVR Rules
      if (request.options.syncDVRRules) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting DVR rules...');
        const dvrRules = await client.get('/api/channels/recurring-rules/');
        exportData.data.dvrRules = dvrRules;
        currentProgress += progressPerStep;
        jobManager.addLog(jobId, `Exported ${Array.isArray(dvrRules) ? dvrRules.length : 0} DVR rules`);
      }

      // Export Comskip Config
      if (request.options.syncComskipConfig) {
        jobManager.setProgress(jobId, Math.round(currentProgress), 'Exporting comskip config...');
        exportData.data.comskipConfig = await client.get('/api/channels/dvr/comskip-config/');
        currentProgress += progressPerStep;
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
        currentProgress += progressPerStep;
        jobManager.addLog(jobId, `Exported ${exportData.data.users.length} users`);
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

      const workDir = path.join(this.tempDir, `export-${jobId}`);
      await mkdir(workDir, { recursive: true });

      const jsonPath = path.join(workDir, 'config.json');
      const configData = {
        ...exportData,
        data: { ...exportData.data },
      };
      // Do not embed logo binaries in config files; they are shipped separately
      delete (configData.data as any).logos;

      await writeFile(jsonPath, this.formatExportContent(configData), 'utf-8');

      if (logosResult?.logos && Array.isArray(logosResult.logos)) {
        const logosDir = path.join(workDir, 'logos');
        await mkdir(logosDir, { recursive: true });
        logosResult.logos.forEach((logo, idx) => {
          const buffer = Buffer.from(logo.data, 'base64');
          const name = (logo.name || logo.id || `logo-${idx}`).toString();
          const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
          fs.writeFileSync(path.join(logosDir, `${safe}.png`), buffer);
        });
      }

      jobManager.setProgress(jobId, 98, 'Compressing...');
      const finalFilePath = await this.compressDirectory(workDir);

      jobManager.completeJob(jobId, {
        filePath: finalFilePath,
        fileName: path.basename(finalFilePath),
        summary: this.generateSummary(exportData, logosResult?.count),
      });

      if (logosResult?.zipPath) {
        await this.cleanup(logosResult.zipPath);
      }
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

  private async downloadLogos(
    client: DispatcharrClient,
    jobId: string,
    expectedCount: number,
    onProgress?: (downloaded: number) => void,
    collectForConfig: boolean = false
  ): Promise<{ zipPath: string; fileName: string; count: number; logos?: { id?: string | number; name?: string; data: string }[] }> {
    try {
      const logoList = await this.getAllPaginated(client, '/api/channels/logos/', jobId);
      let downloaded = 0;
      const logosForConfig: { id?: string | number; name?: string; data: string }[] = [];

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
            const buffer = Buffer.isBuffer(response) ? response : Buffer.from(response);
            const safeName = `${logo.id || `logo-${i}`}.png`;
            archive.append(buffer, { name: safeName });

            if (collectForConfig) {
              logosForConfig.push({
                id: logo.id,
                name: logo.name,
                data: buffer.toString('base64'),
              });
            }
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

      return {
        zipPath,
        fileName,
        count: downloaded,
        logos: collectForConfig ? logosForConfig : undefined,
      };
    } catch (error) {
      console.error('Error downloading logos:', error);
      throw error;
    }
  }

  private async compressDirectory(workDir: string): Promise<string> {
    const baseName = path.basename(workDir);
    const zipPath = path.join(this.tempDir, `${baseName}.zip`);
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
    } else if (exportData.data.logos) {
      summary.counts.logos = exportData.data.logos.length || 0;
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
}

export const exportService = new ExportService();
