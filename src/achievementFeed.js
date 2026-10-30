// Achievement unlocks as they happen, wherever on the site the player is. The server tells the player's browser (on the site's
// own socket) that there is something new; the unlocks themselves are fetched from the API, and each is marked as shown once
// its pop-up has been seen, so a player who was away still gets them the next time they come back.
import { reactive } from 'vue';
import { io } from 'socket.io-client';
import { api, refreshShop } from './session.js';

/** `queue` holds the unlocks waiting for a pop-up: { id, level, game, name, text, coins }. */
export const feed = reactive({ queue: [] });

let socket = null;
const keyOf = (unlock) => `${unlock.id}:${unlock.level}`;

/** Asks the server what is new and queues what is not queued already. */
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

/** Starts listening (once). */
export function startFeed(connect = io) {
  if (socket) return;
  socket = connect();
  socket.on('connect', fetchPending);
  socket.on('achievements', fetchPending);
}

/** Stops listening and forgets what was waiting (the player has signed out). */
export function stopFeed() {
  socket?.close();
  socket = null;
  feed.queue.splice(0);
}

/** Takes these unlocks off the queue and tells the server they have been shown. */
export function shown(unlocks) {
  const keys = new Set(unlocks.map(keyOf));
  for (let i = feed.queue.length - 1; i >= 0; i--) if (keys.has(keyOf(feed.queue[i]))) feed.queue.splice(i, 1);
  api('POST', '/api/achievements/seen', { items: unlocks.map(({ id, level }) => ({ id, level })) }).catch(() => {});
}
