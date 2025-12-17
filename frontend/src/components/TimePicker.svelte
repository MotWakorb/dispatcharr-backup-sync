<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { TimeFormat } from '../types';
  import { parseTypedTime, hour24ToDisplayTime } from '../lib/scheduleUtils';

  export let hour24: number = 2;
  export let minute: number = 0;
  export let timeFormat: TimeFormat = '12h';
  export let id: string = 'time-picker';
  export let label: string = 'Time';

  const dispatch = createEventDispatcher<{
    change: { hour24: number; minute: number };
    error: string | null;
  }>();

  let typedHour: string;
  let typedMinute: string;
  let ampm: 'AM' | 'PM';
  let error: string | null = null;

  // Initialize display values from hour24
  $: {
    const display = hour24ToDisplayTime(hour24, minute, timeFormat);
    typedHour = display.typedHour;
    typedMinute = display.typedMinute;
    ampm = display.ampm;
  }

  function handleTimeChange() {
    const result = parseTypedTime(typedHour, typedMinute, ampm, timeFormat);
    error = result.error;
    dispatch('error', error);

    if (!result.error) {
      hour24 = result.hour24;
      minute = result.minute;
      dispatch('change', { hour24: result.hour24, minute: result.minute });
    }
  }

  function setAmPm(value: 'AM' | 'PM') {
    ampm = value;
    handleTimeChange();
  }
</script>

<div class="form-group">
  <label class="form-label" for={id}>{label}</label>
  <div class="time-input-group">
    <input
      {id}
      type="text"
      class="form-input time-input"
      placeholder={timeFormat === '12h' ? 'HH' : 'HH'}
      maxlength="2"
      bind:value={typedHour}
      on:blur={handleTimeChange}
    />
    <span class="time-separator">:</span>
    <input
      type="text"
      class="form-input time-input"
      placeholder="MM"
      maxlength="2"
      bind:value={typedMinute}
      on:blur={handleTimeChange}
    />
    {#if timeFormat === '12h'}
      <div class="ampm-toggle">
        <button
          type="button"
          class="ampm-btn {ampm === 'AM' ? 'selected' : ''}"
          on:click={() => setAmPm('AM')}
        >AM</button>
        <button
          type="button"
          class="ampm-btn {ampm === 'PM' ? 'selected' : ''}"
          on:click={() => setAmPm('PM')}
        >PM</button>
      </div>
    {/if}
  </div>
  {#if error}
    <p class="time-error">{error}</p>
  {/if}
</div>

<style>
  .time-input-group {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .time-input {
    width: 3rem;
    text-align: center;
    padding: 0.5rem;
  }

  .time-separator {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .ampm-toggle {
    display: flex;
    margin-left: 0.5rem;
  }

  .ampm-btn {
    padding: 0.5rem 0.75rem;
    border: 2px solid var(--border-color-strong);
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .ampm-btn:first-child {
    border-radius: 0.375rem 0 0 0.375rem;
    border-right: 1px solid var(--border-color-strong);
  }

  .ampm-btn:last-child {
    border-radius: 0 0.375rem 0.375rem 0;
    border-left: 1px solid var(--border-color-strong);
  }

  .ampm-btn:hover {
    background: var(--bg-hover);
  }

  .ampm-btn.selected {
    border-color: var(--primary);
    background: var(--primary);
    color: #ffffff;
  }

  .time-error {
    color: var(--danger);
    font-size: 0.75rem;
    margin-top: 0.25rem;
    margin-bottom: 0;
  }
</style>
