<script lang="ts">
  import type { SyncOptions } from '../types';

  export let options: SyncOptions = {};

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
  ];

  function toggleAll() {
    const allSelected = allOptions.every(opt => options[opt.key as keyof SyncOptions]);
    allOptions.forEach(opt => {
      options[opt.key as keyof SyncOptions] = !allSelected;
    });
  }

  $: allSelected = allOptions.every(opt => options[opt.key as keyof SyncOptions]);
</script>

<div class="options-form">
  <div class="flex items-center justify-between mb-2">
    <h3>Sync Options</h3>
    <button class="btn btn-secondary btn-sm" on:click={toggleAll}>
      {allSelected ? 'Deselect All' : 'Select All'}
    </button>
  </div>

  <div class="grid grid-3">
    {#each allOptions as option}
      <div class="checkbox-group">
        <input
          type="checkbox"
          id={option.key}
          class="form-checkbox"
          bind:checked={options[option.key]}
        />
        <label for={option.key}>{option.label}</label>
      </div>
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
