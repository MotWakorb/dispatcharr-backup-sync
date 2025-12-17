/**
 * Test fixtures index - re-exports all fixtures for easy importing
 */

// Channel fixtures
export {
  type ChannelFixture,
  type ChannelGroupFixture,
  type ChannelProfileFixture,
  sampleChannels,
  sampleChannelGroups,
  sampleChannelProfiles,
  createChannel,
  createChannels,
  createChannelGroup,
} from './channels.js';

// Stream fixtures
export {
  type StreamFixture,
  type StreamProfileFixture,
  type M3UAccountFixture,
  sampleStreams,
  sampleStreamProfiles,
  sampleM3UAccounts,
  createStream,
  createStreams,
  createM3UAccount,
  createStreamProfile,
} from './streams.js';

// EPG fixtures
export {
  type EpgSourceFixture,
  type EpgDataFixture,
  type EpgProgramFixture,
  sampleEpgSources,
  sampleEpgData,
  sampleEpgPrograms,
  createEpgSource,
  createEpgData,
  createEpgDataEntries,
  createEpgProgram,
} from './epg.js';

// Misc fixtures (logos, plugins, users, settings, etc.)
export {
  type LogoFixture,
  type PluginFixture,
  type UserFixture,
  type SettingsFixture,
  type UserAgentFixture,
  type DvrRuleFixture,
  type ComskipConfigFixture,
  sampleLogos,
  samplePlugins,
  sampleUsers,
  sampleSettings,
  sampleUserAgents,
  sampleDvrRules,
  sampleComskipConfigs,
  createLogo,
  createPlugin,
  createUser,
  createSetting,
  createUserAgent,
  createDvrRule,
} from './misc.js';
