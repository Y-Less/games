import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { loadSession } from './session.js';
import '@fontsource/emilys-candy/400.css'; // the shop's decorated and script fonts, bundled so they look the same on every device
import '@fontsource/great-vibes/400.css';
import './style.css';

// Find out who is signed in before the first page is chosen, so there is no flash of the sign-in page.
loadSession()
  .catch(() => {})
  .finally(() => {
    createApp(App).use(router).mount('#app');
  });
