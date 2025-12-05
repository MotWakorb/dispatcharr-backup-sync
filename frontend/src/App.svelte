<script lang="ts">
  import Sync from './components/Sync.svelte';
  import Export from './components/Export.svelte';
  import Import from './components/Import.svelte';
  import Connections from './components/Connections.svelte';
  import Jobs from './components/Jobs.svelte';

  let activeTab: 'sync' | 'export' | 'import' | 'connections' | 'jobs' = 'sync';
</script>

<main>
  <div class="container">
    <header class="mb-3">
      <h1>Dispatcharr Manager</h1>
      <p class="text-gray">Backup, sync, and restore your Dispatcharr configuration</p>
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
        Export
      </button>
      <button
        class="tab"
        class:active={activeTab === 'import'}
        on:click={() => activeTab = 'import'}
      >
        Import
      </button>
      <button
        class="tab"
        class:active={activeTab === 'connections'}
        on:click={() => activeTab = 'connections'}
      >
        Connections
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
    {:else if activeTab === 'jobs'}
      <Jobs />
    {/if}
  </div>
</main>
