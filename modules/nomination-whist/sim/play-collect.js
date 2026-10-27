// Collects the data the card-play table is learned from. Deals are played with every seat following the same policy (the
// current table, or the Standard AI's play when there is none), except that some of the time a seat plays a random legal
// card instead. Those random plays are the ones recorded: because the card was picked at random, how the round turned out
// is an unbiased measure of what that kind of play is worth in that situation (a card chosen by a policy would be chosen
// because of things the table cannot see). Each is added to the cell of its key with the points the round was worth.
// Runs in worker threads: `collectChunk` is the unit of work, and this file is also the worker's entry point.
import { parentPort, workerData } from 'node:worker_threads';
import { lut } from '../ai/lut.js';
import { roundPoints } from '../ai/sharp.js';
import { chooseCard } from '../ai/standard.js';
import { TRUMP_ORDER } from '../game.js';
import { playRound } from './game.js';
import { COARSE_CELLS, FINE_CELLS, keysFor } from './play-features.js';
import { bestPlay } from './play-model.js';
import { mixSeed, mulberry32 } from './rng.js';

/** The empty sums for a chunk: points added up, and how many plays, for each cell of both tables. */
export const emptyTotals = () => ({
  fineSum: new Float64Array(FINE_CELLS),
  fineN: new Float64Array(FINE_CELLS),
  coarseSum: new Float64Array(COARSE_CELLS),
  coarseN: new Float64Array(COARSE_CELLS),
  deals: 0,
  plays: 0,
});

/**
 * Plays `size` deals (players, cards and trump chosen at random, all from the seed and chunk number) and returns the totals.
 * @param {{ model: object | null, seed: number, chunk: number, size: number, players: number[], epsilon: number }} job
 */
export function collectChunk({ model, seed, chunk, size, players, epsilon }) {
  const rng = mulberry32(mixSeed(seed, chunk));
  const totals = emptyTotals();
  let records = [];
  const ai = {
    nominate: lut.nominate,
    play(ctx) {
      if (ctx.legal.length === 1) return ctx.legal[0];
      if (rng() < epsilon) {
        const card = ctx.legal[Math.floor(rng() * ctx.legal.length)];
        records.push({ seat: ctx.seat, ...keysFor(ctx).find((k) => k.card === card) });
        return card;
      }
      return (model && bestPlay(model, ctx)) ?? chooseCard(ctx);
    },
  };
  for (let i = 0; i < size; i++) {
    const count = players[Math.floor(rng() * players.length)];
    const cards = 1 + Math.floor(rng() * 7);
    const trump = TRUMP_ORDER[Math.floor(rng() * TRUMP_ORDER.length)];
    const dealer = Math.floor(rng() * count);
    records = [];
    const { nominations, taken } = playRound(
      { ais: Array(count).fill(ai), cards, trump, dealer, scores: Array(count).fill(0), round: 0, rounds: 14, settings: { missPoints: true } },
      rng,
    );
    const points = nominations.map((bid, seat) => roundPoints(bid, taken[seat]));
    for (const r of records) {
      totals.fineSum[r.fine] += points[r.seat];
      totals.fineN[r.fine]++;
      totals.coarseSum[r.coarse] += points[r.seat];
      totals.coarseN[r.coarse]++;
      totals.plays++;
    }
    totals.deals++;
  }
  return totals;
}

if (parentPort) {
  parentPort.on('message', (job) => parentPort.postMessage({ chunk: job.chunk, totals: collectChunk({ ...workerData, ...job }) }));
}
