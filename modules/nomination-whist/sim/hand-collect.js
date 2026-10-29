// Collects the examples the hand model (hand-model.js) learns from. Deals are played with every seat nominating what the
// current model says is best (or, before there is one, what the bid-value table says), except that one seat in each deal,
// chosen at random, nominates a random allowed number, and then everyone plays to what they nominated (Standard's card
// play). Every nomination of every seat becomes an example: the features of the decision (hand-features.js), the number
// nominated and the tricks that player went on to take. A nomination made by the model depends only on its features, and
// the others are random, so what an example shows is what that nomination is worth for those features, whatever the hand
// would "naturally" have nominated.
// Runs in worker threads: `collectDeals` is the unit of work, and this file is the worker's entry point.
import { parentPort, workerData } from 'node:worker_threads';
import { lutc } from '../ai/lut.js';
import { chooseCard } from '../ai/standard.js';
import { TRUMP_ORDER } from '../game.js';
import { playRound } from './game.js';
import { INPUTS, handFeatures } from './hand-features.js';
import { bestByHandModel, modelFromJson } from './hand-model.js';
import { mixSeed, mulberry32 } from './rng.js';
import { MAX_CARDS } from './value-features.js';
import { bestByValue, expectedPoints, valueModel, valueRow } from './value-model.js';

/**
 * Plays `size` deals (players, cards and trump chosen at random from the seed and chunk).
 * `table` is the bid-value table (the opponents' play before there is a hand model, and the yardstick for how well each
 * predicts the points). Returns the examples as typed arrays: features (INPUTS each), the number nominated, the tricks
 * taken, whether it was the random seat, and what the table predicted for it (NaN where it knows nothing).
 */
export function collectDeals({ model, table, seed, chunk, size, players, jokers = false }) {
  const rng = mulberry32(mixSeed(seed, chunk));
  let seen = [];
  const best = {
    nominate(ctx) {
      return (model && bestByHandModel(model, ctx)) ?? (table && bestByValue(table, ctx)) ?? lutc.nominate(ctx);
    },
    play: (ctx) => (ctx.legal.length === 1 ? ctx.legal[0] : chooseCard(ctx)),
  };
  const trying = { nominate: (ctx) => ctx.allowed[Math.floor(rng() * ctx.allowed.length)], play: best.play };

  const examples = [];
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
      (event) => {
        if (event.type !== 'nominate') return;
        const ctx = event.context;
        const row = table ? valueRow(table, ctx) : null;
        const entry = row?.[event.nomination];
        seen.push({ seat: event.seat, x: handFeatures(ctx), bid: event.nomination, explorer: event.seat === explorer, table: entry ? expectedPoints(entry, event.nomination) : NaN });
      },
    );
    for (const e of seen) examples.push({ ...e, taken: taken[e.seat] });
  }
  const n = examples.length;
  const out = { n, x: new Float32Array(n * INPUTS), bid: new Uint8Array(n), taken: new Uint8Array(n), explorer: new Uint8Array(n), table: new Float32Array(n), deals: size };
  examples.forEach((e, k) => {
    out.x.set(e.x, k * INPUTS);
    out.bid[k] = e.bid;
    out.taken[k] = e.taken;
    out.explorer[k] = e.explorer ? 1 : 0;
    out.table[k] = e.table;
  });
  return out;
}

if (parentPort) {
  const model = workerData.model ? modelFromJson(workerData.model) : null;
  const table = valueModel(workerData.jokers === true);
  parentPort.on('message', (job) => {
    const result = collectDeals({ ...workerData, model, table, ...job });
    parentPort.postMessage({ chunk: job.chunk, ...result }, [result.x.buffer, result.bid.buffer, result.taken.buffer, result.explorer.buffer, result.table.buffer]);
  });
}
