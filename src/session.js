// The site's client-side state: who is signed in, the list of games, and the user's chosen background.
import { reactive } from 'vue';

export const session = reactive({
  ready: false, // true once we know whether anyone is signed in
  user: null,
  games: [],
  presets: {},
  cardBacks: {},
  shop: null, // { balance, items: [{ id, type, name, price, owned }] } once fetched: what is for sale and your coins
});

/** A `next` address that is safe to go to: a path on this site only (never an absolute URL, '//host' or '/\\host'). Otherwise '/'. */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/';
}

/** Calls the API and returns the parsed body. Throws an Error with the server's message on failure. */
export async function api(method, url, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(data?.error ?? `Something went wrong (${res.status}).`);
  return data;
}

/** The CSS image for a background setting. Anything unrecognised falls back to the default night sky. */
export function backgroundCss(background, presets = session.presets) {
  if (background?.type === 'preset' && presets[background.value]) return presets[background.value];
  if (background?.type === 'colour') return `linear-gradient(${background.value}, ${background.value})`;
  if (background?.type === 'gradient') return `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`;
  if (background?.type === 'image') return `linear-gradient(rgb(0 0 0 / 0.25), rgb(0 0 0 / 0.25)), url(/uploads/${encodeURIComponent(background.file)})`;
  return presets.night ?? '';
}

/** The CSS background for a card back. Card games draw every face-down card with this (see .card-back in style.css). */
export function cardBackCss(cardBack, presets = session.cardBacks) {
  if (cardBack?.type === 'image') return `url(/uploads/${encodeURIComponent(cardBack.file)}) center / cover no-repeat`;
  return presets[cardBack?.value] ?? presets.crimson ?? '#6b1a27';
}

export function applyBackground(background) {
  document.documentElement.style.setProperty('--site-bg', backgroundCss(background));
}

function setUser(user) {
  session.user = user;
  if (!user) session.shop = null;
  applyBackground(user?.background);
  document.documentElement.style.setProperty('--card-back', cardBackCss(user?.cardBack));
}

/** Fetches the shop's listing and your coin balance (call again after anything that can change them). */
export async function refreshShop() {
  if (!session.user) return;
  try {
    session.shop = await api('GET', '/api/shop');
  } catch {
    // the balance and locks just stay as they were
  }
}

/** Whether you may use an item: true for anything not known to be for sale (before the listing has arrived, nothing is locked). */
export function owns(itemId) {
  const item = session.shop?.items.find((i) => i.id === itemId);
  return item ? item.owned : true;
}

/** Buys an item with coins. Throws with the server's reason (not enough coins ...). */
export async function buy(itemId) {
  await api('POST', '/api/shop/buy', { item: itemId });
  await refreshShop();
}

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

async function enter(url, body) {
  const { user } = await api('POST', url, body);
  setUser(user);
}

export const signIn = (username, password) => enter('/api/auth/login', { username, password });
export const register = (username, password, displayName) => enter('/api/auth/register', { username, password, displayName });

export async function signOut() {
  await api('POST', '/api/auth/logout', {});
  setUser(null);
}

export async function updateProfile(changes) {
  const { user } = await api('PATCH', '/api/me', changes);
  setUser(user);
}

export async function uploadBackground(file) {
  const res = await fetch('/api/me/background-image', { method: 'POST', headers: { 'content-type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Could not upload that image.');
  setUser(data.user);
}

export async function uploadCardBack(file) {
  const res = await fetch('/api/me/card-back-image', { method: 'POST', headers: { 'content-type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Could not upload that image.');
  setUser(data.user);
}

export const changePassword = (currentPassword, newPassword) => api('POST', '/api/me/password', { currentPassword, newPassword });
