/**
 * Test fixtures for EPG (Electronic Program Guide) related data
 */

export interface EpgSourceFixture {
  id: number;
  name: string;
  url?: string;
  file_path?: string;
  enabled?: boolean;
  refresh_interval?: number;
  last_refreshed?: string;
  last_error?: string | null;
  program_count?: number;
}

export interface EpgDataFixture {
  id: number;
  tvg_id: string;
  name: string;
  epg_source?: number | null;
  icon_url?: string;
  program_count?: number;
}

export interface EpgProgramFixture {
  id: number;
  epg_data_id: number;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  category?: string;
  rating?: string;
  episode_num?: string;
  season?: number;
  episode?: number;
}

/**
 * Sample EPG sources
 */
export const sampleEpgSources: EpgSourceFixture[] = [
  {
    id: 1,
    name: 'Schedules Direct',
    url: 'http://schedulesdirect.example.com/xmltv.xml',
    enabled: true,
    refresh_interval: 43200, // 12 hours
    last_refreshed: '2024-01-15T06:00:00Z',
    last_error: null,
    program_count: 15000,
  },
  {
    id: 2,
    name: 'EPG Provider 2',
    url: 'http://epg2.example.com/guide.xml',
    enabled: true,
    refresh_interval: 86400, // 24 hours
    last_refreshed: '2024-01-14T12:00:00Z',
    program_count: 8000,
  },
  {
    id: 3,
    name: 'Local EPG',
    file_path: '/config/epg/local.xml',
    enabled: false,
    program_count: 0,
  },
];

/**
 * Sample EPG data entries (channel EPG metadata)
 */
export const sampleEpgData: EpgDataFixture[] = [
  {
    id: 101,
    tvg_id: 'ESPN.us',
    name: 'ESPN',
    epg_source: 1,
    icon_url: 'http://example.com/icons/espn.png',
    program_count: 168,
  },
  {
    id: 102,
    tvg_id: 'ESPN2.us',
    name: 'ESPN2',
    epg_source: 1,
    icon_url: 'http://example.com/icons/espn2.png',
    program_count: 168,
  },
  {
    id: 201,
    tvg_id: 'CNN.us',
    name: 'CNN',
    epg_source: 1,
    icon_url: 'http://example.com/icons/cnn.png',
    program_count: 336,
  },
  {
    id: 202,
    tvg_id: 'FOXNEWS.us',
    name: 'FOX News Channel',
    epg_source: 1,
    icon_url: 'http://example.com/icons/foxnews.png',
    program_count: 336,
  },
  {
    id: 301,
    tvg_id: 'HBO.us',
    name: 'HBO',
    epg_source: 2,
    icon_url: 'http://example.com/icons/hbo.png',
    program_count: 84,
  },
  {
    id: 401,
    tvg_id: 'CARTNETW.us',
    name: 'Cartoon Network',
    epg_source: 2,
    program_count: 168,
  },
];

/**
 * Sample EPG programs
 */
export const sampleEpgPrograms: EpgProgramFixture[] = [
  {
    id: 1,
    epg_data_id: 101,
    title: 'SportsCenter',
    description: 'Latest sports news and highlights',
    start_time: '2024-01-15T08:00:00Z',
    end_time: '2024-01-15T09:00:00Z',
    category: 'Sports',
    rating: 'TV-G',
  },
  {
    id: 2,
    epg_data_id: 101,
    title: 'NFL Live',
    description: 'NFL analysis and discussion',
    start_time: '2024-01-15T09:00:00Z',
    end_time: '2024-01-15T10:00:00Z',
    category: 'Sports',
    rating: 'TV-G',
  },
  {
    id: 3,
    epg_data_id: 201,
    title: 'CNN Newsroom',
    description: 'Breaking news coverage',
    start_time: '2024-01-15T08:00:00Z',
    end_time: '2024-01-15T10:00:00Z',
    category: 'News',
    rating: 'TV-PG',
  },
  {
    id: 4,
    epg_data_id: 301,
    title: 'Game of Thrones',
    description: 'Epic fantasy drama',
    start_time: '2024-01-15T21:00:00Z',
    end_time: '2024-01-15T22:00:00Z',
    category: 'Drama',
    rating: 'TV-MA',
    season: 8,
    episode: 1,
    episode_num: 'S08E01',
  },
];

/**
 * Creates a custom EPG source fixture
 */
export function createEpgSource(overrides: Partial<EpgSourceFixture> = {}): EpgSourceFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `EPG Source ${id}`,
    url: `http://example.com/epg/${id}.xml`,
    enabled: true,
    refresh_interval: 86400,
    program_count: 0,
    ...overrides,
  };
}

/**
 * Creates a custom EPG data fixture
 */
export function createEpgData(overrides: Partial<EpgDataFixture> = {}): EpgDataFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    tvg_id: `channel_${id}`,
    name: `Channel ${id}`,
    program_count: 0,
    ...overrides,
  };
}

/**
 * Creates multiple EPG data fixtures
 */
export function createEpgDataEntries(count: number, baseOverrides: Partial<EpgDataFixture> = {}): EpgDataFixture[] {
  return Array.from({ length: count }, (_, i) =>
    createEpgData({
      id: i + 1,
      tvg_id: `test_channel_${i + 1}`,
      name: `Test Channel ${i + 1}`,
      ...baseOverrides,
    })
  );
}

/**
 * Creates a custom EPG program fixture
 */
export function createEpgProgram(overrides: Partial<EpgProgramFixture> = {}): EpgProgramFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour later

  return {
    id,
    epg_data_id: 1,
    title: `Program ${id}`,
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    ...overrides,
  };
}
