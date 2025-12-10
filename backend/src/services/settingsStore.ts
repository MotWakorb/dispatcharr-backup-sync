import { promises as fs } from 'fs';
import path from 'path';

export type TimeFormat = '12h' | '24h';

export interface AppSettings {
  timezone: string;
  timeFormat: TimeFormat;
}

const DATA_DIR = process.env.DATA_DIR || '/tmp/dispatcharr-manager';
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Use TZ environment variable as default if set, otherwise UTC
const DEFAULT_TIMEZONE = process.env.TZ || 'UTC';

const DEFAULT_SETTINGS: AppSettings = {
  timezone: DEFAULT_TIMEZONE,
  timeFormat: '12h',
};

async function ensureStorage(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
  }
}

async function loadFile(): Promise<AppSettings> {
  await ensureStorage();
  const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<AppSettings>;
  return { ...DEFAULT_SETTINGS, ...parsed };
}

async function saveFile(data: AppSettings): Promise<void> {
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

class SettingsStore {
  private cachedSettings: AppSettings | null = null;

  async get(): Promise<AppSettings> {
    if (!this.cachedSettings) {
      this.cachedSettings = await loadFile();
    }
    return this.cachedSettings;
  }

  async update(updates: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const updated = { ...current, ...updates };
    await saveFile(updated);
    this.cachedSettings = updated;
    return updated;
  }

  async getTimezone(): Promise<string> {
    const settings = await this.get();
    return settings.timezone;
  }

  async setTimezone(timezone: string): Promise<void> {
    await this.update({ timezone });
  }

  clearCache(): void {
    this.cachedSettings = null;
  }
}

export const settingsStore = new SettingsStore();
