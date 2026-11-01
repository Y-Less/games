// Entry point: loads the session, then mounts the Vue app with the router.
// Depends on: vue, App.vue, router.js, i18n.js, session.js, steve.js, bundled fonts and style.css.
// Side effects: installs the console secret, fetches the session, mounts the app on #app.
import { createApp } from 'vue';
import App from './App.vue';
import { i18n } from './i18n.js';
import { router } from './router.js';
import { loadSession } from './session.js';
import { installSteve } from './steve.js';
import '@fontsource/emilys-candy/400.css'; // the shop's decorated and script fonts, bundled so they look the same on every device
import '@fontsource/great-vibes/400.css';
import './style.css';

installSteve();

// Find out who is signed in before the first page is chosen, so there is no flash of the sign-in page (and the
// language follows them: setUser applies it).
loadSession()
  .catch((error) => {
    // Start up regardless (the sign-in page is shown), but leave a trace of why the session could not be read.
    console.error('Could not load the session:', error);
  })
  .finally(() => {
    createApp(App).use(router).use(i18n).mount('#app');
  });
