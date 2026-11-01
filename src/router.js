// The client-side routes and the sign-in guard.
// Depends on: vue-router, session.js (who is signed in, safeNext) and the lazily loaded views.
import { createRouter, createWebHistory } from 'vue-router';
import { safeNext, session } from './session.js';

// Each view is imported lazily so a page's code is only fetched when it is first visited.
const routes = [
  { path: '/', name: 'games', component: () => import('./views/GamesView.vue') },
  { path: '/login', name: 'login', component: () => import('./views/AuthView.vue'), meta: { public: true } },
  { path: '/play/:game', name: 'play', component: () => import('./views/PlayView.vue'), props: true },
  { path: '/profile', name: 'profile', component: () => import('./views/ProfileView.vue') },
  { path: '/shop/:tab(names|backgrounds|themes|card-backs|avatar|unlocks)?', name: 'shop', component: () => import('./views/ShopView.vue') },
  { path: '/achievements', name: 'achievements', component: () => import('./views/AchievementsView.vue') },
  { path: '/stats', name: 'stats', component: () => import('./views/StatsView.vue') },
  // Links sent out by earlier versions of the Dixnt game.
  { path: '/invite', redirect: (to) => ({ path: '/play/dixnt', query: to.query }) },
  { path: '/:rest(.*)*', redirect: '/' },
];

// The app's router (installed by main.js with app.use(router)).
export const router = createRouter({ history: createWebHistory(), routes });

// Everything except the sign-in page needs an account. The page you wanted is remembered, so an invite link still
// works after signing in.
// @param {object} to  the route being entered; @returns {true|object|string} true to continue or a redirect location.
// Side effects: none (the redirect is performed by vue-router).
router.beforeEach((to) => {
  if (!session.ready) return true; // main.js starts the router once the session is known
  if (!session.user && !to.meta.public) return { name: 'login', query: { next: to.fullPath } };
  if (session.user && to.name === 'login') return safeNext(to.query.next);
  return true;
});
