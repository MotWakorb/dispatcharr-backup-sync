/**
 * Test fixtures for miscellaneous entities:
 * - Logos
 * - Plugins
 * - Users
 * - Settings
 * - User Agents
 * - DVR Rules
 */

export interface LogoFixture {
  id: number;
  name: string;
  file_path?: string;
  url?: string;
  original_name?: string;
}

export interface PluginFixture {
  id: number;
  key: string;
  name: string;
  version?: string;
  enabled?: boolean;
  description?: string;
  settings?: Record<string, unknown>;
}

export interface UserFixture {
  id: number;
  username: string;
  email?: string;
  is_superuser?: boolean;
  is_staff?: boolean;
  is_active?: boolean;
  first_name?: string;
  last_name?: string;
}

export interface SettingsFixture {
  id?: number;
  key: string;
  value: unknown;
  category?: string;
}

export interface UserAgentFixture {
  id: number;
  name: string;
  user_agent: string;
  enabled?: boolean;
}

export interface DvrRuleFixture {
  id: number;
  name: string;
  search_term?: string;
  channel_id?: number | null;
  enabled?: boolean;
  priority?: number;
  start_padding?: number;
  end_padding?: number;
}

export interface ComskipConfigFixture {
  id: number;
  name: string;
  config_content?: string;
  enabled?: boolean;
}

/**
 * Sample logos
 */
export const sampleLogos: LogoFixture[] = [
  { id: 1, name: 'espn', file_path: '/media/logos/espn.png', original_name: 'espn.png' },
  { id: 2, name: 'espn2', file_path: '/media/logos/espn2.png', original_name: 'espn2.png' },
  { id: 3, name: 'cnn', file_path: '/media/logos/cnn.png', original_name: 'cnn.png' },
  { id: 4, name: 'foxnews', file_path: '/media/logos/foxnews.png', original_name: 'foxnews.png' },
  { id: 5, name: 'hbo', file_path: '/media/logos/hbo.png', original_name: 'hbo.png' },
  { id: 6, name: 'cartoon_network', file_path: '/media/logos/cartoon_network.png' },
];

/**
 * Sample plugins
 */
export const samplePlugins: PluginFixture[] = [
  {
    id: 1,
    key: 'epg_provider',
    name: 'EPG Provider',
    version: '1.2.0',
    enabled: true,
    description: 'Provides EPG data from various sources',
    settings: { refresh_interval: 3600 },
  },
  {
    id: 2,
    key: 'stream_optimizer',
    name: 'Stream Optimizer',
    version: '2.0.1',
    enabled: true,
    description: 'Optimizes stream quality',
  },
  {
    id: 3,
    key: 'logo_fetcher',
    name: 'Logo Fetcher',
    version: '1.0.0',
    enabled: false,
    description: 'Automatically fetches channel logos',
  },
];

/**
 * Sample users
 */
export const sampleUsers: UserFixture[] = [
  {
    id: 1,
    username: 'admin',
    email: 'admin@example.com',
    is_superuser: true,
    is_staff: true,
    is_active: true,
    first_name: 'Admin',
    last_name: 'User',
  },
  {
    id: 2,
    username: 'user1',
    email: 'user1@example.com',
    is_superuser: false,
    is_staff: false,
    is_active: true,
    first_name: 'Regular',
    last_name: 'User',
  },
  {
    id: 3,
    username: 'inactive_user',
    email: 'inactive@example.com',
    is_superuser: false,
    is_staff: false,
    is_active: false,
  },
];

/**
 * Sample settings
 */
export const sampleSettings: SettingsFixture[] = [
  { key: 'buffer_size', value: 4096, category: 'streaming' },
  { key: 'max_concurrent_streams', value: 5, category: 'streaming' },
  { key: 'epg_update_interval', value: 43200, category: 'epg' },
  { key: 'timezone', value: 'America/New_York', category: 'general' },
  { key: 'log_level', value: 'info', category: 'general' },
  { key: 'enable_transcoding', value: true, category: 'streaming' },
];

/**
 * Sample user agents
 */
export const sampleUserAgents: UserAgentFixture[] = [
  {
    id: 1,
    name: 'VLC Player',
    user_agent: 'VLC/3.0.16 LibVLC/3.0.16',
    enabled: true,
  },
  {
    id: 2,
    name: 'Kodi',
    user_agent: 'Kodi/19.4 (Windows; AMD64)',
    enabled: true,
  },
  {
    id: 3,
    name: 'Generic',
    user_agent: 'Mozilla/5.0',
    enabled: false,
  },
];

/**
 * Sample DVR rules
 */
export const sampleDvrRules: DvrRuleFixture[] = [
  {
    id: 1,
    name: 'All NFL Games',
    search_term: 'NFL',
    enabled: true,
    priority: 1,
    start_padding: 300, // 5 minutes
    end_padding: 900, // 15 minutes
  },
  {
    id: 2,
    name: 'Breaking News',
    search_term: 'Breaking',
    channel_id: 3, // CNN
    enabled: true,
    priority: 2,
  },
  {
    id: 3,
    name: 'Kids Shows',
    search_term: null,
    channel_id: 6, // Cartoon Network
    enabled: false,
    priority: 10,
  },
];

/**
 * Sample comskip configs
 */
export const sampleComskipConfigs: ComskipConfigFixture[] = [
  {
    id: 1,
    name: 'Default Config',
    config_content: 'detect_method=111\nmax_volume=500',
    enabled: true,
  },
  {
    id: 2,
    name: 'Sports Config',
    config_content: 'detect_method=111\nmax_volume=600\nmin_commercialbreak=20',
    enabled: true,
  },
];

/**
 * Factory functions
 */

export function createLogo(overrides: Partial<LogoFixture> = {}): LogoFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `logo_${id}`,
    file_path: `/media/logos/logo_${id}.png`,
    ...overrides,
  };
}

export function createPlugin(overrides: Partial<PluginFixture> = {}): PluginFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    key: `plugin_${id}`,
    name: `Plugin ${id}`,
    version: '1.0.0',
    enabled: true,
    ...overrides,
  };
}

export function createUser(overrides: Partial<UserFixture> = {}): UserFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    username: `user_${id}`,
    email: `user${id}@example.com`,
    is_superuser: false,
    is_staff: false,
    is_active: true,
    ...overrides,
  };
}

export function createSetting(overrides: Partial<SettingsFixture> = {}): SettingsFixture {
  return {
    key: `setting_${Math.floor(Math.random() * 10000)}`,
    value: 'default',
    category: 'general',
    ...overrides,
  };
}

export function createUserAgent(overrides: Partial<UserAgentFixture> = {}): UserAgentFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `User Agent ${id}`,
    user_agent: `CustomAgent/${id}.0`,
    enabled: true,
    ...overrides,
  };
}

export function createDvrRule(overrides: Partial<DvrRuleFixture> = {}): DvrRuleFixture {
  const id = overrides.id ?? Math.floor(Math.random() * 10000);
  return {
    id,
    name: `DVR Rule ${id}`,
    search_term: `search_${id}`,
    enabled: true,
    priority: 5,
    ...overrides,
  };
}
