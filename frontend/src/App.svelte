<script lang="ts">
  import Sync from './components/Sync.svelte';
  import Export from './components/Export.svelte';
  import Import from './components/Import.svelte';

  let activeTab: 'sync' | 'export' | 'import' = 'sync';
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
    </div>

    {#if activeTab === 'sync'}
      <Sync />
    {:else if activeTab === 'export'}
      <Export />
    {:else if activeTab === 'import'}
      <Import />
    {/if}
  </div>
</main>
