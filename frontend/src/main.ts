import './app.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { getSettings } from './api';
import type { Theme } from './types';

// Apply theme to document
function applyTheme(theme: Theme) {
  document.documentElement.classList.remove('light', 'dark');
  if (theme !== 'auto') {
    document.documentElement.classList.add(theme);
  }
}

// Load and apply theme before mounting
async function initApp() {
  try {
    const settings = await getSettings();
    applyTheme(settings.theme || 'auto');
  } catch (err) {
    // If settings fail to load, auto theme will apply via CSS media query
    console.warn('Failed to load theme settings:', err);
  }

  const target = document.getElementById('app');
  console.log('Mounting App', { targetExists: !!target });

  if (target) {
    mount(App, { target });
  }
}

initApp();
