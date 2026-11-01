// What the site knows about other players' looks (their name style and avatar), fetched in batches from
// /api/players and kept for a minute, so a score bar of six chips costs one request. Your own profile is read from the
// session instead, so a change you make shows at once.
// Depends on: vue, api.js and session.js (for your own profile).
import { reactive } from 'vue';
import { api } from './api.js';
import { session } from './session.js';

// How long a fetched profile is trusted before it is asked for again (ms).
const MAX_AGE = 60 * 1000;
const profiles = reactive({}); // id -> { displayName, nameStyle, avatar }
const asked = new Map(); // id -> when it was last requested
let wanted = new Set(); // ids queued for the next batch
let timer = null; // the pending batch timer, or null

/**
 * Fetches the profiles asked for since the last batch.
 * @returns {Promise<void>}
 * Side effects: one request; fills `profiles`; clears the wanted set and the timer. A failed request is ignored.
 */
async function fetchWanted() {
  timer = null;
  const ids = [...wanted];
  wanted = new Set();
  if (!ids.length) return;
  try {
    const { players } = await api('GET', `/api/players?ids=${ids.join(',')}`);
    for (const [id, profile] of Object.entries(players)) profiles[id] = profile;
  } catch {
    // The names still show; they just stay plain.
  }
}

/**
 * The public profile of a user ({ displayName, nameStyle, avatar }), or null until it has arrived. Asks for it when missing or old.
 * @param {number} userId
 * @returns {object | null}
 * Side effects: may queue a batched request.
 */
export function profileOf(userId) {
  if (!Number.isInteger(userId)) return null;
  if (userId === session.user?.id) return session.user;
  const last = asked.get(userId);
  if (last === undefined || Date.now() - last > MAX_AGE) {
    asked.set(userId, Date.now());
    wanted.add(userId);
    timer ??= setTimeout(fetchWanted, 20);
  }
  return profiles[userId] ?? null;
}

/**
 * Forgets everything fetched (after signing out, and in tests).
 * @returns {void}
 * Side effects: empties the cache, the wanted set and the pending timer.
 */
export function clearProfiles() {
  for (const id of Object.keys(profiles)) delete profiles[id];
  asked.clear();
  wanted = new Set();
  clearTimeout(timer);
  timer = null;
}
