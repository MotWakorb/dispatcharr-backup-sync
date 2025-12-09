<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { uploadPluginFiles } from '../api';
  import type { DispatcharrConnection, PluginInfo } from '../types';

  export let show = false;
  export let plugins: PluginInfo[] = [];
  export let connection: DispatcharrConnection;

  const dispatch = createEventDispatcher();

  let fileInput: HTMLInputElement;
  let selectedFiles: File[] = [];
  let uploading = false;
  let uploadProgress = 0;
  let uploadResult: { uploaded: number; errors: string[] } | null = null;
  let error: string | null = null;
  let dragging = false;

  function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const files = Array.from(target.files);
      // Auto-upload immediately
      uploadFilesNow(files);
      // Reset file input so the same file can be selected again
      target.value = '';
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (event.dataTransfer?.files?.length) {
      const files = Array.from(event.dataTransfer.files);
      // Auto-upload immediately
      uploadFilesNow(files);
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    dragging = true;
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    dragging = false;
  }

  async function uploadFilesNow(files: File[]) {
    if (files.length === 0) return;

    uploading = true;
    uploadProgress = 0;
    error = null;
    uploadResult = null;
    selectedFiles = files; // Show which files are being uploaded

    try {
      const result = await uploadPluginFiles(connection, files, (percent) => {
        uploadProgress = percent;
      });
      uploadResult = result;
      selectedFiles = [];
      if (result.uploaded > 0) {
        dispatch('uploaded', result);
      }
    } catch (err: any) {
      error = err.response?.data?.error || err.message || 'Failed to upload plugins';
      selectedFiles = [];
    } finally {
      uploading = false;
    }
  }

  function handleSkip() {
    dispatch('skip');
  }

  function handleClose() {
    dispatch('close');
  }

  function handleContinue() {
    dispatch('continue');
  }

  $: pluginNames = plugins.map(p => p.name || p.key).filter(Boolean);
</script>

{#if show}
  <div class="modal-overlay" role="presentation">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>Plugins Required</h3>
        <button class="close-btn" type="button" on:click={handleClose} aria-label="Close">
          &times;
        </button>
      </div>

      <div class="modal-body">
        <div class="alert alert-info mb-3">
          <strong>Note:</strong> The backup file contains settings for the following plugins.
          To successfully restore plugin settings, these plugins must be installed on the destination instance.
        </div>

        <div class="plugin-list mb-3">
          <h4>Plugins in backup:</h4>
          <ul>
            {#each plugins as plugin}
              <li>
                <span class="plugin-name">{plugin.name || plugin.key}</span>
                {#if plugin.key && plugin.name}
                  <span class="plugin-key">({plugin.key})</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>

        <div class="upload-section">
          <h4>Upload Plugin Files (Optional)</h4>
          <p class="text-sm text-gray mb-2">
            If you have plugin .zip files, you can upload them here to install before importing settings.
          </p>

          <div
            class={`dropzone ${dragging ? 'dragging' : ''}`}
            on:dragover={handleDragOver}
            on:dragleave={handleDragLeave}
            on:drop={handleDrop}
            on:click={() => !uploading && fileInput?.click()}
            on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && !uploading && fileInput?.click()}
            role="button"
            tabindex="0"
          >
            <input
              type="file"
              class="sr-only"
              accept=".zip"
              multiple
              on:change={handleFileSelect}
              bind:this={fileInput}
            />
            <p class="text-sm">
              {#if uploading}
                <span class="spinner inline-spinner"></span>
                Uploading {selectedFiles.length} plugin{selectedFiles.length > 1 ? 's' : ''}... {uploadProgress}%
              {:else if dragging}
                Drop plugin .zip files here
              {:else}
                Drag & drop plugin .zip files here, or click to choose
              {/if}
            </p>
          </div>

          {#if error}
            <div class="alert alert-error mt-2">{error}</div>
          {/if}

          {#if uploadResult}
            <div class="alert {uploadResult.errors.length > 0 ? 'alert-warning' : 'alert-success'} mt-2">
              {#if uploadResult.uploaded > 0}
                <p>Successfully uploaded {uploadResult.uploaded} plugin(s).</p>
              {/if}
              {#if uploadResult.errors.length > 0}
                <p>Errors:</p>
                <ul>
                  {#each uploadResult.errors as err}
                    <li>{err}</li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" on:click={handleSkip} disabled={uploading}>
          Skip Plugin Upload
        </button>
        <button class="btn btn-primary" type="button" on:click={handleContinue} disabled={uploading}>
          Continue with Import
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1001;
    padding: 1rem;
  }

  .modal {
    width: min(600px, 95%);
    max-height: 85vh;
    background: #fff;
    border-radius: 0.75rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--gray-200);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.125rem;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--gray-500);
    line-height: 1;
    padding: 0.25rem;
  }

  .close-btn:hover {
    color: var(--gray-800);
  }

  .modal-body {
    padding: 1.25rem;
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--gray-200);
  }

  .plugin-list {
    background: var(--gray-50);
    padding: 1rem;
    border-radius: 0.5rem;
  }

  .plugin-list h4 {
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
  }

  .plugin-list ul {
    margin: 0;
    padding-left: 1.5rem;
  }

  .plugin-list li {
    margin: 0.25rem 0;
  }

  .plugin-name {
    font-weight: 500;
  }

  .plugin-key {
    color: var(--gray-500);
    font-size: 0.85rem;
  }

  .upload-section h4 {
    margin: 0 0 0.25rem 0;
    font-size: 0.9rem;
  }

  .dropzone {
    border: 2px dashed var(--gray-300);
    background: var(--gray-50);
    padding: 1.5rem;
    border-radius: 0.5rem;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }

  .dropzone.dragging {
    border-color: var(--primary);
    background: #e0ecff;
  }

  .dropzone:hover {
    border-color: var(--gray-400);
  }

  .mb-2 {
    margin-bottom: 0.5rem;
  }

  .mb-3 {
    margin-bottom: 1rem;
  }

  .mt-1 {
    margin-top: 0.25rem;
  }

  .mt-2 {
    margin-top: 0.5rem;
  }

  .inline-spinner {
    display: inline-block;
    vertical-align: middle;
    margin-right: 0.25rem;
  }
</style>
