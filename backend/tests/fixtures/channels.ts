/**
 * Test fixtures for channel-related data
 */

export interface ChannelFixture {
  id: number;
  name: string;
  channel_number: number;
  tvg_id?: string;
  tvc_guide_stationid?: string;
  logo?: number | null;
  logo_url?: string;
  group?: number | null;
  group_name?: string;
  epg_data_id?: number | null;
  stream_profile?: number | null;
  channel_profile?: number | null;
  active?: boolean;
}

export interface ChannelGroupFixture {
  id: number;
  name: string;
  sort_order?: number;
}

export interface ChannelProfileFixture {
  id: number;
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
}

/**
 * Sample channel groups
 */
export const sampleChannelGroups: ChannelGroupFixture[] = [
  { id: 1, name: 'Sports', sort_order: 1 },
  { id: 2, name: 'News', sort_order: 2 },
  { id: 3, name: 'Entertainment', sort_order: 3 },
  { id: 4, name: 'Movies', sort_order: 4 },
  { id: 5, name: 'Kids', sort_order: 5 },
];

/**
 * Sample channel profiles
 */
export const sampleChannelProfiles: ChannelProfileFixture[] = [
  { id: 1, name: 'Default', description: 'Default channel profile' },
  { id: 2, name: 'HD Only', description: 'High definition channels only' },
  { id: 3, name: 'Low Bandwidth', description: 'Optimized for low bandwidth' },
];

/**
 * Sample channels with various configurations
 */
export const sampleChannels: ChannelFixture[] = [
  {
    id: 1,
    name: 'ESPN',
    channel_number: 100,
    tvg_id: 'ESPN.us',
    tvc_guide_stationid: '32645',
    logo: 1,
    logo_url: '/media/logos/espn.png',
    group: 1,
    group_name: 'Sports',
    epg_data_id: 101,
    stream_profile: 1,
    channel_profile: 1,
    active: true,
  },
  {
    id: 2,
    name: 'ESPN2',
    channel_number: 101,
    tvg_id: 'ESPN2.us',
    tvc_guide_stationid: '32646',
    logo: 2,
    logo_url: '/media/logos/espn2.png',
    group: 1,
    group_name: 'Sports',
    epg_data_id: 102,
    stream_profile: 1,
    channel_profile: 1,
    active: true,
  },
  {
    id: 3,
    name: 'CNN',
    channel_number: 200,
    tvg_id: 'CNN.us',
    tvc_guide_stationid: '36421',
    logo: 3,
    logo_url: '/media/logos/cnn.png',
    group: 2,
    group_name: 'News',
    epg_data_id: 201,
    stream_profile: 1,
    channel_profile: 1,
    active: true,
  },
  {
    id: 4,
    name: 'FOX News',
    channel_number: 201,
    tvg_id: 'FOXNEWS.us',
    logo: null,
    group: 2,
    group_name: 'News',
    epg_data_id: null,
    active: true,
  },
  {
    id: 5,
    name: 'HBO',
    channel_number: 300,
    tvg_id: 'HBO.us',
    logo: 5,
    group: 4,
    group_name: 'Movies',
    epg_data_id: 301,
    active: true,
  },
  {
    id: 6,
    name: 'Cartoon Network',
    channel_number: 400,
    tvg_id: 'CARTNETW.us',
    logo: 6,
    group: 5,
    group_name: 'Kids',
    epg_data_id: 401,
    active: false, // Inactive channel for testing
  },
];

/**
 * Creates a custom channel fixture
 */
export function createChannel(overrides: Partial<ChannelFixture> = {}): ChannelFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `Channel ${id}`,
    channel_number: id,
    active: true,
    ...overrides,
  };
}

/**
 * Creates multiple channel fixtures
 */
export function createChannels(count: number, baseOverrides: Partial<ChannelFixture> = {}): ChannelFixture[] {
  return Array.from({ length: count }, (_, i) =>
    createChannel({
      id: i + 1,
      channel_number: 100 + i,
      name: `Test Channel ${i + 1}`,
      ...baseOverrides,
    })
  );
}

/**
 * Creates a channel group fixture
 */
export function createChannelGroup(overrides: Partial<ChannelGroupFixture> = {}): ChannelGroupFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `Group ${id}`,
    sort_order: id,
    ...overrides,
  };
}
