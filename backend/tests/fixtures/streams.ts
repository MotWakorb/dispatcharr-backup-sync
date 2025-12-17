/**
 * Test fixtures for stream-related data
 */

export interface StreamFixture {
  id: number;
  name: string;
  url: string;
  m3u_account?: number | null;
  channel?: number | null;
  stream_profile?: number | null;
  tvg_id?: string;
  tvg_name?: string;
  group_title?: string;
  logo_url?: string;
  active?: boolean;
  current_viewers?: number;
}

export interface StreamProfileFixture {
  id: number;
  name: string;
  description?: string;
  command?: string;
  settings?: Record<string, unknown>;
}

export interface M3UAccountFixture {
  id: number;
  name: string;
  url?: string;
  file_path?: string;
  username?: string;
  password?: string;
  max_streams?: number;
  enabled?: boolean;
  refresh_interval?: number;
  last_refreshed?: string;
}

/**
 * Sample stream profiles
 */
export const sampleStreamProfiles: StreamProfileFixture[] = [
  { id: 1, name: 'Direct', description: 'Direct stream passthrough' },
  { id: 2, name: 'Transcode', description: 'Transcode to H.264', command: '-c:v libx264' },
  { id: 3, name: 'Copy', description: 'Copy stream', command: '-c copy' },
];

/**
 * Sample M3U accounts
 */
export const sampleM3UAccounts: M3UAccountFixture[] = [
  {
    id: 1,
    name: 'Primary IPTV',
    url: 'http://provider1.example.com/get.php?username=user1&password=pass1&type=m3u_plus',
    max_streams: 2,
    enabled: true,
    refresh_interval: 86400,
    last_refreshed: '2024-01-15T10:30:00Z',
  },
  {
    id: 2,
    name: 'Backup IPTV',
    url: 'http://provider2.example.com/playlist.m3u',
    max_streams: 4,
    enabled: true,
    refresh_interval: 43200,
    last_refreshed: '2024-01-15T08:00:00Z',
  },
  {
    id: 3,
    name: 'Local M3U',
    file_path: '/config/playlists/local.m3u',
    enabled: false,
  },
];

/**
 * Sample streams
 */
export const sampleStreams: StreamFixture[] = [
  {
    id: 1,
    name: 'ESPN HD Stream',
    url: 'http://provider1.example.com/live/espn_hd',
    m3u_account: 1,
    channel: 1,
    stream_profile: 1,
    tvg_id: 'ESPN.us',
    tvg_name: 'ESPN HD',
    group_title: 'Sports',
    logo_url: 'http://example.com/logos/espn.png',
    active: true,
    current_viewers: 0,
  },
  {
    id: 2,
    name: 'ESPN2 HD Stream',
    url: 'http://provider1.example.com/live/espn2_hd',
    m3u_account: 1,
    channel: 2,
    stream_profile: 1,
    tvg_id: 'ESPN2.us',
    tvg_name: 'ESPN2 HD',
    group_title: 'Sports',
    active: true,
  },
  {
    id: 3,
    name: 'CNN Stream',
    url: 'http://provider1.example.com/live/cnn',
    m3u_account: 1,
    channel: 3,
    stream_profile: 2,
    tvg_id: 'CNN.us',
    group_title: 'News',
    active: true,
  },
  {
    id: 4,
    name: 'HBO Stream',
    url: 'http://provider2.example.com/hbo',
    m3u_account: 2,
    channel: 5,
    stream_profile: 1,
    tvg_id: 'HBO.us',
    group_title: 'Movies',
    active: true,
  },
  {
    id: 5,
    name: 'ESPN Backup Stream',
    url: 'http://provider2.example.com/espn_backup',
    m3u_account: 2,
    channel: 1, // Same channel as stream 1 - backup stream
    stream_profile: 3,
    tvg_id: 'ESPN.us',
    active: false, // Backup disabled by default
  },
];

/**
 * Creates a custom stream fixture
 */
export function createStream(overrides: Partial<StreamFixture> = {}): StreamFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `Stream ${id}`,
    url: `http://example.com/stream/${id}`,
    active: true,
    current_viewers: 0,
    ...overrides,
  };
}

/**
 * Creates multiple stream fixtures
 */
export function createStreams(count: number, baseOverrides: Partial<StreamFixture> = {}): StreamFixture[] {
  return Array.from({ length: count }, (_, i) =>
    createStream({
      id: i + 1,
      name: `Test Stream ${i + 1}`,
      ...baseOverrides,
    })
  );
}

/**
 * Creates a custom M3U account fixture
 */
export function createM3UAccount(overrides: Partial<M3UAccountFixture> = {}): M3UAccountFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `M3U Account ${id}`,
    url: `http://example.com/playlist/${id}.m3u`,
    enabled: true,
    max_streams: 2,
    ...overrides,
  };
}

/**
 * Creates a custom stream profile fixture
 */
export function createStreamProfile(overrides: Partial<StreamProfileFixture> = {}): StreamProfileFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `Profile ${id}`,
    description: `Stream profile ${id}`,
    ...overrides,
  };
}
