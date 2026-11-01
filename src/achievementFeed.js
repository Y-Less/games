// Achievement unlocks as they happen, wherever on the site the player is. The server tells the player's browser (on the site's
// own socket) that there is something new; the unlocks themselves are fetched from the API, and each is marked as shown once
// its pop-up has been seen, so a player who was away still gets them the next time they come back.
// Depends on: vue, socket.io-client, api.js and shopStore.js (the coin balance is refreshed on new unlocks).
import { reactive } from 'vue';
import { io } from 'socket.io-client';
import { api } from './api.js';
import { refreshShop } from './shopStore.js';

/** `queue` holds the unlocks waiting for a pop-up: { id, level, game, name, text, coins }. */
export const feed = reactive({ queue: [] });

// The site socket once started, else null.
let socket = null;
/**
 * A unlock's identity in the queue.
 * @param {{ id: string, level: number }} unlock
 * @returns {string}
 * Side effects: none.
 */
const keyOf = (unlock) => `${unlock.id}:${unlock.level}`;

/**
 * Asks the server what is new and queues what is not queued already.
 * @returns {Promise<void>}
 * Side effects: one request; adds to feed.queue and refreshes the shop (the coins have changed) when something is new.
 */
export async function fetchPending() {
  try {
    const { unlocks } = await api('GET', '/api/achievements/pending');
    const known = new Set(feed.queue.map(keyOf));
    for (const unlock of unlocks) if (!known.has(keyOf(unlock))) feed.queue.push(unlock);
    if (unlocks.length) refreshShop(); // the coins have changed
  } catch {
    /* signed out, or the server is away: the next event or reconnection asks again */
  }
}

/**
 * Starts listening (once).
 * @param {() => import('socket.io-client').Socket} [connect]  makes the site socket (replaceable in tests)
 * @returns {void}
 * Side effects: opens the site socket and asks for what is pending on every connection and 'achievements' event.
 */
export function startFeed(connect = io) {
  if (socket) return;
  socket = connect();
  socket.on('connect', fetchPending);
  socket.on('achievements', fetchPending);
}

/**
 * Stops listening and forgets what was waiting (the player has signed out).
 * @returns {void}
 * Side effects: closes the socket and empties feed.queue.
 */
export function stopFeed() {
  socket?.close();
  socket = null;
  feed.queue.splice(0);
}

/**
 * Takes these unlocks off the queue and tells the server they have been shown.
 * @param {Array<{ id: string, level: number }>} unlocks
 * @returns {void}
 * Side effects: edits feed.queue and posts to /api/achievements/seen (failures are ignored).
 */
export function shown(unlocks) {
  const keys = new Set(unlocks.map(keyOf));
  for (let i = feed.queue.length - 1; i >= 0; i--) if (keys.has(keyOf(feed.queue[i]))) feed.queue.splice(i, 1);
  api('POST', '/api/achievements/seen', { items: unlocks.map(({ id, level }) => ({ id, level })) }).catch(() => {});
}
