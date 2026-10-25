import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { loadSession } from './session.js';
import './style.css';

// Find out who is signed in before the first page is chosen, so there is no flash of the sign-in page.
loadSession()
  .catch(() => {})
  .finally(() => {
    createApp(App).use(router).mount('#app');
  });
