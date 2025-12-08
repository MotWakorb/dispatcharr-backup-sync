import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import type { SavedConnection, SavedConnectionInput } from '../types/index.js';

interface SavedConnectionFile {
  connections: SavedConnection[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'savedConnections.json');

async function ensureStorage(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    // Initialize with default connections from environment variables (for development only)
    const now = new Date().toISOString();
    const connections: SavedConnection[] = [];

    // Only add default connections if environment variables are set
    if (process.env.DEFAULT_PROD_URL && process.env.DEFAULT_USERNAME && process.env.DEFAULT_PASSWORD) {
      connections.push({
        id: uuidv4(),
        name: 'Prod',
        instanceUrl: process.env.DEFAULT_PROD_URL,
        username: process.env.DEFAULT_USERNAME,
        password: process.env.DEFAULT_PASSWORD,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (process.env.DEFAULT_DEV_URL && process.env.DEFAULT_USERNAME && process.env.DEFAULT_PASSWORD) {
      connections.push({
        id: uuidv4(),
        name: 'Dev',
        instanceUrl: process.env.DEFAULT_DEV_URL,
        username: process.env.DEFAULT_USERNAME,
        password: process.env.DEFAULT_PASSWORD,
        createdAt: now,
        updatedAt: now,
      });
    }

    const initial: SavedConnectionFile = { connections };
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

async function loadFile(): Promise<SavedConnectionFile> {
  await ensureStorage();
  const raw = await fs.readFile(DATA_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as SavedConnectionFile;
  parsed.connections ??= [];
  return parsed;
}

async function saveFile(data: SavedConnectionFile): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

class SavedConnectionStore {
  async getAll(): Promise<SavedConnection[]> {
    const data = await loadFile();
    return data.connections;
  }

  async getById(id: string): Promise<SavedConnection | undefined> {
    const data = await loadFile();
    return data.connections.find((conn) => conn.id === id);
  }

  async create(input: SavedConnectionInput): Promise<SavedConnection> {
    const data = await loadFile();
    const now = new Date().toISOString();
    const connection: SavedConnection = {
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...input,
    };

    data.connections.push(connection);
    await saveFile(data);
    return connection;
  }

  async update(id: string, input: Partial<SavedConnectionInput>): Promise<SavedConnection> {
    const data = await loadFile();
    const idx = data.connections.findIndex((conn) => conn.id === id);
    if (idx === -1) {
      throw new Error('Saved connection not found');
    }

    const updated: SavedConnection = {
      ...data.connections[idx],
      ...input,
      updatedAt: new Date().toISOString(),
    };

    data.connections[idx] = updated;
    await saveFile(data);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const data = await loadFile();
    data.connections = data.connections.filter((conn) => conn.id !== id);
    await saveFile(data);
  }
}

export const savedConnectionStore = new SavedConnectionStore();
