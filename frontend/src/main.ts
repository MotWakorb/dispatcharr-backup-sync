import './app.css';
import App from './App.svelte';
import { mount } from 'svelte';

const target = document.getElementById('app');
console.log('Mounting App', { targetExists: !!target });

if (target) {
  mount(App, { target });
}
