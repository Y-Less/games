#!/usr/bin/env node
// Turns the counts from run.js into the bidding lookup table: for every player count, cards dealt and trump suit, the
// chance of each number of tricks given the Standard AI's estimate of the hand (in quarters of a trick). The AI picks the
// nomination with the best expected score from that row (ai/lut.js), so the dealer's forbidden number and the scoring
// options are applied at play time and are not baked in. Run from the platform folder:
//   node modules/nomination-whist/sim/train-bids.js --players 3-7 --in sim-out/whist --out modules/nomination-whist/sim/models/bidding.json
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ESTIMATE_BUCKETS, ESTIMATE_STEPS, MAX_PLAYERS, MIN_PLAYERS, TRUMPS, indexOf } from './tables.js';
import { loadCounts } from './export.js';

const { values: opts } = parseArgs({
  options: {
    players: { type: 'string', default: '3-7' },
    in: { type: 'string', default: 'sim-out/whist' },
    out: { type: 'string', default: 'modules/nomination-whist/sim/models/bidding.json' },
    'min-n': { type: 'string', default: '400' },
    help: { type: 'boolean', default: false },
  },
});
if (opts.help) {
  console.log(`Usage: node modules/nomination-whist/sim/train-bids.js [--players 3-7] [--in sim-out/whist] [--out FILE] [--min-n 400]
  --min-n N   a row is smoothed over neighbouring estimates until it rests on at least N hands`);
  process.exit(0);
}

/** "3-7", "4" or "3,5,6" -> [3, 4, 5, 6, 7]. */
function listOf(text, min, max) {
  const out = new Set();
  for (const part of text.split(',')) {
    const [from, to = from] = part.split('-').map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || from < min || to > max) throw new Error(`--players "${text}" must be within ${min}-${max}`);
    for (let n = from; n <= to; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

const players = listOf(opts.players, MIN_PLAYERS, MAX_PLAYERS);
const minN = Number(opts['min-n']);
const saved = loadCounts(path.resolve(opts.in));
if (!saved) throw new Error(`No counts in ${opts.in}: run sim/run.js first`);
const hand = saved.stats.tables.hand.n;

/** Counts of tricks taken by estimate bucket, for one players x cards x trump (every seat order added together). */
function matrix(p, cards, tk) {
  const rows = Array.from({ length: ESTIMATE_BUCKETS }, () => new Array(cards + 1).fill(0));
  for (let seat = 0; seat < p + MIN_PLAYERS; seat++) {
    for (let e = 0; e < ESTIMATE_BUCKETS; e++) for (let t = 0; t <= cards; t++) rows[e][t] += hand[indexOf('hand', [p, cards - 1, tk, seat, e, t])];
  }
  return rows;
}

/** One row as probabilities: widen a triangular window over neighbouring estimates until enough hands back it. */
function row(rows, e, cards) {
  for (let width = 0; width < ESTIMATE_BUCKETS; width++) {
    const sums = new Array(cards + 1).fill(0);
    for (let o = Math.max(0, e - width); o <= Math.min(ESTIMATE_BUCKETS - 1, e + width); o++) {
      const weight = width + 1 - Math.abs(o - e);
      for (let t = 0; t <= cards; t++) sums[t] += weight * rows[o][t];
    }
    const total = sums.reduce((a, b) => a + b, 0);
    const raw = rows[e].reduce((a, b) => a + b, 0);
    if (raw === 0 && width === 0) continue; // a bucket this hand never produced: borrow from its neighbours
    if (total >= minN) return sums.map((s) => Math.round((s / total) * 10000) / 10000);
  }
  return null;
}

const model = {
  kind: 'bidding',
  version: 1,
  estimateSteps: ESTIMATE_STEPS,
  trainedOn: { deals: saved.meta.deals, ai: saved.meta.config.ai, instantWin: saved.meta.config.instantWin },
  players: {},
};
let rowsMade = 0;
let rowsMissing = 0;
for (const count of players) {
  const byCards = {};
  for (let cards = 1; cards <= 7; cards++) {
    const byTrump = {};
    TRUMPS.forEach((trump, tk) => {
      const rows = matrix(count - MIN_PLAYERS, cards, tk);
      byTrump[trump] = rows.map((_, e) => row(rows, e, cards));
      for (const r of byTrump[trump]) r ? rowsMade++ : rowsMissing++;
    });
    byCards[cards] = byTrump;
  }
  model.players[count] = byCards;
}
fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
fs.writeFileSync(path.resolve(opts.out), JSON.stringify(model));
console.log(`Wrote ${opts.out}: players ${players.join(',')}, ${rowsMade} rows (${rowsMissing} too rare to fill, the AI falls back there), ${(fs.statSync(opts.out).size / 1024).toFixed(0)} KB, from ${saved.meta.deals.toLocaleString()} deals.`);
