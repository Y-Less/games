// Plays from lookup tables learned by simulation (modules/nomination-whist/sim). The bidding table gives, for every player
// count, number of cards and trump suit, the chance of each number of tricks for a hand of a given estimated worth; the AI
// nominates the allowed number with the best expected score. The play table gives the average points of each kind of play
// in each situation (my need, the state of the other players, the card), and the AI plays the best one. Without a table
// file it plays as Standard does.
import fs from 'node:fs';
import { bestPlay, loadPlayModel } from '../sim/play-model.js';
import { roundPoints } from './sharp.js';
import { canTakeAllSeven, chooseCard, chooseNomination, estimateTricks } from './standard.js';

const BIDDING_FILE = new URL('../sim/models/bidding.json', import.meta.url);
let bidding; // undefined until first needed, then the table or null if there is none
let playing; // the same for the play table

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

export const lut = {
  id: 'lut',
  name: 'Lookup',
  description: 'Nominates from tables of how often hands like its own took each number of tricks, learned from millions of simulated deals.',
  weight: 0,
  nominate(ctx) {
    const { hand, trump, players, allowed, instantWin = false, missPoints = true } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    const model = biddingModel();
    const chances = model && trickChances(model, { hand, trump, players });
    return chances ? bestNomination(chances, allowed, missPoints) : chooseNomination(ctx);
  },
  play(ctx) {
    if (ctx.legal.length === 1) return ctx.legal[0];
    const model = playModel();
    return (model && bestPlay(model, ctx)) ?? chooseCard(ctx);
  },
};
