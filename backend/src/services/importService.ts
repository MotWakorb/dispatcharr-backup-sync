import { DispatcharrClient } from './dispatcharrClient.js';
import { jobManager } from './jobManager.js';
import yaml from 'js-yaml';
import fs, { promises as fsp } from 'fs';
import path from 'path';
import { promisify } from 'util';
import FormData from 'form-data';
import AdmZip from 'adm-zip';
import tar from 'tar';
import { v4 as uuidv4 } from 'uuid';
import type { ImportOptions, ImportRequest } from '../types/index.js';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const rm = promisify((fs as any).rm || fs.rmdir);

const SECTION_OPTION_MAP = {
  channelGroups: 'syncChannelGroups',
  channelProfiles: 'syncChannelProfiles',
  channels: 'syncChannels',
  m3uSources: 'syncM3USources',
  streamProfiles: 'syncStreamProfiles',
  userAgents: 'syncUserAgents',
  coreSettings: 'syncCoreSettings',
  epgSources: 'syncEPGSources',
  epgData: 'syncEPGSources',
  plugins: 'syncPlugins',
  dvrRules: 'syncDVRRules',
  comskipConfig: 'syncComskipConfig',
  users: 'syncUsers',
  logos: 'syncLogos',
} as const;

export class ImportService {
  private tempDir = path.join(process.cwd(), 'temp');
  private cacheDir = path.join(this.tempDir, 'upload-cache');

  private normalizeKey(value: any): string | undefined {
    return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  }

  private async getAllPaginated(
    client: DispatcharrClient,
    endpoint: string,
    pageSize = 1000
  ): Promise<any[]> {
    let page = 1;
    let all: any[] = [];

    while (true) {
      // Use & if endpoint already has query params, otherwise use ?
      const separator = endpoint.includes('?') ? '&' : '?';
      const response = await client.get(`${endpoint}${separator}page=${page}&page_size=${pageSize}`).catch(() => null);
      if (!response) {
        break;
      }
      if (Array.isArray(response?.results)) {
        all = all.concat(response.results);
        if (!response.next) break;
        page++;
        continue;
      }
      if (Array.isArray(response)) {
        all = response;
        break;
      }
      all.push(response);
      break;
    }

    return all;
  }

  private logJobError(jobId: string, section: string, label: any, error: any) {
    const details = this.formatErrorDetails(error);
    const labelText = label ? ` (${label})` : '';
    try {
      jobManager.addLog(jobId, `${section} failed${labelText}: ${JSON.stringify(details)}`);
    } catch (e) {
      // no-op if logging fails
    }
    console.error(`${section} failed`, label, details);
  }

  private redact(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    const clone: any = Array.isArray(obj) ? [] : {};
    for (const [key, value] of Object.entries(obj)) {
      if (/password|pass|token|secret/i.test(key)) {
        clone[key] = '***redacted***';
      } else if (typeof value === 'object') {
        clone[key] = this.redact(value);
      } else {
        clone[key] = value;
      }
    }
    return clone;
  }

  private formatErrorDetails(error: any): string | Record<string, any> {
    const status = error?.response?.status;
    const statusText = error?.response?.statusText;
    let data = error?.response?.data ?? error?.message ?? error;

    const config = error?.config || {};
    const url = config?.url || config?.baseURL;
    const method = config?.method;

    const requestData = config?.data
      ? typeof config.data === 'string'
        ? config.data.slice(0, 500)
        : this.redact(config.data)
      : undefined;

    const responsePayload = (() => {
      if (typeof data === 'string') {
        const trimmed = data.trim();
        if (trimmed.startsWith('<!doctype html')) {
          return trimmed.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        }
        return trimmed.length > 1000 ? `${trimmed.slice(0, 1000)}...` : trimmed;
      }
      if (data && typeof data === 'object') return this.redact(data);
      return data;
    })();

    const result: any = {};
    if (status) result.status = status;
    if (statusText) result.statusText = statusText;
    if (method) result.method = method.toUpperCase ? method.toUpperCase() : method;
    if (url) result.url = url;
    if (requestData) result.request = requestData;
    if (responsePayload !== undefined) result.response = responsePayload;

    return Object.keys(result).length ? result : (error?.message || 'Unknown error');
  }

  async import(request: ImportRequest, jobId: string): Promise<void> {
    try {
      jobManager.startJob(jobId, 'Initializing import...');

      // Ensure temp directory exists
      await mkdir(this.tempDir, { recursive: true });

      const client = new DispatcharrClient(request.destination);

      // Authenticate
      jobManager.setProgress(jobId, 5, 'Authenticating...');
      await client.authenticate();

      // Ensure the special "Custom" M3UAccount exists (required by Dispatcharr for custom streams)
      try {
        const m3uAccounts = await client.get('/api/m3u/accounts/');
        jobManager.addLog(jobId, `Found ${m3uAccounts.length} M3U accounts`);

        const lockedAccounts = m3uAccounts.filter((acc: any) => acc.locked === true);
        if (lockedAccounts.length > 0) {
          jobManager.addLog(jobId, `Locked accounts: ${lockedAccounts.map((a: any) => a.name).join(', ')}`);
        }

        // Try multiple possible names for the custom account
        const customAccount = m3uAccounts.find((acc: any) =>
          acc.locked === true && (
            acc.name === 'Custom' ||
            acc.name === 'Custom Streams' ||
            acc.name === 'Manual' ||
            acc.name === 'Manual Streams' ||
            acc.name?.toLowerCase().includes('custom')
          )
        );

        if (!customAccount) {
          jobManager.addLog(jobId, 'Creating special "Custom" M3U account (required for custom streams)');
          await client.post('/api/m3u/accounts/', {
            name: 'Custom',
            url: 'http://localhost/custom.m3u',
            locked: true,
            enabled: false,
          });
          jobManager.addLog(jobId, 'Custom M3U account created successfully');
        } else {
          jobManager.addLog(jobId, `Custom M3U account already exists: ${customAccount.name}`);
        }
      } catch (error: any) {
        jobManager.addLog(jobId, `Warning: Could not ensure Custom M3U account exists: ${error.message}`);
      }

      // Decode and save uploaded file
      jobManager.setProgress(jobId, 10, 'Processing uploaded file...');
      const tempFilePath = path.join(this.tempDir, request.fileName);
      const fileBuffer = Buffer.isBuffer(request.fileData)
        ? request.fileData
        : Buffer.from(request.fileData, 'base64');
      await writeFile(tempFilePath, fileBuffer);

      // Extract if compressed
      let configFilePath = tempFilePath;
      let extractedDir: string | null = null;
      const ext = path.extname(request.fileName).toLowerCase();

      if (ext === '.zip') {
        const result = await this.extractZip(tempFilePath);
        configFilePath = result.configPath;
        extractedDir = result.baseDir;
      } else if (ext === '.gz' || ext === '.tgz') {
        const result = await this.extractTarGz(tempFilePath);
        configFilePath = result.configPath;
        extractedDir = result.baseDir;
      }

      // Read and parse config file
      jobManager.setProgress(jobId, 15, 'Reading configuration...');
      const configContent = await readFile(configFilePath, 'utf-8');

      const format = request.format || this.detectFormat(configFilePath);
      const configData = format === 'yaml' ? yaml.load(configContent) : JSON.parse(configContent);
      const data = (configData as any)?.data ?? {};

      // Log what sections are available in the backup file
      const availableSections = Object.keys(data).filter(key => data[key] != null);
      jobManager.addLog(jobId, `Backup file contains sections: ${availableSections.join(', ') || 'none'}`);

      // Log import options
      const enabledOptions = Object.keys(request.options).filter(k => (request.options as any)[k] === true);
      jobManager.addLog(jobId, `Import options enabled: ${enabledOptions.join(', ') || 'none'}`);

      if (availableSections.includes('epgData')) {
        const epgDataCount = Array.isArray(data.epgData) ? data.epgData.length : 'not an array';
        jobManager.addLog(jobId, `Backup file contains ${epgDataCount} EPG data entries`);
      } else {
        jobManager.addLog(jobId, 'WARNING: Backup file does NOT contain epgData section - export may have been created without EPG Sources enabled or before EPG data was downloaded');
      }

      // If logos were provided as images in the archive, fold them into config data
      if (!data.logos) {
        const logoFiles = await this.loadLogosFromFolder(path.dirname(configFilePath));
        if (logoFiles.length) {
          data.logos = logoFiles;
        }
      }

      const results: any = {
        imported: {},
        skipped: {},
        errors: {},
      };
      let streamProfileMap: Record<string | number, number> | undefined;
      let userAgentMap: Record<string | number, number> | undefined;
      let epgSourceMap: Record<string | number, number> | undefined;
      let channelGroupMap: Record<string | number, number> | undefined;

      let currentProgress = 20;
      const totalSteps = Math.max(this.countDataSections(data, request.options), 1);
      const progressPerStep = 75 / totalSteps;

      // Import M3U Sources
      if (data.m3uSources && this.isEnabled('m3uSources', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing M3U sources...');
        results.imported.m3uSources = await this.importM3USources(
          client,
          data.m3uSources,
          jobId
        );
        currentProgress += progressPerStep;
      }

      // Import EPG Sources
      if (data.epgSources && this.isEnabled('epgSources', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing EPG sources...');
        const epgSourcesResult = await this.importEPGSources(
          client,
          data.epgSources
        );
        results.imported.epgSources = epgSourcesResult;
        epgSourceMap = epgSourcesResult.idMap;
        currentProgress += progressPerStep;
      }

      // NOTE: EPG data from backup is NOT imported to the target system because:
      // 1. Dispatcharr's /api/epg/epgdata/ endpoint is read-only (405 Method Not Allowed)
      // 2. EPG data is automatically generated when EPG sources download and parse their feeds
      // 3. We only use EPG data from backup as reference metadata for channel matching (see setEpgForChannels below)
      if (data.epgData && Array.isArray(data.epgData) && data.epgData.length > 0) {
        jobManager.addLog(jobId, `Backup contains ${data.epgData.length} EPG data entries - will be used for channel matching only (not imported)`);
      }

      // Wait for EPG data to be downloaded from EPG sources
      // This is necessary so the target system has fresh EPG data for matching
      if (data.epgSources && this.isEnabled('epgSources', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Waiting for EPG data to be downloaded from sources...');
        await this.waitForEpgDataReady(client, jobId);
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

      // Import Channel Groups
      if (data.channelGroups && this.isEnabled('channelGroups', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing channel groups...');
        const channelGroupResult = await this.importChannelGroups(
          client,
          data.channelGroups
        );
        results.imported.channelGroups = channelGroupResult;
        channelGroupMap = channelGroupResult.idMap;
        jobManager.addLog(jobId, `Channel group ID mapping: ${JSON.stringify(channelGroupMap)}`);
        if ((channelGroupResult as any).groupDetails) {
          const details = (channelGroupResult as any).groupDetails.slice(0, 10);
          jobManager.addLog(jobId, `First 10 group mappings: ${JSON.stringify(details)}`);
        }
        currentProgress += progressPerStep;
      } else if (data.channelGroups && data.channels) {
        // Even if not importing channel groups (they already exist), we need to build the mapping
        // so that channels can be assigned to the correct groups
        jobManager.addLog(jobId, 'Building channel group ID mapping (groups not being imported but needed for channel assignment)...');
        channelGroupMap = {}; // Initialize the map
        const existingGroups = await client.get('/api/channels/groups/').catch(() => []);
        const groupByName: Record<string, number> = Array.isArray(existingGroups)
          ? Object.fromEntries(existingGroups.map((g: any) => [g.name, g.id]))
          : {};

        // Map backup group IDs to target group IDs by name
        for (const backupGroup of data.channelGroups) {
          if (backupGroup?.id != null && backupGroup?.name && groupByName[backupGroup.name]) {
            channelGroupMap[backupGroup.id] = groupByName[backupGroup.name];
          }
        }
        jobManager.addLog(jobId, `Channel group ID mapping (existing groups): ${JSON.stringify(channelGroupMap)}`);
      }

      // Stream profiles should be in place before channels
      if (data.streamProfiles && this.isEnabled('streamProfiles', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing stream profiles...');
        const streamProfileResult = await this.importStreamProfiles(
          client,
          data.streamProfiles,
          jobId
        );
        results.imported.streamProfiles = streamProfileResult;
        streamProfileMap = streamProfileResult.idMap;
        currentProgress += progressPerStep;
      } else if (data.streamProfiles && data.channels) {
        // Even if not importing stream profiles (they already exist), build the mapping for channel assignment
        jobManager.addLog(jobId, 'Building stream profile ID mapping (profiles not being imported but needed for channel assignment)...');
        streamProfileMap = {}; // Initialize the map
        const existingProfiles = await client.get('/api/core/streamprofiles/').catch(() => []);
        const profileByName: Record<string, number> = Array.isArray(existingProfiles)
          ? Object.fromEntries(existingProfiles.map((p: any) => [p.name, p.id]))
          : {};

        // Map backup profile IDs to target profile IDs by name
        for (const backupProfile of data.streamProfiles) {
          if (backupProfile?.id != null && backupProfile?.name && profileByName[backupProfile.name]) {
            streamProfileMap[backupProfile.id] = profileByName[backupProfile.name];
          }
        }
        jobManager.addLog(jobId, `Stream profile ID mapping (existing profiles): ${JSON.stringify(streamProfileMap)}`);
      }

      // Everything else follows the new prerequisites

      // Import Channels
      if (data.channels && this.isEnabled('channels', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing channels...');
        results.imported.channels = await this.importChannels(client, data.channels, jobId, {
          streamProfileMap,
          channelGroupMap,
        });
        currentProgress += progressPerStep;

        // Try direct EPG mapping (server-side match-epg disabled as it causes EPG refresh to hang)
        jobManager.setProgress(jobId, currentProgress, 'Assigning EPG data to channels...');
        await this.setEpgForChannels(client, jobId, data.channels, data.epgData);
        // Note: matchEpgForChannels removed - was causing Dispatcharr EPG refresh to hang
      }

      // Apply channel profile associations AFTER channels are imported
      jobManager.addLog(jobId, `Checking channel profile associations: channelProfiles=${!!data.channelProfiles}, channels=${!!data.channels}, channelProfiles enabled=${this.isEnabled('channelProfiles', request.options)}, channels enabled=${this.isEnabled('channels', request.options)}`);

      if (data.channelProfiles && data.channels &&
          this.isEnabled('channelProfiles', request.options) &&
          this.isEnabled('channels', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Applying channel profile associations...');
        await this.applyChannelProfileAssociations(client, data.channelProfiles, data.channels, jobId);
      } else {
        jobManager.addLog(jobId, `Skipping channel profile associations due to unmet conditions`);
      }

      // Import User Agents
      if (data.userAgents && this.isEnabled('userAgents', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing user agents...');
        const userAgentResult = await this.importUserAgents(
          client,
          data.userAgents,
          jobId
        );
        results.imported.userAgents = userAgentResult;
        userAgentMap = userAgentResult.idMap;
        currentProgress += progressPerStep;
      }

      if (data.coreSettings && this.isEnabled('coreSettings', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing core settings...');
        results.imported.coreSettings = await this.importCoreSettings(
          client,
          data.coreSettings,
          jobId,
          {
            streamProfileMap,
            userAgentMap,
          }
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
          data.comskipConfig,
          jobId
        );
        currentProgress += progressPerStep;
      }

      // Import Users
      if (data.users && this.isEnabled('users', request.options)) {
        jobManager.setProgress(jobId, currentProgress, 'Importing users...');
        results.imported.users = await this.importUsers(client, data.users, jobId);
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
        if (extractedDir) {
          await rm(extractedDir, { recursive: true, force: true } as any);
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

  private async findConfigFile(baseDir: string): Promise<string | undefined> {
    const entries = await fsp.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(baseDir, entry.name);
      if (entry.isDirectory()) {
        const found = await this.findConfigFile(fullPath);
        if (found) return found;
      } else if (entry.name.toLowerCase().match(/\.(ya?ml|json)$/)) {
        return fullPath;
      }
    }
    return undefined;
  }

  private async extractZip(zipPath: string): Promise<{ configPath: string; baseDir: string }> {
    const extractDir = path.join(this.tempDir, 'zip-' + Date.now());
    await mkdir(extractDir, { recursive: true });

    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    for (const entry of zipEntries) {
      const targetPath = path.join(extractDir, entry.entryName);
      if (entry.isDirectory) {
        await mkdir(targetPath, { recursive: true });
      } else {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, entry.getData());
      }
    }

    const configPath = await this.findConfigFile(extractDir);
    if (!configPath) {
      throw new Error('No configuration file found in archive');
    }

    return { configPath, baseDir: extractDir };
  }

  private async extractTarGz(tarPath: string): Promise<{ configPath: string; baseDir: string }> {
    const extractDir = path.join(this.tempDir, 'extract-' + Date.now());
    await mkdir(extractDir, { recursive: true });

    await tar.extract({
      file: tarPath,
      cwd: extractDir,
    });

    const configPath = await this.findConfigFile(extractDir);
    if (!configPath) {
      throw new Error('No configuration file found in archive');
    }

    return { configPath, baseDir: extractDir };
  }

  private async loadLogosFromFolder(baseDir: string): Promise<{ name: string; data: string }[]> {
    const logosDir = path.join(baseDir, 'logos');
    try {
      const files = await fsp.readdir(logosDir, { withFileTypes: true });
      const images = files.filter((f) =>
        f.isFile() && f.name.toLowerCase().match(/\.(png|jpe?g|webp)$/)
      );
      const logos: { name: string; data: string }[] = [];
      for (const img of images) {
        const fullPath = path.join(logosDir, img.name);
        const buffer = await readFile(fullPath);
        logos.push({ name: img.name.replace(/\.(png|jpe?g|webp)$/i, ''), data: buffer.toString('base64') });
      }
      return logos;
    } catch {
      return [];
    }
  }

  async inspect(request: ImportRequest): Promise<{ sections: string[]; uploadId?: string }> {
    // Reuse the import flow up to parsing so the UI can offer section toggles for archives
    let tempFilePath: string | null = null;
    let configFilePath: string | null = null;
    let extractedDir: string | null = null;

    try {
      await mkdir(this.tempDir, { recursive: true });
      await mkdir(this.cacheDir, { recursive: true });

      tempFilePath = path.join(this.tempDir, request.fileName);
      const fileBuffer = Buffer.isBuffer(request.fileData)
        ? request.fileData
        : Buffer.from(request.fileData, 'base64');
      await writeFile(tempFilePath, fileBuffer);

      const ext = path.extname(request.fileName).toLowerCase();
      if (ext === '.zip') {
        const result = await this.extractZip(tempFilePath);
        configFilePath = result.configPath;
        extractedDir = result.baseDir;
      } else if (ext === '.gz' || ext === '.tgz') {
        const result = await this.extractTarGz(tempFilePath);
        configFilePath = result.configPath;
        extractedDir = result.baseDir;
      } else {
        configFilePath = tempFilePath;
      }

      if (!configFilePath) {
        throw new Error('Could not locate configuration file');
      }

      const configContent = await readFile(configFilePath, 'utf-8');
      const format = request.format || this.detectFormat(configFilePath);
      const configData = format === 'yaml' ? yaml.load(configContent) : JSON.parse(configContent);
      const data = (configData as any)?.data ?? {};

      if (!data.logos) {
        const logoFiles = await this.loadLogosFromFolder(path.dirname(configFilePath));
        if (logoFiles.length) {
          data.logos = logoFiles;
        }
      }

      const sections = Object.keys(data).filter((key) => key in SECTION_OPTION_MAP);

      // Cache the uploaded file for reuse during import
      const uploadId = uuidv4();
      const cacheFile = path.join(this.cacheDir, `${uploadId}`);
      await writeFile(cacheFile, fileBuffer);
      await writeFile(`${cacheFile}.meta`, JSON.stringify({ fileName: request.fileName }));

      return { sections, uploadId }; // uploadId is used by the client to skip re-upload
    } finally {
      try {
        if (tempFilePath) await unlink(tempFilePath);
      } catch {}
      try {
        if (configFilePath && configFilePath !== tempFilePath) await unlink(configFilePath);
      } catch {}
      try {
        if (extractedDir) await rm(extractedDir, { recursive: true, force: true } as any);
      } catch {}
    }
  }

  async getCachedUpload(uploadId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const cacheFile = path.join(this.cacheDir, `${uploadId}`);
    const metaFile = `${cacheFile}.meta`;
    const [buffer, metaRaw] = await Promise.all([fsp.readFile(cacheFile), fsp.readFile(metaFile)]);
    const meta = JSON.parse(metaRaw.toString());
    return { buffer, fileName: meta.fileName || 'import.dat' };
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
  ): Promise<{ imported: number; skipped: number; errors: number; idMap: Record<string | number, number> }> {
    const existing = await client.get('/api/channels/groups/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const idMap: Record<string | number, number> = {};
    const groupDetails: Array<{ backupId: number; backupName: string; targetId: number }> = [];

    for (const group of groups) {
      try {
        const existingGroup = existing.find((g: any) => g.name === group.name);
        const groupData = { name: group.name };
        const sourceId = group?.id;

        let newId: number | undefined;
        if (existingGroup) {
          const resp = await client.put(`/api/channels/groups/${existingGroup.id}/`, groupData);
          newId = (resp as any)?.id ?? existingGroup.id;
        } else {
          const created = await client.post('/api/channels/groups/', groupData);
          newId = (created as any)?.id;
        }

        if (sourceId != null && newId != null) {
          idMap[sourceId] = newId;
          groupDetails.push({ backupId: sourceId, backupName: group.name, targetId: newId });
        }
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors, idMap, groupDetails } as any;
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

  private async applyChannelProfileAssociations(
    client: DispatcharrClient,
    profiles: any[],
    channels: any[],
    jobId: string
  ): Promise<void> {
    const destProfiles = await client.get('/api/channels/profiles/');
    const destChannels = await client.get('/api/channels/channels/').catch(() => ({ results: [] }));
    const destChannelsList = Array.isArray(destChannels) ? destChannels : destChannels.results || [];

    // Build a mapping from backup channel IDs to destination channel IDs
    const channelIdMap: Record<number, number> = {};
    for (const backupChannel of channels) {
      const destChannel = destChannelsList.find(
        (dc: any) => dc.name === backupChannel.name && dc.channel_number === backupChannel.channel_number
      );
      if (backupChannel.id && destChannel?.id) {
        channelIdMap[backupChannel.id] = destChannel.id;
      }
    }

    jobManager.addLog(jobId, `Built channel ID mapping: ${Object.keys(channelIdMap).length} channels mapped`);

    // For each profile, apply the channel associations
    for (const backupProfile of profiles) {
      jobManager.addLog(jobId, `Profile "${backupProfile.name}": has ${backupProfile.enabled_channels?.length || 0} enabled channels in backup`);

      if (!backupProfile.enabled_channels || !Array.isArray(backupProfile.enabled_channels)) {
        continue;
      }

      const destProfile = destProfiles.find((p: any) => p.name === backupProfile.name);
      if (!destProfile) {
        jobManager.addLog(jobId, `Profile "${backupProfile.name}" not found on destination, skipping associations`);
        continue;
      }

      // Map backup channel IDs to destination channel IDs
      const destChannelIds = backupProfile.enabled_channels
        .map((backupChannelId: number) => channelIdMap[backupChannelId])
        .filter((id: number | undefined) => id != null);

      jobManager.addLog(jobId, `Profile "${backupProfile.name}": mapped ${destChannelIds.length} channels (from ${backupProfile.enabled_channels.length} in backup)`);

      if (destChannelIds.length === 0) {
        jobManager.addLog(jobId, `Profile "${backupProfile.name}": no channels to enable after mapping`);
        continue;
      }

      try {
        // Log the payload being sent
        jobManager.addLog(
          jobId,
          `Profile "${backupProfile.name}": enabling ${destChannelIds.length} channels individually...`
        );

        // Enable each channel individually using the per-channel endpoint
        // /api/channels/profiles/{profile_id}/channels/{channel_id}/
        let successCount = 0;
        for (const channelId of destChannelIds) {
          try {
            await client.patch(`/api/channels/profiles/${destProfile.id}/channels/${channelId}/`, {
              enabled: true
            });
            successCount++;
          } catch (err: any) {
            jobManager.addLog(
              jobId,
              `Failed to enable channel ${channelId} in profile "${backupProfile.name}": ${err.message}`
            );
          }
        }

        jobManager.addLog(
          jobId,
          `Profile "${backupProfile.name}": successfully enabled ${successCount}/${destChannelIds.length} channels`
        );
      } catch (error: any) {
        const errorDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        jobManager.addLog(
          jobId,
          `Profile "${backupProfile.name}": failed to apply associations - ${errorDetails}`
        );
      }
    }
  }

  private async importChannels(
    client: DispatcharrClient,
    channels: any[],
    jobId: string,
    opts?: {
      streamProfileMap?: Record<string | number, number>;
      channelGroupMap?: Record<string | number, number>;
    }
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existingChannels = await client.get('/api/channels/channels/').catch(() => []);
    const existingGroups = await client.get('/api/channels/groups/').catch(() => []);
    const existingProfiles = await client.get('/api/channels/profiles/').catch(() => []);
    const existingM3UAccounts = await client.get('/api/m3u/accounts/').catch(() => []);

    // If backup channels reference streams but none are present yet (refresh lag), wait briefly
    const backupHasStreams = Array.isArray(channels)
      ? channels.some((c) => Array.isArray(c?.streams) && c.streams.length > 0)
      : false;
    let existingStreams = await this.getAllPaginated(client, '/api/channels/streams/').catch(() => []);
    if (backupHasStreams && (!Array.isArray(existingStreams) || existingStreams.length === 0)) {
      await this.waitForStreams(client, jobId);
      existingStreams = await this.getAllPaginated(client, '/api/channels/streams/').catch(() => []);
    }

    const existingList = Array.isArray(existingChannels)
      ? existingChannels
      : existingChannels?.results || [];
    const groupByName = Array.isArray(existingGroups)
      ? Object.fromEntries(existingGroups.map((g: any) => [g.name, g.id]))
      : {};
    const profileByName = Array.isArray(existingProfiles)
      ? Object.fromEntries(existingProfiles.map((p: any) => [p.name, p.id]))
      : {};
    const streamById: Record<number, number> = {};
    const streamByHash: Record<string, number> = {};
    const streamByTvgId: Record<string, number[]> = {};
    const streamByName: Record<string, number[]> = {};
    const streamByStation: Record<string, number[]> = {};
    const m3uById: Record<string | number, any> = {};
    const m3uByName: Record<string, any> = {};

    // Find the Custom M3U account ID for creating custom streams
    let customM3UAccountId: number | undefined;
    try {
      const customAccount = existingM3UAccounts.find((acc: any) =>
        acc.locked === true && (
          acc.name === 'Custom' ||
          acc.name === 'Custom Streams' ||
          acc.name === 'Manual' ||
          acc.name === 'Manual Streams' ||
          acc.name?.toLowerCase().includes('custom')
        )
      );
      if (customAccount?.id) {
        customM3UAccountId = customAccount.id;
      }
    } catch (err) {
      // Ignore, will try without it
    }
    const mapProfileId = (sid: any) => {
      const mapped =
        opts?.streamProfileMap?.[sid] ??
        opts?.streamProfileMap?.[String(sid)] ??
        opts?.streamProfileMap?.[Number(sid)];
      if (mapped != null) return mapped;
      // If we cannot map, omit to avoid invalid PKs
      return undefined;
    };

    const mapChannelGroupId = (gid: any) => {
      if (gid == null) return undefined;
      const mapped =
        opts?.channelGroupMap?.[gid] ??
        opts?.channelGroupMap?.[String(gid)] ??
        opts?.channelGroupMap?.[Number(gid)];
      if (mapped != null) return mapped;
      // If we cannot map, check if it exists in the current system
      if (groupByName && typeof gid === 'number') {
        // If gid exists in groupByName values, it's a valid ID
        const existsInCurrent = Object.values(groupByName).includes(gid);
        if (existsInCurrent) return gid;
      }
      // If we cannot map and it doesn't exist, omit to avoid invalid FKs
      return undefined;
    };

    const pushMatch = (map: Record<string, number[]>, key: string | undefined, id: number) => {
      if (!key) return;
      if (!map[key]) map[key] = [];
      if (!map[key].includes(id)) {
        map[key].push(id);
      }
    };

    if (Array.isArray(existingStreams)) {
      for (const stream of existingStreams) {
        if (stream?.id != null) {
          streamById[stream.id] = stream.id;
        }
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

    if (Array.isArray(existingM3UAccounts)) {
      for (const acct of existingM3UAccounts) {
        if (acct?.id != null) m3uById[acct.id] = acct;
        if (acct?.name) m3uByName[acct.name] = acct;
      }
    }

    const createdGroups: Record<string, number> = {};

    jobManager.addLog(
      jobId,
      `Channel import: found ${existingList.length} existing channels, ` +
      `${Object.keys(groupByName).length} groups, ${Object.keys(profileByName).length} profiles, ` +
      `${Array.isArray(existingStreams) ? existingStreams.length : 0} streams`
    );
    jobManager.addLog(
      jobId,
      `Stream lookup sizes -> byHash:${Object.keys(streamByHash).length} byTvg:${Object.keys(streamByTvgId).length} byName:${Object.keys(streamByName).length} byStation:${Object.keys(streamByStation).length}`
    );
    try {
      const sample = (Array.isArray(existingStreams) ? existingStreams.slice(0, 5) : []).map((s: any) => ({
        id: s?.id,
        name: s?.name,
        tvg_id: s?.tvg_id,
        hash: s?.stream_hash || s?.hash,
      }));
      jobManager.addLog(jobId, `Stream samples: ${JSON.stringify(sample)}`);
    } catch {
      // ignore sample log errors
    }

    const ensureGroup = async (name?: string): Promise<number | undefined> => {
      if (!name) return undefined;
      if (groupByName[name]) return groupByName[name];
      if (createdGroups[name]) return createdGroups[name];
      try {
        const created = await client.post('/api/channels/groups/', { name });
        if (created?.id != null) {
          groupByName[name] = created.id;
          createdGroups[name] = created.id;
          return created.id;
        }
      } catch (err) {
        this.logJobError(jobId, 'Channel group create failed', name, err);
      }
      return undefined;
    };

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    let unmatchedLogged = 0;
    const unmatchedLimit = 10;
    let channelGroupDebugLogged = false;

    // Log first channel fields for debugging
    if (channels.length > 0 && channels[0]) {
      const sampleFields = Object.keys(channels[0]).filter(k => !k.startsWith('_') && k !== 'streams');
      jobManager.addLog(jobId, `Sample channel fields from backup: ${sampleFields.join(', ')}`);
    }

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

        // Map channel group ID from backup to target using the channelGroupMap
        if (channel.channel_group_id != null) {
          const mappedGroupId = mapChannelGroupId(channel.channel_group_id);
          if (mappedGroupId != null) {
            channelData.channel_group_id = mappedGroupId;
          }
          // Debug logging for first few channels
          if (!channelGroupDebugLogged && imported < 5) {
            jobManager.addLog(jobId, `Channel "${channel.name}" group mapping: backup_id=${channel.channel_group_id} -> target_id=${mappedGroupId} (group_name="${channel.channel_group}")`);
          }
        }

        // Fallback: if no group ID was mapped and we have a group name, try to find/create by name
        if (channelData.channel_group_id == null && channel.channel_group) {
          if (groupByName[channel.channel_group]) {
            channelData.channel_group_id = groupByName[channel.channel_group];
          } else {
            const newGroupId = await ensureGroup(channel.channel_group);
            if (newGroupId) {
              channelData.channel_group_id = newGroupId;
            }
          }
          if (!channelGroupDebugLogged && imported < 5) {
            jobManager.addLog(jobId, `Channel "${channel.name}" group fallback: group_name="${channel.channel_group}" -> target_id=${channelData.channel_group_id}`);
          }
        }
        if (imported === 4) channelGroupDebugLogged = true;
        if (channel.tvg_id != null) channelData.tvg_id = channel.tvg_id;
        if (channel.tvc_guide_stationid != null) channelData.tvc_guide_stationid = channel.tvc_guide_stationid;
        // Do not carry over epg_data_id; IDs are instance-specific and will fail
        const mappedProfileId = mapProfileId(channel.stream_profile_id);
        if (mappedProfileId != null) {
          channelData.stream_profile_id = mappedProfileId;
          if (imported < 5) {
            jobManager.addLog(jobId, `Channel "${channel.name}" stream profile: backup_id=${channel.stream_profile_id} -> target_id=${mappedProfileId}`);
          }
        } else if (channel.stream_profile && profileByName[channel.stream_profile]) {
          channelData.stream_profile_id = profileByName[channel.stream_profile];
          if (imported < 5) {
            jobManager.addLog(jobId, `Channel "${channel.name}" stream profile: by_name="${channel.stream_profile}" -> target_id=${profileByName[channel.stream_profile]}`);
          }
        } else if (imported < 5) {
          jobManager.addLog(jobId, `Channel "${channel.name}" stream profile: backup_id=${channel.stream_profile_id} not mapped (profileMap has ${Object.keys(opts?.streamProfileMap || {}).length} entries)`);
        }

        // Attempt to map streams by tvg_id / station / name / stream_hash onto newly refreshed streams
        const matchedStreams = new Set<number>();
        let matchedByHash = 0;
        let matchedByTvg = 0;
        let matchedByStation = 0;
        let matchedByName = 0;

        const addStreams = (ids?: number[]) => {
          ids?.forEach((id) => matchedStreams.add(id));
        };

        const tvgKey = this.normalizeKey(channel?.tvg_id);
        if (tvgKey && streamByTvgId[tvgKey]) {
          addStreams(streamByTvgId[tvgKey]);
          matchedByTvg += streamByTvgId[tvgKey].length;
        }

        const stationKey = this.normalizeKey(channel?.tvc_guide_stationid);
        if (stationKey && streamByStation[stationKey]) {
          addStreams(streamByStation[stationKey]);
          matchedByStation += streamByStation[stationKey].length;
        }

        // Try multiple name variants (full name and suffix after delimiter)
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
            matchedByName += streamByName[nk].length;
          }
        }

        if (Array.isArray(channel.streams)) {
          for (const s of channel.streams) {
            if (typeof s === 'number' && streamById[s]) {
              matchedStreams.add(streamById[s]);
              continue;
            }
            if (s && typeof s === 'object') {
              const obj: any = s;
              if (obj.id != null && streamById[obj.id]) matchedStreams.add(streamById[obj.id]);
              const hashKey = this.normalizeKey(obj.stream_hash || obj.hash);
              if (hashKey && streamByHash[hashKey]) {
                matchedStreams.add(streamByHash[hashKey]);
                matchedByHash++;
              }
              const stvgKey = this.normalizeKey(obj.tvg_id || obj.tvgId);
              if (stvgKey && streamByTvgId[stvgKey]) addStreams(streamByTvgId[stvgKey]);
              const snameKey = this.normalizeKey(obj.name);
              if (snameKey && streamByName[snameKey]) addStreams(streamByName[snameKey]);
            }
          }
        }

        // If no matches, try creating custom streams from provided metadata (useful for hand-made channels)
        if (matchedStreams.size === 0 && Array.isArray(channel.streams)) {
          const creatable = channel.streams.filter(
            (s: any) =>
              s &&
              typeof s === 'object' &&
              (s.url || s.name || s.tvg_id || s.tvgId)
          );
          for (const s of creatable) {
            try {
              const basePayload: any = {
                name: s.name || channel.name,
                url: s.url,
                tvg_id: s.tvg_id || s.tvgId,
                stream_profile_id: mapProfileId(s.stream_profile_id ?? channelData.stream_profile_id),
                // Don't set is_custom - let Dispatcharr infer it from m3u_account being null
              };
              if (s.stream_hash || s.hash) basePayload.stream_hash = s.stream_hash || s.hash;
              if (s.m3u_account) {
                const mapped =
                  m3uById[s.m3u_account] ||
                  m3uById[String(s.m3u_account)] ||
                  (typeof s.m3u_account === 'string' ? m3uByName[s.m3u_account] : undefined);
                if (mapped?.id) basePayload.m3u_account = mapped.id;
              } else if (customM3UAccountId) {
                // For custom streams without an m3u_account, use the Custom Streams account ID
                basePayload.m3u_account = customM3UAccountId;
              }
              // Map channel_group ID from backup to destination system
              const mappedGroupId = mapChannelGroupId(s.channel_group ?? channelData.channel_group_id);
              if (mappedGroupId != null) {
                basePayload.channel_group = mappedGroupId;
              }
              if (s.tvc_guide_stationid) basePayload.tvc_guide_stationid = s.tvc_guide_stationid;

              // Try create with full payload, then with minimal fields if it fails
              // Only include fields that have values - omit nulls to avoid triggering Django signals
              const minimalPayload: any = {
                name: basePayload.name,
                url: basePayload.url,
              };
              // Add Custom M3U account ID for custom streams
              if (customM3UAccountId) {
                minimalPayload.m3u_account = customM3UAccountId;
              }
              const minimalProfile = mapProfileId(basePayload.stream_profile_id);
              if (minimalProfile != null) minimalPayload.stream_profile_id = minimalProfile;
              // Also map channel_group for minimal payload
              if (mappedGroupId != null) {
                minimalPayload.channel_group = mappedGroupId;
              }
              if (basePayload.tvg_id) minimalPayload.tvg_id = basePayload.tvg_id;

              let created: any;
              try {
                created = await client.post('/api/channels/streams/', basePayload);
              } catch (err) {
                // Retry without hash/m3u_account if server rejects
                try {
                  created = await client.post('/api/channels/streams/', minimalPayload);
                } catch (err2) {
                  throw err2;
                }
              }

              const newId = (created as any)?.id;
              if (newId != null) {
                matchedStreams.add(newId);
                matchedByName++; // created via name/url
              }
            } catch (err) {
              this.logJobError(jobId, 'Custom stream create failed', s?.name || channel?.name, err);
            }
          }
        }

        if (matchedStreams.size > 0) {
          channelData.streams = Array.from(matchedStreams);
        } else if (unmatchedLogged < unmatchedLimit) {
          jobManager.addLog(
            jobId,
            `Channel "${channel?.name}"#${channel?.channel_number ?? ''} has no stream matches ` +
            `(tvg_id=${channel?.tvg_id}, station=${channel?.tvc_guide_stationid}, ` +
            `streams in backup=${Array.isArray(channel?.streams) ? channel.streams.length : 0}, ` +
            `tvgMatches=${matchedByTvg}, stationMatches=${matchedByStation}, ` +
            `nameMatches=${matchedByName}, hashMatches=${matchedByHash})`
          );
          const details =
            Array.isArray(channel?.streams)
              ? channel.streams.slice(0, 3).map((s: any) => {
                  const hashKey = this.normalizeKey(s?.stream_hash || s?.hash);
                  const stvgKey = this.normalizeKey(s?.tvg_id || s?.tvgId);
                  const snameKey = this.normalizeKey(s?.name);
                  return {
                    id: s?.id,
                    name: s?.name,
                    tvg: s?.tvg_id || s?.tvgId,
                    hash: s?.stream_hash || s?.hash,
                    hashHit: hashKey && streamByHash[hashKey] ? true : false,
                    tvgHit: stvgKey && streamByTvgId[stvgKey] ? true : false,
                    nameHit: snameKey && streamByName[snameKey] ? true : false,
                  };
                })
              : [];
          jobManager.addLog(jobId, `  Backup stream samples: ${JSON.stringify(details)}`);
          unmatchedLogged++;
        }

        // Debug: log first few channel payloads
        if (!channelGroupDebugLogged && imported < 5) {
          jobManager.addLog(jobId, `Channel "${channel.name}" final payload channel_group_id: ${channelData.channel_group_id}`);
        }

        if (existingChannel) {
          await client.put(`/api/channels/channels/${existingChannel.id}/`, channelData);
        } else {
          await client.post('/api/channels/channels/', channelData);
        }
        imported++;
      } catch (error) {
        this.logJobError(jobId, 'Channel import failed', channel?.name, error);
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importM3USources(
    client: DispatcharrClient,
    sources: any[],
    jobId: string
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/m3u/accounts/').catch(() => []);
    const existingGroups = await client.get('/api/channels/groups/').catch(() => []);
    const groupByName: Record<string, number> = Array.isArray(existingGroups)
      ? Object.fromEntries(existingGroups.map((g: any) => [g.name, g.id]))
      : {};
    const groupByXcId: Record<string, number> = Array.isArray(existingGroups)
      ? existingGroups.reduce((acc: any, g: any) => {
        const xc = g?.custom_properties?.xc_id;
        if (xc != null) acc[String(xc)] = g.id;
        return acc;
      }, {})
      : {};
    const createdGroups: Record<string, number> = {};

    const ensureGroup = async (name?: string): Promise<number | undefined> => {
      if (!name) return undefined;
      if (groupByName[name]) return groupByName[name];
      if (createdGroups[name]) return createdGroups[name];
      try {
        const created = await client.post('/api/channels/groups/', { name });
        if (created?.id != null) {
          groupByName[name] = created.id;
          createdGroups[name] = created.id;
          return created.id;
        }
      } catch (err) {
        this.logJobError(jobId, 'M3U group create failed', name, err);
      }
      return undefined;
    };

    const waitForM3UReady = async (accountId: any) => {
      const maxAttempts = 40;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const acct = await client.get(`/api/m3u/accounts/${accountId}/`);
          const status = acct?.status || acct?.data?.status;
          const message = acct?.last_message || acct?.message || acct?.data?.last_message;
          const readyMessage = typeof message === 'string' && message.toLowerCase().includes('m3u groups loaded');
          const busy = status && ['fetching', 'parsing'].includes(String(status));
          if (readyMessage || (!busy && status !== 'pending_setup')) {
            return { status, message };
          }
        } catch {
          // ignore and retry
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
      return undefined;
    };

    // Wait for streams to be loaded for an M3U account
    const waitForStreamsLoaded = async (accountId: any, accountName: string, refreshFailed: boolean = false) => {
      const maxAttempts = 15; // Up to 30 seconds
      let lastStreamCount = 0;
      let stableCount = 0;
      let pendingSetupCount = 0;

      for (let i = 0; i < maxAttempts; i++) {
        try {
          // Check account status
          const acct = await client.get(`/api/m3u/accounts/${accountId}/`);
          const status = acct?.status;
          const message = acct?.last_message || '';

          // Get stream count for this M3U account
          const streams = await this.getAllPaginated(client, `/api/channels/streams/?m3u_account=${accountId}`).catch(() => []);
          const streamCount = Array.isArray(streams) ? streams.length : 0;

          // Only log every 3rd poll to reduce noise
          if (i % 3 === 0 || streamCount > 0) {
            jobManager.addLog(jobId, `M3U ${accountName}: Polling... status=${status}, streams=${streamCount}`);
          }

          // If status is pending_setup and refresh failed, don't wait forever
          if (status === 'pending_setup' && refreshFailed) {
            pendingSetupCount++;
            if (pendingSetupCount >= 5) {
              jobManager.addLog(jobId, `M3U ${accountName}: Still pending_setup after refresh failed, skipping stream wait`);
              return streamCount;
            }
          }

          // Check if stream count is stable
          if (streamCount > 0 && streamCount === lastStreamCount) {
            stableCount++;
            if (stableCount >= 2) {
              jobManager.addLog(jobId, `M3U ${accountName}: Streams stable at ${streamCount}`);
              return streamCount;
            }
          } else {
            stableCount = 0;
          }
          lastStreamCount = streamCount;

          // If status indicates completion and we have some streams, we're done
          if (status === 'ready' && streamCount > 0) {
            jobManager.addLog(jobId, `M3U ${accountName}: Ready with ${streamCount} streams`);
            return streamCount;
          }
        } catch (err) {
          // ignore and retry
        }
        await new Promise((res) => setTimeout(res, 2000));
      }

      jobManager.addLog(jobId, `M3U ${accountName}: Timeout waiting for streams (got ${lastStreamCount})`);
      return lastStreamCount;
    };
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const source of sources) {
      try {
        // M3U sources are exposed under /api/m3u/accounts/
        const payload: any = {};
        const allowed = [
          'name',
          'server_url',
          'file_path',
          'max_streams',
          'is_active',
          'user_agent',
          'refresh_interval',
          'account_type',
          'username',
          'password',
          'stale_stream_days',
          'priority',
          'custom_properties',
          'enable_vod',
          'auto_enable_new_groups_live',
          'auto_enable_new_groups_vod',
          'auto_enable_new_groups_series',
        ];
        for (const key of allowed) {
          if (source[key] !== undefined) payload[key] = source[key];
        }

        // Log VOD settings for debugging
        jobManager.addLog(jobId, `M3U ${source.name}: VOD settings in backup - enable_vod=${source.enable_vod}, auto_enable_new_groups_vod=${source.auto_enable_new_groups_vod}, auto_enable_new_groups_series=${source.auto_enable_new_groups_series}, auto_enable_new_groups_live=${source.auto_enable_new_groups_live}`);
        jobManager.addLog(jobId, `M3U ${source.name}: VOD settings in payload - enable_vod=${payload.enable_vod}, auto_enable_new_groups_vod=${payload.auto_enable_new_groups_vod}, auto_enable_new_groups_series=${payload.auto_enable_new_groups_series}, auto_enable_new_groups_live=${payload.auto_enable_new_groups_live}`);

        // Basic validation: need either server_url or file_path
        if (!payload.server_url && !payload.file_path) {
          this.logJobError(jobId, 'M3U import failed', source?.name || source?.id || 'unknown', {
            message: 'Missing server_url and file_path; skipping M3U creation.',
          });
          skipped++;
          continue;
        }

        // Normalize channel_groups separately; do not send with main payload
        let channelGroupsPayload: any[] | undefined;
        if (Array.isArray(source.channel_groups)) {
          channelGroupsPayload = [];
          for (const cg of source.channel_groups) {
            const raw = cg?.channel_group ?? cg;
            const nameCandidate = cg?.name
              || cg?.channel_group_name
              || raw?.name
              || raw?.channel_group_name;
            const idCandidate = Array.isArray(raw) ? raw[0] : raw?.id ?? raw;
            const xcId = cg?.custom_properties?.xc_id ?? cg?.xc_id ?? raw?.custom_properties?.xc_id;
            let groupId: number | undefined;

            if (nameCandidate && (groupByName[nameCandidate] || createdGroups[nameCandidate])) {
              groupId = groupByName[nameCandidate] || createdGroups[nameCandidate];
            } else if (nameCandidate) {
              groupId = await ensureGroup(nameCandidate);
            } else if (xcId != null && groupByXcId[String(xcId)]) {
              groupId = groupByXcId[String(xcId)];
            } else if (idCandidate != null) {
              groupId = idCandidate;
            }

            if (groupId == null) {
              const fallbackName = nameCandidate || (xcId != null ? `XC ${xcId}` : (idCandidate != null ? `Group ${idCandidate}` : undefined));
              if (fallbackName) {
                groupId = await ensureGroup(fallbackName);
              }
            }

            if (groupId == null) {
              skipped++;
              this.logJobError(jobId, 'M3U group map failed', nameCandidate || xcId || idCandidate || 'unknown', {
                message: 'Could not map or create channel group for M3U entry',
              });
              continue;
            }

            const entry: any = { channel_group: groupId };
            entry.enabled = cg?.enabled !== false; // Default to true if not explicitly false
            if (cg?.auto_channel_sync !== undefined) entry.auto_channel_sync = cg.auto_channel_sync;
            if (cg?.auto_sync_channel_start !== undefined)
              entry.auto_sync_channel_start = cg.auto_sync_channel_start;
            if (cg?.custom_properties !== undefined) entry.custom_properties = cg.custom_properties;
            if (cg?.stream_profile_id !== undefined) entry.stream_profile_id = cg.stream_profile_id;
            if (cg?.group_override !== undefined) entry.group_override = cg.group_override;
            if (cg?.channel_sort_order !== undefined) entry.channel_sort_order = cg.channel_sort_order;
            if (cg?.channel_sort_reverse !== undefined) entry.channel_sort_reverse = cg.channel_sort_reverse;
            if (cg?.channel_profile_ids !== undefined) entry.channel_profile_ids = cg.channel_profile_ids;

            // Store the group name for logging
            entry._groupName = nameCandidate;

            channelGroupsPayload.push(entry);
          }
        }

        const match = existing?.find((s: any) => s.name === source.name);
        let accountId: any = match?.id;
        let apiResponse: any;
        if (match?.id) {
          apiResponse = await client.put(`/api/m3u/accounts/${accountId}/`, payload);
          jobManager.addLog(jobId, `M3U ${source.name}: API response after PUT - enable_vod=${apiResponse.enable_vod}, auto_enable_new_groups_vod=${apiResponse.auto_enable_new_groups_vod}, auto_enable_new_groups_series=${apiResponse.auto_enable_new_groups_series}, auto_enable_new_groups_live=${apiResponse.auto_enable_new_groups_live}`);
        } else {
          apiResponse = await client.post('/api/m3u/accounts/', payload);
          accountId = apiResponse?.id ?? apiResponse;
          jobManager.addLog(jobId, `M3U ${source.name}: API response after POST - enable_vod=${apiResponse.enable_vod}, auto_enable_new_groups_vod=${apiResponse.auto_enable_new_groups_vod}, auto_enable_new_groups_series=${apiResponse.auto_enable_new_groups_series}, auto_enable_new_groups_live=${apiResponse.auto_enable_new_groups_live}`);
        }

        // Trigger refresh for this account to pull streams/channels
        if (accountId) {
          // Try the refresh API first
          const refreshResult = await client.post(`/api/m3u/refresh/${accountId}/`).catch(() => {
            jobManager.addLog(jobId, `M3U ${source.name}: Refresh API failed (known Dispatcharr bug), will rely on auto-processing`);
            return null;
          });

          if (refreshResult) {
            jobManager.addLog(jobId, `M3U ${source.name}: Refresh API succeeded`);
          } else {
            // Try toggling is_active as a workaround to trigger processing
            jobManager.addLog(jobId, `M3U ${source.name}: Trying is_active toggle to trigger processing...`);
            await client.patch(`/api/m3u/accounts/${accountId}/`, { is_active: false }).catch(() => null);
            await new Promise((res) => { const t = globalThis.setTimeout(res, 500); return t; });
            await client.patch(`/api/m3u/accounts/${accountId}/`, { is_active: true }).catch(() => null);
          }

          // Wait for refresh to complete before applying group settings
          await waitForM3UReady(accountId);

          // Apply group settings after refresh to align with downstream expectations
          if (channelGroupsPayload && channelGroupsPayload.length > 0) {
            // Get the current account to see what groups were discovered
            const currentAccount = await client.get(`/api/m3u/accounts/${accountId}/`);
            const discoveredGroups = currentAccount?.channel_groups || [];

            // Fetch all channel groups to get ID -> name mapping
            // The M3U account's channel_groups only has IDs, not names
            const allChannelGroups = await client.get('/api/channels/groups/').catch(() => []);
            const groupIdToName: Record<number, string> = {};
            if (Array.isArray(allChannelGroups)) {
              for (const g of allChannelGroups) {
                if (g?.id != null && g?.name) {
                  groupIdToName[g.id] = g.name;
                }
              }
            }
            jobManager.addLog(jobId, `M3U ${source?.name}: Built group ID->name mapping with ${Object.keys(groupIdToName).length} entries`);

            // Create maps for matching by name (IDs differ between backup and target)
            const backupGroupsByName: Record<string, any> = {};
            for (const cg of channelGroupsPayload) {
              const name = cg._groupName?.toLowerCase();
              if (name) backupGroupsByName[name] = cg;
            }
            const enabledGroupNames = new Set(
              channelGroupsPayload
                .filter(cg => cg.enabled !== false)
                .map(cg => cg._groupName?.toLowerCase())
                .filter(Boolean)
            );

            // Build complete payload with all discovered groups, setting enabled/disabled based on backup
            jobManager.addLog(jobId, `M3U ${source?.name}: Discovered ${discoveredGroups.length} groups after refresh, have ${channelGroupsPayload.length} groups from backup`);

            const completePayload = discoveredGroups.map((dg: any) => {
              // Look up the actual group name from the channel groups endpoint
              const groupId = dg.channel_group;
              const actualGroupName = groupIdToName[groupId] || dg.name || dg.channel_group_name || '';
              const discoveredName = actualGroupName.toLowerCase();
              const backupGroup = backupGroupsByName[discoveredName];
              const shouldBeEnabled = enabledGroupNames.has(discoveredName);

              // Get group name for logging
              const backupName = backupGroup?._groupName || '';
              const groupName = backupName || actualGroupName || `Group ${groupId}`;

              if (backupGroup) {
                jobManager.addLog(jobId, `M3U ${source?.name}: Group "${groupName}" (ID: ${dg.channel_group}, backup name: "${backupName}", discovered name: "${discoveredName}") - backup says enabled=${backupGroup.enabled}, applying enabled=${shouldBeEnabled}`);
              } else {
                jobManager.addLog(jobId, `M3U ${source?.name}: Group "${groupName}" (ID: ${dg.channel_group}) - NOT in backup, defaulting to enabled=false`);
              }

              return {
                ...dg,
                enabled: shouldBeEnabled,
                // Preserve other settings from backup if available
                ...(backupGroup?.auto_channel_sync !== undefined && { auto_channel_sync: backupGroup.auto_channel_sync }),
                ...(backupGroup?.auto_sync_channel_start !== undefined && { auto_sync_channel_start: backupGroup.auto_sync_channel_start }),
                ...(backupGroup?.custom_properties !== undefined && { custom_properties: backupGroup.custom_properties }),
                ...(backupGroup?.stream_profile_id !== undefined && { stream_profile_id: backupGroup.stream_profile_id }),
                ...(backupGroup?.group_override !== undefined && { group_override: backupGroup.group_override }),
                ...(backupGroup?.channel_sort_order !== undefined && { channel_sort_order: backupGroup.channel_sort_order }),
                ...(backupGroup?.channel_sort_reverse !== undefined && { channel_sort_reverse: backupGroup.channel_sort_reverse }),
                ...(backupGroup?.channel_profile_ids !== undefined && { channel_profile_ids: backupGroup.channel_profile_ids }),
              };
            });

            const enabledCount = completePayload.filter(cg => cg.enabled).length;
            const disabledCount = completePayload.filter(cg => !cg.enabled).length;
            jobManager.addLog(jobId, `M3U ${source?.name}: Applying ${enabledCount} enabled and ${disabledCount} disabled channel groups via PATCH`);

            // Update with complete payload including enabled/disabled flags
            const patchResponse = await client.patch(`/api/m3u/accounts/${accountId}/`, {
              channel_groups: completePayload,
            });

            // Log the response to verify it was accepted
            const responseGroups = patchResponse?.channel_groups || [];
            const responseEnabledCount = responseGroups.filter((cg: any) => cg.enabled).length;
            jobManager.addLog(jobId, `M3U ${source?.name}: API response shows ${responseEnabledCount} enabled groups out of ${responseGroups.length} total`);

            // Wait for Dispatcharr to process the group changes before triggering refresh
            jobManager.addLog(jobId, `M3U ${source?.name}: Waiting 3 seconds for group changes to be processed...`);
            await new Promise((resolve) => globalThis.setTimeout(resolve, 3000));

            // Trigger refresh to pull streams for enabled groups
            jobManager.addLog(jobId, `M3U ${source?.name}: Triggering stream refresh for enabled groups`);
            let refreshResult = await client.post(`/api/m3u/refresh/${accountId}/`).catch((err) => {
              jobManager.addLog(jobId, `M3U ${source?.name}: Account refresh API error: ${err?.response?.data || err?.message || err}`);
              return null;
            });

            // If account-specific refresh fails, try global refresh
            if (!refreshResult) {
              jobManager.addLog(jobId, `M3U ${source?.name}: Trying global M3U refresh...`);
              refreshResult = await client.post(`/api/m3u/refresh/`).catch((err) => {
                jobManager.addLog(jobId, `M3U ${source?.name}: Global refresh error: ${err?.response?.data || err?.message || err}`);
                return null;
              });
            }

            if (refreshResult) {
              jobManager.addLog(jobId, `M3U ${source?.name}: Refresh initiated successfully, waiting for streams to load...`);
            } else {
              jobManager.addLog(jobId, `M3U ${source?.name}: Refresh returned no result, waiting for streams anyway...`);
            }

            // Wait for streams to actually be loaded (polls stream count)
            const streamCount = await waitForStreamsLoaded(accountId, source?.name || 'Unknown', !refreshResult);
            jobManager.addLog(jobId, `M3U ${source?.name}: Found ${streamCount} streams after waiting`);

            // Re-apply the PATCH after refresh, in case the refresh reset enabled/disabled states
            if (streamCount > 0) {
              jobManager.addLog(jobId, `M3U ${source?.name}: Re-applying group settings after refresh`);
              await client.patch(`/api/m3u/accounts/${accountId}/`, {
                channel_groups: completePayload,
              });
            }
          }
        }
        imported++;
      } catch (error) {
        this.logJobError(jobId, 'M3U import failed', source?.name || source?.id, error);
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importStreamProfiles(
    client: DispatcharrClient,
    profiles: any[],
    jobId: string
  ): Promise<{ imported: number; skipped: number; errors: number; idMap: Record<string | number, number> }> {
    const existing = await client.get('/api/core/streamprofiles/').catch(() => []);
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const idMap: Record<string | number, number> = {};

    for (const profile of profiles) {
      try {
        // Stream profiles endpoint lives under /api/core/streamprofiles/
        const match = existing?.find((p: any) => p.name === profile.name);
        const sourceId = profile?.id;
        const payload = { ...profile };
        delete (payload as any).id;

        if (match?.id) {
          const resp = await client.put(`/api/core/streamprofiles/${match.id}/`, payload);
          const newId = (resp as any)?.id ?? match.id;
          if (sourceId != null && newId != null) idMap[sourceId] = newId;
        } else {
          const created = await client.post('/api/core/streamprofiles/', payload);
          const newId = (created as any)?.id;
          if (sourceId != null && newId != null) idMap[sourceId] = newId;
        }
        imported++;
      } catch (error) {
        this.logJobError(jobId, 'Stream profile import failed', profile?.name, error);
        errors++;
      }
    }

    return { imported, skipped, errors, idMap };
  }

  private async importUserAgents(
    client: DispatcharrClient,
    agents: any[],
    jobId: string
  ): Promise<{ imported: number; skipped: number; errors: number; idMap: Record<string | number, number> }> {
    const existing = await client.get('/api/core/useragents/').catch(() => []);
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const idMap: Record<string | number, number> = {};

    for (const agent of agents) {
      try {
        // User agents endpoint lives under /api/core/useragents/
        const match = existing?.find((a: any) => a.name === agent.name);
        const sourceId = agent?.id;
        const payload = { ...agent };
        delete (payload as any).id;

        if (match?.id) {
          const resp = await client.put(`/api/core/useragents/${match.id}/`, payload);
          const newId = (resp as any)?.id ?? match.id;
          if (sourceId != null && newId != null) idMap[sourceId] = newId;
        } else {
          const created = await client.post('/api/core/useragents/', payload);
          const newId = (created as any)?.id;
          if (sourceId != null && newId != null) idMap[sourceId] = newId;
        }
        imported++;
      } catch (error) {
        this.logJobError(jobId, 'User agent import failed', agent?.name, error);
        errors++;
      }
    }

    return { imported, skipped, errors, idMap };
  }

  private async importEPGSources(
    client: DispatcharrClient,
    sources: any[]
  ): Promise<{ imported: number; skipped: number; errors: number; idMap: Record<string | number, number> }> {
    const existing = await client.get('/api/epg/sources/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const idMap: Record<string | number, number> = {};

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
          const resp = await client.put(`/api/epg/sources/${match.id}/`, payload);
          const newId = (resp as any)?.id ?? match.id;
          if (source?.id != null && newId != null) idMap[source.id] = newId;
        } else {
          const created = await client.post('/api/epg/sources/', payload);
          const newId = (created as any)?.id;
          if (source?.id != null && newId != null) idMap[source.id] = newId;
        }
        imported++;
      } catch (error) {
        errors++;
      }
    }

    return { imported, skipped, errors, idMap };
  }

  private async importEPGData(
    client: DispatcharrClient,
    epgData: any[],
    jobId: string,
    opts?: { epgSourceMap?: Record<string | number, number> }
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await this.getAllPaginated(client, '/api/epg/epgdata/').catch(() => []);
    const byTvg: Record<string, any> = {};
    const byName: Record<string, any> = {};

    const normalize = (v: any) => (typeof v === 'string' ? v.trim().toLowerCase() : undefined);

    for (const e of Array.isArray(existing) ? existing : []) {
      const t = normalize(e?.tvg_id);
      const n = normalize(e?.name);
      if (t && !byTvg[t]) byTvg[t] = e;
      if (n && !byName[n]) byName[n] = e;
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const e of Array.isArray(epgData) ? epgData : []) {
      try {
        if (!e || typeof e !== 'object') {
          skipped++;
          continue;
        }

        const t = normalize(e.tvg_id);
        const n = normalize(e.name);

        const payload: any = {
          name: e.name,
        };
        if (e.tvg_id !== undefined) payload.tvg_id = e.tvg_id;
        if (e.icon_url !== undefined) payload.icon_url = e.icon_url;
        if (e.epg_source !== undefined) {
          const mapped =
            opts?.epgSourceMap?.[e.epg_source] ??
            opts?.epgSourceMap?.[String(e.epg_source)] ??
            opts?.epgSourceMap?.[Number(e.epg_source)];
          payload.epg_source = mapped ?? e.epg_source;
        }

        const match = (t && byTvg[t]) || (n && byName[n]);
        if (match?.id) {
          await client.put(`/api/epg/epgdata/${match.id}/`, payload);
        } else {
          const created = await client.post('/api/epg/epgdata/', payload);
          const newId = (created as any)?.id;
          if (newId != null && t && !byTvg[t]) byTvg[t] = { ...payload, id: newId };
          if (newId != null && n && !byName[n]) byName[n] = { ...payload, id: newId };
        }
        imported++;
      } catch (error) {
        this.logJobError(jobId, 'EPG data import failed', e?.tvg_id || e?.name, error);
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importPlugins(
    client: DispatcharrClient,
    plugins: any
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existingResponse = await client.get('/api/plugins/plugins/');
    const existingList = Array.isArray(existingResponse)
      ? existingResponse
      : (existingResponse?.plugins ?? []);

    const pluginList: any[] = Array.isArray(plugins)
      ? plugins
      : (plugins?.plugins ? plugins.plugins : Object.values(plugins || {}));

    if (!Array.isArray(pluginList) || pluginList.length === 0) {
      return { imported: 0, skipped: 1, errors: 0 };
    }

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const plugin of pluginList) {
      try {
        if (!plugin.key || !plugin.settings) {
          skipped++;
          continue;
        }

        const existingPlugin = existingList.find((p: any) => p.key === plugin.key);
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
    users: any[],
    jobId: string
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const existing = await client.get('/api/accounts/users/');
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      try {
        const existingUser = existing.find((u: any) => u.username === user.username);
        const isAdmin = user.user_level === 'admin' || user.is_superuser === true || existingUser?.is_superuser === true;

        // For admin users that already exist, only update XC password (in custom_properties)
        if (isAdmin && existingUser) {
          if (user.custom_properties) {
            jobManager.addLog(jobId, `User ${user.username}: Admin user - only updating custom_properties (XC password)`);
            await client.patch(`/api/accounts/users/${existingUser.id}/`, {
              custom_properties: user.custom_properties,
            });
            imported++;
          } else {
            jobManager.addLog(jobId, `User ${user.username}: Admin user - skipping (no custom_properties to restore)`);
            skipped++;
          }
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

        // Always supply a password (required on create and some updates)
        userData.password = user.password || `TempPass-${user.username || 'User'}`;

        if (existingUser) {
          await client.put(`/api/accounts/users/${existingUser.id}/`, userData);
        } else {
          await client.post('/api/accounts/users/', userData);
        }
        imported++;
      } catch (error) {
        this.logJobError(jobId, 'User import failed', user?.username, error);
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async importCoreSettings(
    client: DispatcharrClient,
    settings: any,
    jobId: string,
    maps?: {
      streamProfileMap?: Record<string | number, number>;
      userAgentMap?: Record<string | number, number>;
    }
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    try {
      const items = (Array.isArray(settings) ? settings : [settings]).filter(
        (s) => s && typeof s === 'object'
      );

      if (!items.length) {
        return { imported: 0, skipped: 1, errors: 0 };
      }

      const existingResp = await client.get('/api/core/settings/').catch(() => []);
      const existingList = Array.isArray(existingResp)
        ? existingResp
        : existingResp
          ? [existingResp]
          : [];
      const existingByKey = new Map<string, any>(
        existingList
          .filter((s: any) => s?.key)
          .map((s: any) => [s.key, s])
      );

      let imported = 0;
      let skipped = 0;
      let errors = 0;

      for (const setting of items) {
        const key = setting.key;
        if (!key) {
          skipped++;
          continue;
        }

        const payload = { ...setting };
        delete (payload as any).id;

        // Remap IDs for defaults if we imported new ones
        const mapValue = (value: any, map?: Record<string | number, number>) => {
          if (value === undefined || value === null || !map) return value;
          const mapped =
            map[value] ??
            map[String(value)] ??
            map[Number(value)];
          return mapped !== undefined ? mapped.toString() : value;
        };

        if (key === 'default-stream-profile') {
          payload.value = mapValue(payload.value, maps?.streamProfileMap);
        }
        if (key === 'default-user-agent') {
          payload.value = mapValue(payload.value, maps?.userAgentMap);
        }

        try {
          const match = existingByKey.get(key);
          if (match?.id) {
            await client.put(`/api/core/settings/${match.id}/`, payload);
            imported++;
            continue;
          }

          // Try create when we don't have a matching key in destination
          await client.post('/api/core/settings/', payload);
          imported++;
        } catch (error) {
          // If the target id is missing, retry as create once
          const status = (error as any)?.response?.status;
          if (status === 404) {
            try {
              await client.post('/api/core/settings/', payload);
              imported++;
              continue;
            } catch (err) {
              this.logJobError(jobId, 'Core settings import failed', key, err);
              errors++;
              continue;
            }
          }
          this.logJobError(jobId, 'Core settings import failed', key, error);
          errors++;
        }
      }

      return { imported, skipped, errors };
    } catch (error) {
      this.logJobError(jobId, 'Core settings import failed', '', error);
      return { imported: 0, skipped: 0, errors: 1 };
    }
  }

  private async importComskipConfig(
    client: DispatcharrClient,
    config: any,
    jobId: string
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    try {
      const value = typeof config === 'string' ? config : config?.config || '';
      if (!value || typeof value !== 'string' || value.toLowerCase().includes('<!doctype html')) {
        return { imported: 0, skipped: 1, errors: 0 };
      }

      const form = new FormData();
      form.append('config', value);

      await client.post('/api/channels/dvr/comskip-config/', form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
      });
      return { imported: 1, skipped: 0, errors: 0 };
    } catch (error) {
      this.logJobError(jobId, 'Comskip import failed', '', error);
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

    // Fetch existing logos to avoid duplicates
    let existingLogos: any[] = [];
    try {
      existingLogos = await this.getAllPaginated(client, '/api/channels/logos/');
    } catch (e) {
      console.warn('Could not fetch existing logos, will attempt all uploads');
    }
    const existingNames = new Set(existingLogos.map((l: any) => l.name?.toLowerCase()));

    for (let i = 0; i < logos.length; i++) {
      const logo = logos[i];
      const name = logo?.name || logo?.id || `logo-${i}`;
      const base64 = logo?.data;
      if (!base64) {
        skipped++;
        continue;
      }

      // Skip if logo with same name already exists
      if (existingNames.has(name.toString().toLowerCase())) {
        skipped++;
        continue;
      }

      try {
        // Convert base64 to Buffer for file upload
        const buffer = globalThis.Buffer.from(base64, 'base64');
        const formData = new FormData();
        formData.append('name', name.toString());
        formData.append('file', buffer, {
          filename: `${name}.png`,
          contentType: 'image/png',
        });

        await client.post('/api/channels/logos/upload/', formData, {
          headers: formData.getHeaders(),
        });
        imported++;
        // Add to existing set to prevent duplicate attempts within same import
        existingNames.add(name.toString().toLowerCase());
      } catch (error: any) {
        const errData = error?.response?.data;
        const errStatus = error?.response?.status;
        console.error(`Failed to import logo "${name}" (status=${errStatus}):`, errData || error?.message);
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  private async setEpgForChannels(
    client: DispatcharrClient,
    jobId: string,
    backupChannels?: any[],
    backupEpgData?: any[]
  ): Promise<void> {
    try {
      const [channels, epgData] = await Promise.all([
        this.getAllPaginated(client, '/api/channels/channels/').catch(() => []),
        this.getAllPaginated(client, '/api/epg/epgdata/').catch(() => []),
      ]);

      if (!Array.isArray(channels) || !Array.isArray(epgData)) return;

      const epgByTvg: Record<string, number> = {};
      const epgByName: Record<string, number> = {};
      const epgIds = new Set<number>();

      for (const epg of epgData) {
        const tvgKey = this.normalizeKey(epg?.tvg_id);
        const nameKey = this.normalizeKey(epg?.name);
        if (epg?.id != null) epgIds.add(epg.id);
        if (tvgKey && epg?.id != null && !(tvgKey in epgByTvg)) {
          epgByTvg[tvgKey] = epg.id;
        }
        if (nameKey && epg?.id != null && !(nameKey in epgByName)) {
          epgByName[nameKey] = epg.id;
        }
      }

      const associations: { channel_id: number; epg_data_id: number }[] = [];

      jobManager.addLog(jobId, `EPG assignment: ${epgIds.size} EPG data entries available on target`);
      jobManager.addLog(jobId, `EPG assignment: ${channels.length} channels to process`);

      // Build lookup for target channels by multiple keys
      const byNameNumber: Record<string, any> = {};
      const byTvg: Record<string, any> = {};
      const byNameOnly: Record<string, any> = {};
      for (const ch of channels) {
        if (!ch?.id) continue;
        const nameKey = this.normalizeKey(ch?.name);
        const tvgKey = this.normalizeKey(ch?.tvg_id);
        const num = ch?.channel_number != null ? String(ch.channel_number) : '';
        if (nameKey) {
          byNameOnly[nameKey] = ch;
          const composite = `${nameKey}|${num}`;
          byNameNumber[composite] = ch;
        }
        if (tvgKey) {
          byTvg[tvgKey] = ch;
        }
      }

      // Build lookup map from backup EPG data
      const backupEpgMap: Record<number, any> = {};
      let hasBackupEpgMetadata = false;
      if (Array.isArray(backupEpgData)) {
        for (const epg of backupEpgData) {
          if (epg?.id != null) {
            backupEpgMap[epg.id] = epg;
          }
        }
        hasBackupEpgMetadata = Object.keys(backupEpgMap).length > 0;
        jobManager.addLog(jobId, `EPG assignment: Built lookup map from ${Object.keys(backupEpgMap).length} backup EPG entries`);
      } else {
        jobManager.addLog(jobId, 'EPG assignment: No backup EPG metadata available (export without EPG Sources enabled?)');
      }

      // First, try to honor backup epg_data_id when it exists on target
      let backupMatches = 0;
      let backupEpgIdReused = 0;
      let backupFallbackMatches = 0;
      let backupTvgMatches = 0;
      let backupStationMatches = 0;
      let backupNameMatches = 0;
      let backupNoMatch = 0;

      if (Array.isArray(backupChannels)) {
        jobManager.addLog(jobId, `EPG assignment: Processing ${backupChannels.length} backup channels`);
        for (const bc of backupChannels) {
          if (!bc) continue;
          const nameKey = this.normalizeKey(bc?.name);
          const num = bc?.channel_number != null ? String(bc.channel_number) : '';
          const tvgKey = this.normalizeKey(bc?.tvg_id);
          const stationKey = this.normalizeKey(bc?.tvc_guide_stationid);
        const composite = nameKey ? `${nameKey}|${num}` : '';

        let target = (composite && byNameNumber[composite]) || (tvgKey && byTvg[tvgKey]) || (nameKey && byNameOnly[nameKey]);
        if (!target || target.epg_data_id) continue;

        let epgId: number | undefined;
        let matchStrategy: string | undefined;

        // Get backup EPG metadata if available
        const backupEpg = bc?.epg_data_id != null ? backupEpgMap[bc.epg_data_id] : undefined;
        const backupEpgTvgKey = this.normalizeKey(backupEpg?.tvg_id);
        const backupEpgNameKey = this.normalizeKey(backupEpg?.name);

        // Try to match by EPG metadata first (most reliable)
        if (backupEpgTvgKey && epgByTvg[backupEpgTvgKey]) {
          epgId = epgByTvg[backupEpgTvgKey];
          matchStrategy = 'backup-epg-tvg-id';
          backupTvgMatches++;
        } else if (backupEpgNameKey && epgByName[backupEpgNameKey]) {
          epgId = epgByName[backupEpgNameKey];
          matchStrategy = 'backup-epg-name';
          backupNameMatches++;
        } else if (hasBackupEpgMetadata && bc?.epg_data_id != null && epgIds.has(bc.epg_data_id)) {
          // Only use direct ID as fallback if:
          // 1. We have backup EPG metadata (otherwise IDs are meaningless)
          // 2. EPG metadata matching failed
          // This is less reliable as IDs may differ between systems
          epgId = bc.epg_data_id;
          matchStrategy = 'direct-id-fallback';
          backupEpgIdReused++;
        } else {
          // Final fallback: try channel metadata
          if (tvgKey && epgByTvg[tvgKey]) {
            epgId = epgByTvg[tvgKey];
            matchStrategy = 'channel-tvg-id';
            backupTvgMatches++;
          }
          else if (stationKey && epgByName[stationKey]) {
            epgId = epgByName[stationKey];
            matchStrategy = 'channel-station-id';
            backupStationMatches++;
          }
          else if (nameKey && epgByName[nameKey]) {
            epgId = epgByName[nameKey];
            matchStrategy = 'channel-name';
            backupNameMatches++;
          }
        }

        if (epgId && matchStrategy !== 'direct-id-fallback') {
          backupFallbackMatches++;
        }

          if (epgId) {
            associations.push({ channel_id: target.id, epg_data_id: epgId });
            backupMatches++;

            // Log first 10 matches for diagnosis
            if (backupMatches <= 10) {
              const backupEpg = bc?.epg_data_id != null ? backupEpgMap[bc.epg_data_id] : undefined;
              const backupEpgName = backupEpg?.name || bc?.epg_data_name || 'unknown';
              const targetEpgEntry = epgData.find((e: any) => e.id === epgId);
              const targetEpgName = targetEpgEntry?.name || 'unknown';
              jobManager.addLog(
                jobId,
                `EPG match #${backupMatches}: Ch ${num} "${bc?.name}" -> EPG ${epgId} via ${matchStrategy} | Backup EPG: "${backupEpgName}" (ID ${bc?.epg_data_id}) -> Target EPG: "${targetEpgName}" (ID ${epgId})`
              );
            }
          } else {
            backupNoMatch++;
            // Log first 5 failures for diagnosis
            if (backupNoMatch <= 5) {
              const backupEpg = bc?.epg_data_id != null ? backupEpgMap[bc.epg_data_id] : undefined;
              const backupEpgName = backupEpg?.name || bc?.epg_data_name || 'unknown';
              jobManager.addLog(
                jobId,
                `EPG no match: Ch ${num} "${bc?.name}" | Backup EPG: "${backupEpgName}" (ID ${bc?.epg_data_id}) | tvg_id: ${bc?.tvg_id || 'none'} | station: ${bc?.tvc_guide_stationid || 'none'}`
              );
            }
          }
        }
        jobManager.addLog(
          jobId,
          `EPG from backup: ${backupMatches} matches (${backupEpgIdReused} direct ID, ${backupTvgMatches} tvg_id, ${backupStationMatches} station_id, ${backupNameMatches} name), ${backupNoMatch} no match`
        );
      }

      // Next, fill any remaining channels without EPG using target metadata
      let targetMetadataMatches = 0;
      for (const ch of channels) {
        if (!ch?.id || ch?.epg_data_id) continue;
        const alreadyQueued = associations.find((a) => a.channel_id === ch.id);
        if (alreadyQueued) continue;

        const tvgKey = this.normalizeKey(ch?.tvg_id);
        const stationKey = this.normalizeKey(ch?.tvc_guide_stationid);
        const nameKey = this.normalizeKey(ch?.name);

        let epgId: number | undefined;
        if (tvgKey && epgByTvg[tvgKey]) epgId = epgByTvg[tvgKey];
        else if (stationKey && epgByName[stationKey]) epgId = epgByName[stationKey];
        else if (nameKey && epgByName[nameKey]) epgId = epgByName[nameKey];

        if (epgId) {
          associations.push({ channel_id: ch.id, epg_data_id: epgId });
          targetMetadataMatches++;
        }
      }
      if (targetMetadataMatches > 0) {
        jobManager.addLog(jobId, `EPG from target metadata: ${targetMetadataMatches} additional matches`);
      }

      jobManager.addLog(jobId, `EPG assignment: Total ${associations.length} EPG associations to apply`);

      if (associations.length === 0) {
        jobManager.addLog(jobId, 'No EPG associations found - channels may need manual EPG assignment');
        return;
      }

      const chunkSize = 200;
      for (let i = 0; i < associations.length; i += chunkSize) {
        const chunk = associations.slice(i, i + chunkSize);
        try {
          jobManager.addLog(
            jobId,
            `EPG batch chunk ${i}-${i + chunk.length}: ` +
              JSON.stringify(chunk.slice(0, 5)) +
              (chunk.length > 5 ? ` ...(${chunk.length} total)` : '')
          );
          await client.post('/api/channels/channels/batch-set-epg/', { associations: chunk });
        } catch (error: any) {
          this.logJobError(
            jobId,
            'Batch EPG set failed',
            `chunk ${i}-${i + chunk.length} payload=${JSON.stringify(chunk)}`,
            error
          );
        }
      }

      jobManager.addLog(jobId, `Assigned EPG to ${associations.length} channels (backup epg_data_id -> target match with fallbacks)`);
    } catch (error) {
      this.logJobError(jobId, 'EPG assignment failed', '', error);
    }
  }

  private async matchEpgForChannels(
    client: DispatcharrClient,
    jobId: string
  ): Promise<void> {
    try {
      const channels = await this.getAllPaginated(client, '/api/channels/channels/').catch(() => []);
      const missing = Array.isArray(channels)
        ? channels.filter((c: any) => !c?.epg_data_id && c?.id).map((c: any) => c.id)
        : [];

      if (!missing.length) return;

      await client.post('/api/channels/channels/match-epg/', { channel_ids: missing });
      jobManager.addLog(jobId, `Triggered EPG match for ${missing.length} channels`);
    } catch (error) {
      this.logJobError(jobId, 'EPG match failed', '', error);
    }
  }

  private async waitForEpgDataReady(
    client: DispatcharrClient,
    jobId: string,
    timeoutMs: number = 600000, // 10 minutes - EPG downloads and parsing can take time
    intervalMs: number = 10000, // Check every 10 seconds (less frequent polling)
    stabilityChecks: number = 12 // Wait for count to be stable for 12 checks (2 minutes of stability)
  ): Promise<void> {
    const start = Date.now();
    let previousCount = 0;
    let stableCount = 0;
    const dataAppearanceTimeout = 360000; // 6 minutes to wait for data to appear
    const minObservationTime = 180000; // Minimum 3 minutes observation after first growth

    jobManager.addLog(jobId, 'Waiting for EPG data to be downloaded and parsed...');

    // Get initial count - use a large page size to detect more entries
    try {
      const initialResp = await client.get('/api/epg/epgdata/?page=1&page_size=10000');
      // Handle both array responses and paginated responses
      if (Array.isArray(initialResp)) {
        // If it's an array, it might be the full dataset - check length
        previousCount = initialResp.length;
      } else if (initialResp?.count != null) {
        // Paginated response with count field
        previousCount = initialResp.count;
      } else if (initialResp?.results) {
        // Paginated response with results array
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

          // Log every 3rd check (every 30 seconds with 10s interval)
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
        await new Promise((res) => setTimeout(res, intervalMs));
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
            jobManager.addLog(jobId, `EPG data stable at ${currentCount} entries after ${Math.floor(observationTime / 1000)}s, proceeding with channel matching`);
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
      await new Promise((res) => setTimeout(res, intervalMs));
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
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await client.get('/api/channels/streams/?page=1&page_size=1');
        const count = Array.isArray(resp?.results) ? resp.results.length : Array.isArray(resp) ? resp.length : resp?.count || 0;
        if (count > 0) {
          jobManager.addLog(jobId, 'Streams detected; proceeding with channel-stream mapping');
          return;
        }
      } catch {
        // ignore and retry
      }
      await new Promise((res) => setTimeout(res, intervalMs));
    }
    jobManager.addLog(jobId, 'Timed out waiting for streams; channel-stream mapping may be incomplete');
  }
}

export const importService = new ImportService();
