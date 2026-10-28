// The bid-value table: for each situation (value-features.js) and each nomination that can be made in it, how often the
// player then hit it exactly and how many tricks they took when they missed, learned from deals in which every nomination
// was tried (value-collect.js) and the player then played to it. That is what a nomination is worth, whatever the hand
// would "naturally" have nominated, so it knows that a high nomination on a good hand is worth a different amount than
// the same hand nominating low and ducking. The AI nominates the allowed number with the best expected score.
//
// On disk (models/bidding-values.json, and bidding-values-jokers.json for games with the Jokers):
//   players[count][regime][cards][key][unclaimed][after] = [ [pHit, mMiss] | null for nomination 0, 1, ... ] | null
// where pHit is the chance of hitting the nomination and mMiss the tricks taken on a miss, averaged over all deals.
import fs from 'node:fs';
import { valueCell } from './value-features.js';

export const VALUE_FILES = {
  false: new URL('./models/bidding-values.json', import.meta.url),
  true: new URL('./models/bidding-values-jokers.json', import.meta.url),
};
const loaded = {};

/** The table for games without (or with) the Jokers, loaded once; null if there is none. `reload` forgets what was loaded. */
export function valueModel(jokers = false, reload = false) {
  const key = jokers === true;
  if (reload) delete loaded[key];
  if (loaded[key] === undefined) {
    try {
      loaded[key] = JSON.parse(fs.readFileSync(VALUE_FILES[key], 'utf8'));
    } catch {
      loaded[key] = null;
    }
  }
  return loaded[key];
}

/** What the table holds for this situation: an array with an entry per nomination, or null if it has none. */
export function valueRow(model, ctx, boost = 0) {
  const { key, unclaimed, after, regime } = valueCell(ctx, boost);
  return model.players[ctx.players]?.[regime]?.[ctx.hand.length]?.[key]?.[unclaimed]?.[after] ?? null;
}

/** The expected points of nominating `bid` from a table entry. A miss scores the tricks taken, if misses score. */
export const expectedPoints = (entry, bid, missPoints = true) => entry[0] * (10 + bid) + (missPoints ? entry[1] : 0);

/**
 * The allowed nomination with the best expected points, or null if the table knows nothing about the allowed ones here.
 * Only nominations the table has data for are considered.
 */
export function bestByValue(model, ctx, boost = 0) {
  const row = valueRow(model, ctx, boost);
  if (!row) return null;
  const { allowed, missPoints = true } = ctx;
  let best = null;
  let bestPoints = -Infinity;
  for (const bid of allowed) {
    const entry = row[bid];
    if (!entry) continue;
    const points = expectedPoints(entry, bid, missPoints);
    if (points > bestPoints) {
      best = bid;
      bestPoints = points;
    }
  }
  return best;
}
