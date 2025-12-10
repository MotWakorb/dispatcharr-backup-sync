import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Schedule, ScheduleInput, ScheduleRunHistoryEntry } from '../types/index.js';

interface ScheduleFile {
  schedules: Schedule[];
}

interface HistoryFile {
  entries: ScheduleRunHistoryEntry[];
}

const DATA_DIR = process.env.DATA_DIR || '/tmp/dispatcharr-manager';
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const HISTORY_FILE = path.join(DATA_DIR, 'scheduleHistory.json');
const MAX_HISTORY_PER_SCHEDULE = 100;

async function ensureStorage(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(SCHEDULES_FILE);
  } catch {
    const initial: ScheduleFile = { schedules: [] };
    await fs.writeFile(SCHEDULES_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }

  try {
    await fs.access(HISTORY_FILE);
  } catch {
    const initial: HistoryFile = { entries: [] };
    await fs.writeFile(HISTORY_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

async function loadSchedulesFile(): Promise<ScheduleFile> {
  await ensureStorage();
  const raw = await fs.readFile(SCHEDULES_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as ScheduleFile;
  parsed.schedules ??= [];
  return parsed;
}

async function saveSchedulesFile(data: ScheduleFile): Promise<void> {
  await fs.writeFile(SCHEDULES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function loadHistoryFile(): Promise<HistoryFile> {
  await ensureStorage();
  const raw = await fs.readFile(HISTORY_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as HistoryFile;
  parsed.entries ??= [];
  return parsed;
}

async function saveHistoryFile(data: HistoryFile): Promise<void> {
  await fs.writeFile(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

class ScheduleStore {
  async getAll(): Promise<Schedule[]> {
    const data = await loadSchedulesFile();
    return data.schedules;
  }

  async getById(id: string): Promise<Schedule | undefined> {
    const data = await loadSchedulesFile();
    return data.schedules.find((s) => s.id === id);
  }

  async create(input: ScheduleInput): Promise<Schedule> {
    const data = await loadSchedulesFile();
    const now = new Date().toISOString();
    const schedule: Schedule = {
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      ...input,
    };

    data.schedules.push(schedule);
    await saveSchedulesFile(data);
    return schedule;
  }

  async update(id: string, input: Partial<ScheduleInput>): Promise<Schedule> {
    const data = await loadSchedulesFile();
    const idx = data.schedules.findIndex((s) => s.id === id);
    if (idx === -1) {
      throw new Error('Schedule not found');
    }

    const updated: Schedule = {
      ...data.schedules[idx],
      ...input,
      updatedAt: new Date().toISOString(),
    };

    data.schedules[idx] = updated;
    await saveSchedulesFile(data);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const data = await loadSchedulesFile();
    data.schedules = data.schedules.filter((s) => s.id !== id);
    await saveSchedulesFile(data);

    // Also clean up history for this schedule
    const history = await loadHistoryFile();
    history.entries = history.entries.filter((e) => e.scheduleId !== id);
    await saveHistoryFile(history);
  }

  async updateLastRun(
    id: string,
    jobId: string,
    status: 'completed' | 'failed' | 'cancelled'
  ): Promise<void> {
    const data = await loadSchedulesFile();
    const idx = data.schedules.findIndex((s) => s.id === id);
    if (idx === -1) return;

    data.schedules[idx].lastRunAt = new Date().toISOString();
    data.schedules[idx].lastRunJobId = jobId;
    data.schedules[idx].lastRunStatus = status;
    data.schedules[idx].updatedAt = new Date().toISOString();
    await saveSchedulesFile(data);
  }

  async updateNextRunTime(id: string, nextRunAt: string): Promise<void> {
    const data = await loadSchedulesFile();
    const idx = data.schedules.findIndex((s) => s.id === id);
    if (idx === -1) return;

    data.schedules[idx].nextRunAt = nextRunAt;
    await saveSchedulesFile(data);
  }

  // History management
  async recordRunStart(scheduleId: string, jobId: string): Promise<void> {
    const history = await loadHistoryFile();
    const entry: ScheduleRunHistoryEntry = {
      scheduleId,
      jobId,
      startedAt: new Date().toISOString(),
      status: 'running',
    };
    history.entries.push(entry);

    // Trim old entries for this schedule
    const scheduleEntries = history.entries.filter((e) => e.scheduleId === scheduleId);
    if (scheduleEntries.length > MAX_HISTORY_PER_SCHEDULE) {
      const toRemove = scheduleEntries.length - MAX_HISTORY_PER_SCHEDULE;
      let removed = 0;
      history.entries = history.entries.filter((e) => {
        if (e.scheduleId === scheduleId && removed < toRemove) {
          removed++;
          return false;
        }
        return true;
      });
    }

    await saveHistoryFile(history);
  }

  async recordRunComplete(
    scheduleId: string,
    jobId: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string
  ): Promise<void> {
    const history = await loadHistoryFile();
    const entry = history.entries.find(
      (e) => e.scheduleId === scheduleId && e.jobId === jobId
    );
    if (entry) {
      entry.completedAt = new Date().toISOString();
      entry.status = status;
      if (error) entry.error = error;
      await saveHistoryFile(history);
    }

    // Also update the schedule's last run info
    await this.updateLastRun(scheduleId, jobId, status);
  }

  async getRunHistory(scheduleId: string, limit = 20): Promise<ScheduleRunHistoryEntry[]> {
    const history = await loadHistoryFile();
    return history.entries
      .filter((e) => e.scheduleId === scheduleId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }
}

export const scheduleStore = new ScheduleStore();
