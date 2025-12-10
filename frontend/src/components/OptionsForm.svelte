<script lang="ts">
  import type { SyncOptions } from '../types';

  export let options: SyncOptions = {};
  export let title: string = 'Sync Options';

  const getOptionChecked = (key: string) => {
    return Boolean((options as Record<string, boolean | undefined>)[key]);
  };

  const toggleOption = (key: string) => {
    const current = getOptionChecked(key);
    (options as Record<string, boolean | undefined>)[key] = !current;
    options = options; // Trigger Svelte reactivity
  };

  const allOptions = [
    { key: 'syncChannelGroups', label: 'Channel Groups' },
    { key: 'syncChannelProfiles', label: 'Channel Profiles' },
    { key: 'syncChannels', label: 'Channels' },
    { key: 'syncM3USources', label: 'M3U Sources' },
    { key: 'syncStreamProfiles', label: 'Stream Profiles' },
    { key: 'syncUserAgents', label: 'User Agents' },
    { key: 'syncCoreSettings', label: 'Core Settings' },
    { key: 'syncEPGSources', label: 'EPG Sources' },
    { key: 'syncPlugins', label: 'Plugins' },
    { key: 'syncDVRRules', label: 'DVR Rules' },
    { key: 'syncComskipConfig', label: 'Comskip Config' },
    { key: 'syncUsers', label: 'Users' },
    // Logos disabled for v1.0 release - code remains in backend
    // { key: 'syncLogos', label: 'Logos (includes images)' },
  ];

  function toggleAll() {
    const allSelected = allOptions.every(opt => options[opt.key as keyof SyncOptions]);
    allOptions.forEach(opt => {
      options[opt.key as keyof SyncOptions] = !allSelected;
    });
    options = options; // Trigger Svelte reactivity
  }

  $: allSelected = allOptions.every(opt => options[opt.key as keyof SyncOptions]);
</script>

<div class="options-form">
  <div class="flex items-center justify-between mb-2">
    <h3>{title}</h3>
    <button class="btn btn-secondary btn-sm" on:click={toggleAll}>
      {allSelected ? 'Deselect All' : 'Select All'}
    </button>
  </div>

  <div class="toggle-buttons">
    {#each allOptions as option}
      <button
        type="button"
        class="toggle-btn {options[option.key] ? 'selected' : ''}"
        on:click={() => toggleOption(option.key)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .options-form {
    padding: 1rem;
    background: var(--gray-50);
    border-radius: 0.5rem;
  }
</style>
