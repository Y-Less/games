// Who is signed in: loading the session at start-up, signing in, registering and signing out. The state itself is in
// sessionState.js, the API calls in api.js, the page's look in appearance.js, the shop in shopStore.js and profile
// changes in profileApi.js.
import { api, onUnauthorised } from './api.js';
import { applyUserLook } from './appearance.js';
import { refreshShop } from './shopStore.js';
import { session } from './sessionState.js';

export { session };

// A refused request means the session is gone (expired, or signed out elsewhere): forget the user here too, so the
// router's guard sends the next page to the sign-in screen and the page shows nothing of theirs.
onUnauthorised(() => {
  if (session.user) setUser(null);
});

/**
 * A `next` address that is safe to go to: a path on this site only (never an absolute URL, '//host' or '/\\host').
 * @param {*} next  the address asked for
 * @returns {string}  `next`, or '/' when it is not safe
 * Side effects: none.
 */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/';
}

/**
 * Makes `user` the signed-in user (null: nobody) and gives the page their look.
 * @param {object | null} user
 * @returns {void}
 * Side effects: sets session.user (clearing session.shop for nobody) and the page's CSS variables.
 */
export function setUser(user) {
  session.user = user;
  if (!user) session.shop = null;
  applyUserLook(user);
}

/**
 * Loads the game list, the presets and the signed-in user (if any).
 * @returns {Promise<void>}
 * Side effects: sets the session; session.ready becomes true even when loading fails (which then throws).
 */
export async function loadSession() {
  try {
    const [config, me] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/me')]);
    session.games = config.games;
    session.presets = config.backgrounds;
    session.cardBacks = config.cardBacks;
    setUser(me.user);
    await refreshShop();
  } finally {
    session.ready = true;
  }
}

/**
 * Posts credentials and signs in as the user that comes back.
 * @param {string} url  the login or register address
 * @param {object} body
 * @returns {Promise<void>}
 * Side effects: sets the session's user.
 */
async function enter(url, body) {
  const { user } = await api('POST', url, body);
  setUser(user);
}

/**
 * Signs in.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<void>}
 * @throws {Error} with the server's reason when refused
 * Side effects: sets the session's user.
 */
export const signIn = (username, password) => enter('/api/auth/login', { username, password });

/**
 * Makes an account and signs in as it.
 * @param {string} username
 * @param {string} password
 * @param {string} displayName
 * @returns {Promise<void>}
 * @throws {Error} with the server's reason when refused
 * Side effects: sets the session's user.
 */
export const register = (username, password, displayName) => enter('/api/auth/register', { username, password, displayName });

/**
 * Signs out.
 * @returns {Promise<void>}
 * Side effects: ends the session on the server and clears the session's user.
 */
export async function signOut() {
  await api('POST', '/api/auth/logout', {});
  setUser(null);
}
