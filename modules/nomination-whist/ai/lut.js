// Plays from lookup tables learned by simulation (modules/nomination-whist/sim). The bidding table gives, for every player
// count, number of cards and trump suit, the chance of each number of tricks for a hand of a given estimated worth; the AI
// nominates the allowed number with the best expected score. The play table gives the average points of each kind of play
// in each situation (my need, the state of the other players, the card), and the AI plays the best one. Without a table
// file it plays as Standard does.
import fs from 'node:fs';
import { cellOf } from '../sim/bids-features.js';
import { bestByValue, valueModel } from '../sim/value-model.js';
import { lastChanceBoost } from './endgame.js';
import { bestPlay, loadPlayModel } from '../sim/play-model.js';
import { roundPoints } from './sharp.js';
import { canTakeAllSeven, chooseCard, chooseNomination, estimateTricks } from './standard.js';

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
export function contextChances(model, ctx, boost = 0) {
  const { key, unclaimed, after } = cellOf(ctx, boost);
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
export function trickChances(model, { hand, trump, players, boost = 0 }) {
  const bucket = Math.round(estimateTricks(hand, trump, players, boost) * model.estimateSteps);
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

/** Lookup that also reads the nominations made before it: a hand is worth more when the players before nominated low. */
export const lutc = {
  id: 'lutc',
  name: 'Lookup (table-aware)',
  description: 'Nominates from tables learned by simulation that also take account of how many tricks the players before have already claimed.',
  weight: 0,
  nominate(ctx) {
    const { hand, trump, allowed, instantWin = false, missPoints = true, jokers = false } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    const boost = lastChanceBoost(ctx);
    const model = contextModel(jokers);
    const chances = model && contextChances(model, ctx, boost);
    return chances ? bestNomination(chances, allowed, missPoints) : lut.nominate(ctx);
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
    const boost = lastChanceBoost(ctx);
    const model = valueModel(jokers);
    return (model && bestByValue(model, ctx, boost)) ?? lutc.nominate(ctx);
  },
  play: (ctx) => lut.play(ctx),
};

export const lut = {
  id: 'lut',
  name: 'Lookup',
  description: 'Nominates from tables of how often hands like its own took each number of tricks, learned from millions of simulated deals.',
  weight: 0,
  nominate(ctx) {
    const { hand, trump, players, allowed, instantWin = false, missPoints = true } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    const boost = lastChanceBoost(ctx);
    const model = biddingModel();
    const chances = model && trickChances(model, { hand, trump, players, boost });
    return chances ? bestNomination(chances, allowed, missPoints) : chooseNomination(ctx);
  },
  play(ctx) {
    if (ctx.legal.length === 1) return ctx.legal[0];
    const model = playModel();
    return (model && bestPlay(model, ctx)) ?? chooseCard(ctx);
  },
};
