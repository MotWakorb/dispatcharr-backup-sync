<script lang="ts">
  import LoadingSpinner from './LoadingSpinner.svelte';

  export let loading = false;
  export let message = 'Loading...';
  export let blur = true;
</script>

<div class="loading-overlay-container">
  <slot />
  {#if loading}
    <div class="loading-overlay" class:blur aria-busy="true">
      <LoadingSpinner size="lg" {message} />
    </div>
  {/if}
</div>

<style>
  .loading-overlay-container {
    position: relative;
    min-height: 100px;
  }

  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--overlay-bg, rgba(17, 24, 39, 0.8));
    z-index: 10;
    border-radius: inherit;
  }

  .loading-overlay.blur {
    backdrop-filter: blur(2px);
  }
</style>
