import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  NotificationProvider,
  NotificationProviderInput,
  NotificationGlobalSettings,
  NotificationData,
} from '../types/notifications.js';

const DATA_DIR = process.env.DATA_DIR || '/tmp/dispatcharr-manager';
const DATA_FILE = path.join(DATA_DIR, 'notificationProviders.json');

const DEFAULT_GLOBAL_SETTINGS: NotificationGlobalSettings = {
  notifyOnStart: false,
  notifyOnComplete: true,
  notifyOnCompleteWithErrors: true,
  notifyOnFailure: true,
  includeLogsInEmail: false,
};

async function ensureStorage(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    const initial: NotificationData = {
      providers: [],
      globalSettings: DEFAULT_GLOBAL_SETTINGS,
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

async function loadFile(): Promise<NotificationData> {
  await ensureStorage();
  const raw = await fs.readFile(DATA_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as NotificationData;
  parsed.providers ??= [];
  // Merge with defaults to handle new properties added over time
  parsed.globalSettings = {
    ...DEFAULT_GLOBAL_SETTINGS,
    ...(parsed.globalSettings || {}),
  };
  return parsed;
}

async function saveFile(data: NotificationData): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

class NotificationStore {
  // Provider methods
  async getProviders(): Promise<NotificationProvider[]> {
    const data = await loadFile();
    return data.providers;
  }

  async getEnabledProviders(): Promise<NotificationProvider[]> {
    const data = await loadFile();
    return data.providers.filter((p) => p.enabled);
  }

  async getProviderById(id: string): Promise<NotificationProvider | undefined> {
    const data = await loadFile();
    return data.providers.find((p) => p.id === id);
  }

  async createProvider(input: NotificationProviderInput): Promise<NotificationProvider> {
    const data = await loadFile();
    const now = new Date().toISOString();
    const provider: NotificationProvider = {
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...input,
    };

    data.providers.push(provider);
    await saveFile(data);
    return provider;
  }

  async updateProvider(id: string, input: Partial<NotificationProviderInput>): Promise<NotificationProvider> {
    const data = await loadFile();
    const idx = data.providers.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error('Notification provider not found');
    }

    const updated: NotificationProvider = {
      ...data.providers[idx],
      ...input,
      updatedAt: new Date().toISOString(),
    };

    data.providers[idx] = updated;
    await saveFile(data);
    return updated;
  }

  async deleteProvider(id: string): Promise<void> {
    const data = await loadFile();
    data.providers = data.providers.filter((p) => p.id !== id);
    await saveFile(data);
  }

  // Global settings methods
  async getGlobalSettings(): Promise<NotificationGlobalSettings> {
    const data = await loadFile();
    return data.globalSettings;
  }

  async updateGlobalSettings(settings: Partial<NotificationGlobalSettings>): Promise<NotificationGlobalSettings> {
    const data = await loadFile();
    data.globalSettings = {
      ...data.globalSettings,
      ...settings,
    };
    await saveFile(data);
    return data.globalSettings;
  }
}

export const notificationStore = new NotificationStore();
