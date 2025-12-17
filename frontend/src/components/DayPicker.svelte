<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { DAYS_OF_WEEK } from '../lib/scheduleUtils';

  export let selectedDays: number[] = [1];
  export let allowEmpty: boolean = false;

  const dispatch = createEventDispatcher<{
    change: number[];
  }>();

  function toggleDay(day: number) {
    if (selectedDays.includes(day)) {
      // Don't allow deselecting if it's the last day (unless allowEmpty is true)
      if (selectedDays.length > 1 || allowEmpty) {
        selectedDays = selectedDays.filter(d => d !== day);
        dispatch('change', selectedDays);
      }
    } else {
      selectedDays = [...selectedDays, day];
      dispatch('change', selectedDays);
    }
  }
</script>

<div class="day-picker">
  {#each DAYS_OF_WEEK as day}
    <button
      type="button"
      class="day-btn {selectedDays.includes(day.value) ? 'selected' : ''}"
      on:click={() => toggleDay(day.value)}
    >
      {day.label}
    </button>
  {/each}
</div>

<style>
  .day-picker {
    display: flex;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .day-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 2.5rem;
    border: 2px solid var(--border-color-strong);
    border-radius: 0.5rem;
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .day-btn:hover {
    border-color: var(--primary);
    color: var(--primary);
  }

  .day-btn.selected {
    border-color: var(--primary);
    background: var(--primary);
    color: #ffffff;
  }
</style>
