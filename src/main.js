import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { loadSession } from './session.js';
import { installSteve } from './steve.js';
import '@fontsource/emilys-candy/400.css'; // the shop's decorated and script fonts, bundled so they look the same on every device
import '@fontsource/great-vibes/400.css';
import './style.css';

installSteve();

// Find out who is signed in before the first page is chosen, so there is no flash of the sign-in page.
loadSession()
  .catch((error) => {
    // Start up regardless (the sign-in page is shown), but leave a trace of why the session could not be read.
    console.error('Could not load the session:', error);
  })
  .finally(() => {
    createApp(App).use(router).mount('#app');
  });
