// What the site knows about other players' looks (their name style, later their avatar), fetched in batches from
// /api/players and kept for a minute, so a score bar of six chips costs one request. Your own profile is read from the
// session instead, so a change you make shows at once.
import { reactive } from 'vue';
import { api, session } from './session.js';

const MAX_AGE = 60 * 1000;
const profiles = reactive({}); // id -> { displayName, nameStyle }
const asked = new Map(); // id -> when it was last requested
let wanted = new Set();
let timer = null;

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

/** The public profile of a user ({ displayName, nameStyle }), or null until it has arrived. Asks for it when missing or old. */
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

/** Forgets everything fetched (after signing out, and in tests). */
export function clearProfiles() {
  for (const id of Object.keys(profiles)) delete profiles[id];
  asked.clear();
  wanted = new Set();
  clearTimeout(timer);
  timer = null;
}
