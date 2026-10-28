// Plays from lookup tables learned by simulation (modules/nomination-whist/sim). The bidding table gives, for every player
// count, number of cards and trump suit, the chance of each number of tricks for a hand of a given estimated worth; the AI
// nominates the allowed number with the best expected score. The play table gives the average points of each kind of play
// in each situation (my need, the state of the other players, the card), and the AI plays the best one. Without a table
// file it plays as Standard does.
import fs from 'node:fs';
import { cellOf } from '../sim/bids-features.js';
import { bestByValue, valueModel } from '../sim/value-model.js';
import { withLastChance } from './endgame.js';
import { bestPlay, loadPlayModel } from '../sim/play-model.js';
import { roundPoints } from './sharp.js';
import { nearestAllowed } from './cards.js';
import { canTakeAllSeven, chooseCard, estimateTricks } from './standard.js';

const BIDDING_FILE = new URL('../sim/models/bidding.json', import.meta.url);
let bidding; // undefined until first needed, then the table or null if there is none
let playing; // the same for the play table
const contextual = {}; // and for the bidding tables with table state: one for games without Jokers, one with
const CONTEXT_FILES = {
  false: new URL('../sim/models/bidding-context.json', import.meta.url),
  true: new URL('../sim/models/bidding-context-jokers.json', import.meta.url),
};

/**
 * Loads (once) the bidding table with table state for games with or without the Jokers, or null if there is none. The two
 * are separate tables because a Joker is worth most of a trick and changes what every other hand is worth.
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

/** The chances of each number of tricks given the hand and the nominations so far, or null if the table has no such row. */
export function contextChances(model, ctx) {
  const { key, unclaimed, after } = cellOf(ctx);
  return model.players[ctx.players]?.[ctx.hand.length]?.[ctx.trump ?? 'N']?.[key]?.[unclaimed]?.[after] ?? null;
}

/** The play table (loaded once); `set` replaces it, with null for none or undefined to load from the file again. */
export function playModel(set) {
  if (set !== undefined || playing === undefined) playing = set === undefined ? loadPlayModel() : set;
  return playing;
}

/** Loads (once) the bidding table; `reload` clears what was loaded, for tests and for use after retraining. */
export function biddingModel(reload = false) {
  if (reload) bidding = undefined;
  if (bidding === undefined) {
    try {
      bidding = JSON.parse(fs.readFileSync(BIDDING_FILE, 'utf8'));
    } catch {
      bidding = null;
    }
  }
  return bidding;
}

/** The chance of each number of tricks (index 0 to cards) for this hand, or null if the table has no row for it. */
export function trickChances(model, { hand, trump, players }) {
  const bucket = Math.round(estimateTricks(hand, trump, players) * model.estimateSteps);
  const rows = model.players[players]?.[hand.length]?.[trump ?? 'N'];
  return rows?.[Math.min(bucket, rows.length - 1)] ?? null;
}

/** The allowed nomination with the best expected round score under the given chances. */
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

/** Standard's guess at a nomination, with every card's weight turned up by `boost`: what the tables fall back to where they have no row. */
function guess({ hand, trump, players, allowed, rng = Math.random }, boost) {
  return nearestAllowed(allowed, estimateTricks(hand, trump, players, boost) + (rng() - 0.5) * 0.3);
}

/** The plain bidding table's nomination (or, when `boost` is set, the hand read straight from its boosted weights). */
function lutPlain(ctx, boost) {
  const { hand, trump, players, allowed, missPoints = true } = ctx;
  if (boost) return guess(ctx, boost); // nothing to lose: the boosted hand is read straight from its weights, not for points
  const model = biddingModel();
  const chances = model && trickChances(model, { hand, trump, players });
  return chances ? bestNomination(chances, allowed, missPoints) : guess(ctx, 0);
}

/** The table-aware table's nomination (or the boosted reading), falling back to the plain table. */
function lutcChoice(ctx, boost) {
  if (boost) return guess(ctx, boost);
  const model = contextModel(ctx.jokers);
  const chances = model && contextChances(model, ctx);
  return chances ? bestNomination(chances, ctx.allowed, ctx.missPoints ?? true) : lutPlain(ctx, 0);
}

/** Lookup that also reads the nominations made before it: a hand is worth more when the players before nominated low. */
export const lutc = {
  id: 'lutc',
  name: 'Lookup (table-aware)',
  description: 'Nominates from tables learned by simulation that also take account of how many tricks the players before have already claimed.',
  weight: 0,
  nominate(ctx) {
    const { hand, trump, allowed, instantWin = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => lutcChoice(ctx, boost));
  },
  play: (ctx) => lut.play(ctx),
};

/**
 * Nominates by what each nomination is actually worth: the bid-value table (sim/value-model.js) holds, for the exact cards of
 * a small hand (or the estimate of a bigger one), the table position and what the players before nominated, how often each
 * possible nomination was then hit and how many tricks were taken on a miss, with the player playing to the nomination. So
 * it knows that a high nomination on a good hand, played for, can beat the low one the hand would "naturally" make.
 * Where the table has nothing it falls back to `lutc`.
 */
export const lutv = {
  id: 'lutv',
  name: 'Lookup (bid values)',
  description: 'Nominates the number that was worth most in simulated games from hands, positions and earlier nominations like this one.',
  weight: 0,
  nominate(ctx) {
    const { hand, trump, allowed, instantWin = false, jokers = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => {
      if (boost) return guess(ctx, boost);
      const model = valueModel(jokers);
      return (model && bestByValue(model, ctx)) ?? lutcChoice(ctx, 0);
    });
  },
  play: (ctx) => lut.play(ctx),
};

export const lut = {
  id: 'lut',
  name: 'Lookup',
  description: 'Nominates from tables of how often hands like its own took each number of tricks, learned from millions of simulated deals.',
  weight: 0,
  nominate(ctx) {
    const { hand, trump, allowed, instantWin = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => lutPlain(ctx, boost));
  },
  play(ctx) {
    if (ctx.legal.length === 1) return ctx.legal[0];
    const model = playModel();
    return (model && bestPlay(model, ctx)) ?? chooseCard(ctx);
  },
};
