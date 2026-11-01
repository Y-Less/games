// Plays from lookup tables learned by simulation (modules/nomination-whist/sim). The bidding table gives, for every player
// count, number of cards and trump suit, the chance of each number of tricks for a hand of a given estimated worth; the AI
// nominates the allowed number with the best expected score. The play table gives the average points of each kind of play
// in each situation (my need, the state of the other players, the card), and the AI plays the best one. Without a table
// file it plays as Standard does. Depends on the helpers in ./cards.js, ./endgame.js, ./sharp.js (roundPoints) and
// ./standard.js, and on the learned tables and models under ../sim (read from disk, once, on first use).
import fs from 'node:fs';
import { cellOf } from '../sim/bids-features.js';
import { bestByValue, valueModel } from '../sim/value-model.js';
import { withLastChance } from './endgame.js';
import { bestByHandModel, handModel } from '../sim/hand-model.js';
import { bestPlay, loadPlayModel } from '../sim/play-model.js';
import { roundPoints } from './sharp.js';
import { nearestAllowed } from './cards.js';
import { canTakeAllSeven, chooseCard, estimateTricks } from './standard.js';

const BIDDING_FILES = {
  false: new URL('../sim/models/bidding.json', import.meta.url),
  true: new URL('../sim/models/bidding-jokers.json', import.meta.url),
};
const bidding = {}; // per Jokers setting: undefined until first needed, then the table or null if there is none
let playing; // the same for the play table
const contextual = {}; // and for the bidding tables with table state: one for games without Jokers, one with
const CONTEXT_FILES = {
  false: new URL('../sim/models/bidding-context.json', import.meta.url),
  true: new URL('../sim/models/bidding-context-jokers.json', import.meta.url),
};

/**
 * Loads (once) the bidding table with table state for games with or without the Jokers, or null if there is none. The two
 * are separate tables because a Joker is worth most of a trick and changes what every other hand is worth.
 *
 * @param {boolean} [jokers=false]  whether the game uses the Jokers
 * @param {boolean} [reload=false]  forget the cached table for this setting and read the file again
 * @returns {object | null} the table, or null if the file is missing or unreadable
 * Side effects: reads a JSON file from disk on first use (or on reload) and caches it in module state.
 */
export function contextModel(jokers = false, reload = false) {
  const key = jokers === true;
  if (reload) delete contextual[key];
  if (contextual[key] === undefined) {
    try {
      contextual[key] = JSON.parse(fs.readFileSync(CONTEXT_FILES[key], 'utf8'));
    } catch {
      contextual[key] = null;
    }
  }
  return contextual[key];
}

/**
 * The chances of each number of tricks given the hand and the nominations so far, or null if the table has no such row.
 *
 * @param {object} model  the table-aware bidding table
 * @param {object} ctx  the nomination context (hand, trump, players, nominations, seat and so on, as cellOf reads them)
 * @returns {number[] | null} the chance of taking 0..n tricks, or null
 * Side effects: none.
 */
export function contextChances(model, ctx) {
  const { key, unclaimed, after } = cellOf(ctx);
  return model.players[ctx.players]?.[ctx.hand.length]?.[ctx.trump ?? 'N']?.[key]?.[unclaimed]?.[after] ?? null;
}

/**
 * The play table (loaded once); `set` replaces it, with null for none or undefined to load from the file again.
 *
 * @param {object | null} [set]  a table to use instead, null for none, or omitted to load from the file
 * @returns {object | null} the current play table
 * Side effects: may read the play table from disk and replaces the cached one when `set` is given.
 */
export function playModel(set) {
  if (set !== undefined || playing === undefined) playing = set === undefined ? loadPlayModel() : set;
  return playing;
}

/**
 * Loads (once) the plain bidding table for games with or without the Jokers, or null if there is none. They are separate
 * tables, trained apart, because a Joker is worth most of a trick and changes what every other hand is worth.
 * `reload` clears what was loaded (both), for tests and for use after retraining.
 *
 * @param {boolean} [jokers=false]  whether the game uses the Jokers
 * @param {boolean} [reload=false]  forget both cached tables first
 * @returns {object | null} the table, or null if the file is missing or unreadable
 * Side effects: reads a JSON file from disk on first use and caches it in module state.
 */
export function biddingModel(jokers = false, reload = false) {
  const key = jokers === true;
  if (reload) for (const k of ['false', 'true']) delete bidding[k];
  if (bidding[key] === undefined) {
    try {
      bidding[key] = JSON.parse(fs.readFileSync(BIDDING_FILES[key], 'utf8'));
    } catch {
      bidding[key] = null;
    }
  }
  return bidding[key];
}

/**
 * Replaces what `biddingModel` has loaded for games with (`jokers` true) or without the Jokers: a table to use, null for none,
 * or undefined to read the file again. For tests.
 *
 * @param {boolean} jokers  which setting's table to replace
 * @param {object | null | undefined} model  the table, null for none, or undefined to clear the cache
 * @returns {void}
 * Side effects: mutates the cached bidding tables.
 */
export function useBiddingModel(jokers, model) {
  if (model === undefined) delete bidding[jokers === true];
  else bidding[jokers === true] = model;
}

/**
 * The chance of each number of tricks (index 0 to cards) for this hand, or null if the table has no row for it. The hand is
 * reduced to Standard's estimate, bucketed, and the row for that bucket (the last one if it is off the end) is returned.
 *
 * @param {object} model  the plain bidding table
 * @param {{hand: string[], trump: string | null, players: number}} situation  the hand and table
 * @returns {number[] | null} the chances, or null
 * Side effects: none.
 */
export function trickChances(model, { hand, trump, players }) {
  const bucket = Math.round(estimateTricks(hand, trump, players) * model.estimateSteps);
  const rows = model.players[players]?.[hand.length]?.[trump ?? 'N'];
  return rows?.[Math.min(bucket, rows.length - 1)] ?? null;
}

/**
 * The allowed nomination with the best expected round score under the given chances.
 *
 * @param {number[]} chances  the chance of taking 0..n tricks
 * @param {number[]} allowed  the nominations that may be made
 * @param {boolean} [missPoints=true]  whether a miss still scores the tricks taken
 * @returns {number} the best nomination (the first of equals)
 * Side effects: none.
 */
export function bestNomination(chances, allowed, missPoints = true) {
  let best = allowed[0];
  let bestScore = -Infinity;
  for (const bid of allowed) {
    let score = 0;
    for (let taken = 0; taken < chances.length; taken++) score += chances[taken] * roundPoints(bid, taken, { missPoints });
    if (score > bestScore) {
      best = bid;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Standard's guess at a nomination, with every card's weight turned up by `boost`: what the tables fall back to where they have no row.
 *
 * @param {object} ctx  the nomination context (hand, trump, players, allowed, rng)
 * @param {number} boost  extra weight for every card, 0 for none
 * @returns {number} the nomination
 * Side effects: advances ctx.rng.
 */
function guess({ hand, trump, players, allowed, rng }, boost) {
  return nearestAllowed(allowed, estimateTricks(hand, trump, players, boost) + (rng() - 0.5) * 0.3);
}

/**
 * The plain bidding table's nomination (or, when `boost` is set, the hand read straight from its boosted weights).
 * @param {object} ctx  the nomination context
 * @param {number} boost  extra weight for every card, 0 for none
 * @returns {number} the nomination
 * Side effects: may load the table from disk once. A Jokers game reads bidding-jokers.json, never the jokerless table (a
 * Joker changes what every hand is worth); if that file is missing Standard's estimate is used instead.
 */
function lutPlain(ctx, boost) {
  const { hand, trump, players, allowed, missPoints = true } = ctx;
  if (boost) return guess(ctx, boost); // nothing to lose: the boosted hand is read straight from its weights, not for points
  const model = biddingModel(ctx.jokers === true);
  const chances = model && trickChances(model, { hand, trump, players });
  return chances ? bestNomination(chances, allowed, missPoints) : guess(ctx, 0);
}

/**
 * The table-aware table's nomination (or the boosted reading), falling back to the plain table.
 * @param {object} ctx  the nomination context
 * @param {number} boost  extra weight for every card, 0 for none
 * @returns {number} the nomination
 * Side effects: may load the table for the game's Jokers setting from disk once.
 */
function lutcChoice(ctx, boost) {
  if (boost) return guess(ctx, boost);
  const model = contextModel(ctx.jokers);
  const chances = model && contextChances(model, ctx);
  return chances ? bestNomination(chances, ctx.allowed, ctx.missPoints ?? true) : lutPlain(ctx, 0);
}

/** Lookup that also reads the nominations made before it: a hand is worth more when the players before nominated low. Not offered to players (weight 0), kept as a fallback layer. */
export const lutc = {
  id: 'lutc',
  name: 'Lookup (table-aware)',
  description: 'Nominates from tables learned by simulation that also take account of how many tricks the players before have already claimed.',
  weight: 0,
  /**
   * Nominates from the table-aware table, or 7 when it can clearly take every trick and the instant win is on.
   *
   * @param {object} ctx  the nomination context
   * @returns {number} the nomination
   * Side effects: may load tables from disk once; may advance ctx.rng when falling back to the estimate.
   */
  nominate(ctx) {
    const { hand, trump, allowed, instantWin = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => lutcChoice(ctx, boost));
  },
  /**
   * Plays as the lookup AI does.
   *
   * @param {object} ctx  the play context
   * @returns {string} the card to play
   * Side effects: may load the play table from disk once.
   */
  play: (ctx) => lut.play(ctx),
};

/**
 * Nominates by what each nomination is actually worth: the hand model (sim/hand-model.js), a network learned from millions
 * of simulated deals that is shown every card of the hand, the table position and what the players before nominated, and
 * gives the chance of hitting each number and the tricks taken on a miss, with the player playing to the nomination. Where
 * it has no model it uses `lutvTable`, the older bid-value table, which squeezes a hand of three or more cards into one
 * estimate.
 */
export const lutv = {
  id: 'lutv',
  name: 'Statistician',
  description: 'Nominates the number that was worth most in millions of simulated games from hands, seats and earlier nominations like its own, then plays to it.',
  weight: 1.5,
  /**
   * Nominates from the hand model, falling back to the bid-value table, the table-aware table, and finally Standard's estimate.
   *
   * @param {object} ctx  the nomination context
   * @returns {number} the nomination
   * Side effects: may load models from disk once; may advance ctx.rng when falling back to the estimate.
   */
  nominate(ctx) {
    const { hand, trump, allowed, instantWin = false, jokers = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => {
      if (boost) return guess(ctx, boost);
      const model = handModel(jokers);
      return (model && bestByHandModel(model, ctx)) ?? valueChoice(ctx);
    });
  },
  /**
   * Plays as the lookup AI does.
   *
   * @param {object} ctx  the play context
   * @returns {string} the card to play
   * Side effects: may load the play table from disk once.
   */
  play: (ctx) => lut.play(ctx),
};

/**
 * The bid-value table's best nomination, or the table-aware lookup's where the table has nothing.
 *
 * @param {object} ctx  the nomination context
 * @returns {number} the nomination
 * Side effects: may load tables from disk once.
 */
function valueChoice(ctx) {
  const model = valueModel(ctx.jokers === true);
  return (model && bestByValue(model, ctx)) ?? lutcChoice(ctx, 0);
}

/**
 * The older bid-value table's nomination: the table (sim/value-model.js) holds, for the exact cards of a hand of one or two
 * cards (or the estimate of a bigger one), the table position and what the players before nominated, how often each
 * possible nomination was then hit and how many tricks were taken on a miss, with the player playing to the nomination.
 * Where the table has nothing it falls back to `lutc`. Kept as the fallback for `lutv`, and as the yardstick the hand model
 * is measured against.
 */
export const lutvTable = {
  id: 'lutv-table',
  name: 'Statistician (bid-value table)',
  description: 'Nominates the number that was worth most in simulated games from hands like its own, with a hand of three or more cards reduced to one estimate.',
  weight: 0,
  /**
   * Nominates from the bid-value table (see valueChoice for the fallbacks).
   *
   * @param {object} ctx  the nomination context
   * @returns {number} the nomination
   * Side effects: may load tables from disk once; may advance ctx.rng when falling back to the estimate.
   */
  nominate(ctx) {
    const { hand, trump, allowed, instantWin = false, jokers = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => {
      if (boost) return guess(ctx, boost);
      return valueChoice(ctx);
    });
  },
  /**
   * Plays as the lookup AI does.
   *
   * @param {object} ctx  the play context
   * @returns {string} the card to play
   * Side effects: may load the play table from disk once.
   */
  play: (ctx) => lut.play(ctx),
};

/** The plain lookup AI: nominates from the estimate-bucketed bidding table and plays from the learned play table. Not offered to players (weight 0). */
export const lut = {
  id: 'lut',
  name: 'Lookup',
  description: 'Nominates from tables of how often hands like its own took each number of tricks, learned from millions of simulated deals.',
  weight: 0,
  /**
   * Nominates from the plain bidding table, or 7 when it can clearly take every trick and the instant win is on.
   *
   * @param {object} ctx  the nomination context
   * @returns {number} the nomination
   * Side effects: may load the bidding table from disk once; may advance ctx.rng when falling back to the estimate.
   */
  nominate(ctx) {
    const { hand, trump, allowed, instantWin = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => lutPlain(ctx, boost));
  },
  /**
   * Plays the card the learned play table rates best, or Standard's choice when there is no table or no row.
   *
   * @param {object} ctx  the play context (legal cards plus the situation the table is keyed on)
   * @returns {string} the card to play
   * Side effects: may load the play table from disk once.
   */
  play(ctx) {
    if (ctx.legal.length === 1) return ctx.legal[0];
    const model = playModel();
    return (model && bestPlay(model, ctx)) ?? chooseCard(ctx);
  },
};
