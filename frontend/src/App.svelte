<script lang="ts">
  import { onMount } from 'svelte';
  import Sync from './components/Sync.svelte';
  import Export from './components/Export.svelte';
  import Import from './components/Import.svelte';
  import Connections from './components/Connections.svelte';
  import Jobs from './components/Jobs.svelte';
  import Schedules from './components/Schedules.svelte';
  import Notifications from './components/Notifications.svelte';
  import { getVersionInfo } from './api';
  import type { VersionInfo } from './types';

  console.log('App component init');

  let activeTab: 'sync' | 'export' | 'import' | 'connections' | 'jobs' | 'schedules' | 'notifications' = 'sync';

  let versionInfo: VersionInfo | null = null;
  let bannerDismissed = false;

  onMount(async () => {
    // Check if banner was dismissed this session
    bannerDismissed = sessionStorage.getItem('updateBannerDismissed') === 'true';

    try {
      versionInfo = await getVersionInfo();
    } catch (err) {
      console.warn('Failed to fetch version info:', err);
    }
  });

  function dismissBanner() {
    bannerDismissed = true;
    sessionStorage.setItem('updateBannerDismissed', 'true');
  }

  $: showUpdateBanner = versionInfo?.updateAvailable && !bannerDismissed;
</script>

<main>
  <div class="container">
    {#if showUpdateBanner}
      <div class="update-banner">
        <span>
          A new version ({versionInfo?.latestVersion}) is available!
          {#if versionInfo?.releaseUrl}
            <a href={versionInfo.releaseUrl} target="_blank" rel="noopener noreferrer">View release</a>
          {/if}
        </span>
        <button class="banner-dismiss" on:click={dismissBanner} aria-label="Dismiss">×</button>
      </div>
    {/if}

    <header class="mb-3">
      <div class="header-content">
        <div>
          <h1>DBAS: Dispatcharr Backup and Sync</h1>
          <p class="text-gray">Backup, sync, and restore your Dispatcharr configuration</p>
        </div>
        {#if versionInfo?.currentVersion}
          <span class="version-badge">v{versionInfo.currentVersion}</span>
        {/if}
      </div>
    </header>

    <div class="tabs">
      <button
        class="tab"
        class:active={activeTab === 'sync'}
        on:click={() => activeTab = 'sync'}
      >
        Sync
      </button>
      <button
        class="tab"
        class:active={activeTab === 'export'}
        on:click={() => activeTab = 'export'}
      >
        Backup
      </button>
      <button
        class="tab"
        class:active={activeTab === 'import'}
        on:click={() => activeTab = 'import'}
      >
        Restore
      </button>
      <button
        class="tab"
        class:active={activeTab === 'connections'}
        on:click={() => activeTab = 'connections'}
      >
        Settings
      </button>
      <button
        class="tab"
        class:active={activeTab === 'schedules'}
        on:click={() => activeTab = 'schedules'}
      >
        Schedules
      </button>
      <button
        class="tab"
        class:active={activeTab === 'notifications'}
        on:click={() => activeTab = 'notifications'}
      >
        Notifications
      </button>
      <button
        class="tab"
        class:active={activeTab === 'jobs'}
        on:click={() => activeTab = 'jobs'}
      >
        Jobs
      </button>
    </div>

    {#if activeTab === 'sync'}
      <Sync />
    {:else if activeTab === 'export'}
      <Export />
    {:else if activeTab === 'import'}
      <Import />
    {:else if activeTab === 'connections'}
      <Connections />
    {:else if activeTab === 'schedules'}
      <Schedules />
    {:else if activeTab === 'notifications'}
      <Notifications />
    {:else if activeTab === 'jobs'}
      <Jobs />
    {/if}
  </div>
</main>
