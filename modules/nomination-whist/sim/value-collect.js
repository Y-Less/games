// Collects the data for the bid-value table. Deals are played with every seat nominating the best-valued number according to
// the current table (or the table-aware lookup AI's choice when there is none yet), except that one seat in each deal,
// chosen at random, nominates a random allowed number instead, and then everyone plays to what they nominated (Standard's
// card play). For every nomination of every seat the cell of the decision (value-features.js), the number nominated and the
// tricks that player went on to take are counted. A nomination made by the table depends only on its cell, and the others
// are random, so nothing about the hand that the cell cannot see leaks into how a nomination looks: the average for a
// nomination in a cell is what it is worth there, whatever the hand would "naturally" have nominated.
// Runs in worker threads: `collectChunk` is the unit of work, and this file is the worker's entry point.
import { parentPort, workerData } from 'node:worker_threads';
import { lutc } from '../ai/lut.js';
import { chooseCard } from '../ai/standard.js';
import { TRUMP_ORDER } from '../game.js';
import { playRound } from './game.js';
import { mixSeed, mulberry32 } from './rng.js';
import { AFTER_VALUES, MAX_CARDS, REGIMES, keyBuckets, unclaimedBuckets, valueCell } from './value-features.js';
import { bestByValue } from './value-model.js';

/** Where the counts for each number of cards start in the flat array, and how many cells that block has. */
export const OFFSETS = [];
let total = 0;
for (let cards = 1; cards <= MAX_CARDS; cards++) {
  OFFSETS[cards] = total;
  total += 5 * REGIMES * keyBuckets(cards) * unclaimedBuckets(cards) * AFTER_VALUES * (cards + 1) * (cards + 1);
}
export const TOTAL = total;

/** The index of one count: players, cards, the cell, the number nominated and the tricks taken. */
export function indexOf(players, cards, { key, unclaimed, after, regime }, bid, taken) {
  const cell = (((players - 3) * REGIMES + regime) * keyBuckets(cards) + key) * unclaimedBuckets(cards) + unclaimed;
  return OFFSETS[cards] + ((cell * AFTER_VALUES + after) * (cards + 1) + bid) * (cards + 1) + taken;
}

/**
 * Plays `size` deals (players, cards and trump chosen at random from the seed and chunk) and returns the counts.
 * @param {{ model: object | null, seed: number, chunk: number, size: number, players: number[], jokers?: boolean }} job
 */
export function collectChunk({ model, seed, chunk, size, players, jokers = false }) {
  const rng = mulberry32(mixSeed(seed, chunk));
  const counts = new Float64Array(TOTAL);
  let seen = [];
  const record = (ctx, bid) => seen.push({ seat: ctx.seat, cell: valueCell(ctx), bid });
  const best = {
    nominate(ctx) {
      const bid = (model && bestByValue(model, ctx)) ?? lutc.nominate(ctx);
      record(ctx, bid);
      return bid;
    },
    play: (ctx) => (ctx.legal.length === 1 ? ctx.legal[0] : chooseCard(ctx)),
  };
  const trying = {
    nominate(ctx) {
      const bid = ctx.allowed[Math.floor(rng() * ctx.allowed.length)];
      record(ctx, bid);
      return bid;
    },
    play: best.play,
  };
  for (let i = 0; i < size; i++) {
    const count = players[Math.floor(rng() * players.length)];
    const cards = 1 + Math.floor(rng() * MAX_CARDS);
    const trump = TRUMP_ORDER[Math.floor(rng() * TRUMP_ORDER.length)];
    const dealer = Math.floor(rng() * count);
    const explorer = Math.floor(rng() * count);
    seen = [];
    const { taken } = playRound(
      { ais: Array.from({ length: count }, (_, seat) => (seat === explorer ? trying : best)), cards, trump, dealer, scores: Array(count).fill(0), round: 0, rounds: 14, settings: { missPoints: true, jokers } },
      rng,
    );
    for (const { seat, cell, bid } of seen) counts[indexOf(count, cards, cell, bid, taken[seat])]++;
  }
  return { counts, deals: size };
}

if (parentPort) {
  parentPort.on('message', (job) => parentPort.postMessage({ chunk: job.chunk, ...collectChunk({ ...workerData, ...job }) }));
}
