// Collects the data for the bidding table with table state: deals are played with every seat nominating from the current
// bidding table and playing as Standard does, and for each nomination the cell of the decision (bids-features.js) is
// counted against the number of tricks that player went on to take (with the two Jokers shuffled in if `jokers` is set). The nominations that others see are the ones the
// table's own players make, so the table learns what hands are worth against opponents who bid like it.
// Runs in worker threads: `collectChunk` is the unit of work, and this file is the worker's entry point.
import { parentPort, workerData } from 'node:worker_threads';
import { lut } from '../ai/lut.js';
import { chooseCard } from '../ai/standard.js';
import { TRUMP_ORDER } from '../game.js';
import { AFTER_BUCKETS, cellOf } from './bids-features.js';
import { playRound } from './game.js';
import { mixSeed, mulberry32 } from './rng.js';

export const PLAYER_COUNTS = 5; // 3 to 7
export const MAX_CARDS = 7;
export const TRUMPS = TRUMP_ORDER.length; // H, C, D, S, none
export const MAX_KEY = 54; // the biggest key: one of the 52 cards or 2 Jokers in a one-card round (otherwise an estimate, at most 4 x 7 + 1)
export const MAX_UNCLAIMED = MAX_CARDS + 3; // -2 to 7
export const MAX_TAKEN = MAX_CARDS + 1;
export const CELLS = PLAYER_COUNTS * MAX_CARDS * TRUMPS * MAX_KEY * MAX_UNCLAIMED * AFTER_BUCKETS * MAX_TAKEN;

/**
 * The index of one count in the flat counts array: players, cards, trump, then the cell (key, unclaimed, after), then tricks taken.
 * @param {number} players  seats at the table (3 to 7)
 * @param {number} cards  cards each in the round (1 to 7)
 * @param {number} trump  index into TRUMP_ORDER (the last is no trump)
 * @param {{ key: number, unclaimed: number, after: number }} cell  the decision's cell from bids-features.js
 * @param {number} taken  tricks the player went on to take
 * @returns {number} the position in the counts array
 * Side effects: none.
 */
export const indexOf = (players, cards, trump, { key, unclaimed, after }, taken) =>
  ((((((players - 3) * MAX_CARDS + (cards - 1)) * TRUMPS + trump) * MAX_KEY + key) * MAX_UNCLAIMED + unclaimed) * AFTER_BUCKETS + after) * MAX_TAKEN + taken;

/**
 * Plays `size` deals (players, cards, trump and dealer at random from the seed and chunk) and returns the counts and the number of deals.
 * Every seat nominates from the current table (lut) and plays like Standard, so the table learns against opponents who bid like it.
 * @param {{ seed: number, chunk: number, size: number, players: number[], jokers?: boolean }} job  `players` is the list of table sizes to pick from
 * @returns {{ counts: Float64Array, deals: number }} the counts (see indexOf) and how many deals made them
 * Side effects: none (the counts are fresh; the RNG is local to the chunk so results do not depend on the worker).
 */
export function collectChunk({ seed, chunk, size, players, jokers = false }) {
  const rng = mulberry32(mixSeed(seed, chunk));
  const counts = new Float64Array(CELLS);
  let seen = [];
  const ai = {
    /** Nominates from the current table and remembers the cell, to be counted against the tricks taken once the deal ends. */
    nominate(ctx) {
      const number = lut.nominate(ctx);
      seen.push({ seat: ctx.seat, cell: cellOf(ctx) });
      return number;
    },
    // Plays as Standard does (a forced card is just played), so the tricks taken reflect ordinary play.
    play: (ctx) => (ctx.legal.length === 1 ? ctx.legal[0] : chooseCard(ctx)),
  };
  for (let i = 0; i < size; i++) {
    const count = players[Math.floor(rng() * players.length)];
    const cards = 1 + Math.floor(rng() * MAX_CARDS);
    const trumpIndex = Math.floor(rng() * TRUMPS);
    seen = [];
    const { taken } = playRound(
      { ais: Array(count).fill(ai), cards, trump: TRUMP_ORDER[trumpIndex], dealer: Math.floor(rng() * count), scores: Array(count).fill(0), round: 0, rounds: 14, settings: { missPoints: true, jokers } },
      rng,
    );
    for (const { seat, cell } of seen) counts[indexOf(count, cards, trumpIndex, cell, taken[seat])]++;
  }
  return { counts, deals: size };
}

// Worker entry point: each message is a job ({ chunk }) answered with that chunk's counts.
if (parentPort) {
  parentPort.on('message', (job) => parentPort.postMessage({ chunk: job.chunk, ...collectChunk({ ...workerData, ...job }) }));
}
