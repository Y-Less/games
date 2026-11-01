#!/usr/bin/env node
// Trains the bidding table with table state: for every player count, number of cards and trump suit, the chance of each
// number of tricks given the hand (its estimated worth, or the card itself in a one-card round), how many tricks the
// players before have claimed, and exactly how many players still nominate after (your table position). Run from the platform folder:
//   node modules/nomination-whist/sim/train-bids-context.js --players 3-7 --deals 50_000_000
// Writes models/bidding-context.json (or bidding-context-jokers.json with --jokers), which the `lutc` AI (ai/lut.js) reads.
// Depends on: bids-collect.js (the worker that plays the deals and counts them), bids-features.js (the cell layout, shared
// with the AI) and ../game.js (TRUMP_ORDER). A top-level script: importing it starts training.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { TRUMP_ORDER } from '../game.js';
import { AFTER_BUCKETS, ESTIMATE_STEPS, UNCLAIMED_MIN, keyBuckets, unclaimedBuckets } from './bids-features.js';
import { CELLS, MAX_CARDS, indexOf } from './bids-collect.js';

const HELP = `Usage: node modules/nomination-whist/sim/train-bids-context.js [options]
  --players LIST   player counts, e.g. 3-7 or 4,5                  (default 3-7)
  --deals N        deals to play (default 50 million; underscores allowed)
  --min-n N        a cell is smoothed over its neighbours until N hands back it (default 300)
  --jokers         train for games with the two Jokers shuffled in (a separate table, written to bidding-context-jokers.json)
  --out FILE       where the table goes (default modules/nomination-whist/sim/models/bidding-context[-jokers].json)
  --seed N, --workers N, --chunk N`;

const { values: opts } = parseArgs({
  options: {
    players: { type: 'string', default: '3-7' },
    deals: { type: 'string', default: '50000000' },
    'min-n': { type: 'string', default: '300' },
    out: { type: 'string', default: '' },
    jokers: { type: 'boolean', default: false },
    seed: { type: 'string', default: '1' },
    workers: { type: 'string', default: String(Math.max(1, os.cpus().length - 1)) },
    chunk: { type: 'string', default: '50000' },
    help: { type: 'boolean', default: false },
  },
});
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
/** Parses a command-line number, allowing underscores (50_000_000). Pure. */
const num = (text) => Number(String(text).replaceAll('_', ''));
// Expands "3-7" or "4,5" into the list of player counts to train for.
const players = opts.players.split(',').flatMap((part) => {
  const [from, to = from] = part.split('-').map(Number);
  if (!(from >= 3 && to <= 7 && from <= to)) throw new Error('--players must be within 3-7');
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
});
const minN = num(opts['min-n']);
const jokers = opts.jokers;
const outFile = opts.out || `modules/nomination-whist/sim/models/bidding-context${jokers ? '-jokers' : ''}.json`;

/**
 * Plays the deals in worker threads, with a status bar, and returns the summed counts.
 * @returns {Promise<Float64Array>} the counts of every cell (indexed by bids-collect's indexOf), added over all chunks
 * Side effects: starts and terminates worker threads and writes a progress bar to stderr.
 */
async function collect() {
  const total = new Float64Array(CELLS);
  const chunk = num(opts.chunk);
  const jobs = Math.ceil(num(opts.deals) / chunk);
  let next = 0;
  let done = 0;
  let lastDraw = 0;
  const started = Date.now();
  const workers = Array.from({ length: Math.min(num(opts.workers), jobs) }, () => new Worker(fileURLToPath(new URL('./bids-collect.js', import.meta.url)), { workerData: { seed: num(opts.seed), size: chunk, players, jokers } }));
  await new Promise((resolve) => {
    /** Gives `worker` the next chunk number, if any are left. Side effects: posts a message. */
    const give = (worker) => (next < jobs ? worker.postMessage({ chunk: next++ }) : undefined);
    for (const worker of workers) {
      worker.on('message', ({ counts }) => {
        for (let i = 0; i < CELLS; i++) total[i] += counts[i];
        done++;
        const now = Date.now();
        /** The progress line: bar, percentage, deals per second and ETA. Pure. */
        const line = () => {
          const rate = (done * chunk) / ((now - started) / 1000);
          const eta = Math.round(((jobs - done) * chunk) / rate);
          return `[${'#'.repeat(Math.round((30 * done) / jobs)).padEnd(30, '-')}] ${((100 * done) / jobs).toFixed(0).padStart(3)}%  ${Math.round(rate).toLocaleString('en-GB')} deals/s  ETA ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}`;
        };
        if (process.stderr.isTTY && (now - lastDraw > 250 || done === jobs)) {
          lastDraw = now;
          process.stderr.write(`\r${line()}\x1b[K`);
        } else if (!process.stderr.isTTY && now - lastDraw > 15000) {
          lastDraw = now;
          process.stderr.write(`${line()}\n`);
        }
        if (done === jobs) resolve();
        else give(worker);
      });
      give(worker);
    }
  });
  workers.forEach((worker) => worker.terminate());
  if (process.stderr.isTTY) process.stderr.write('\n');
  return total;
}

/**
 * The counts of tricks taken for one cell as an array of length cards + 1.
 * @param {Float64Array} total  the summed counts
 * @param {number} p  players at the table
 * @param {number} cards  cards each
 * @param {number} trump  trump index
 * @param {{ key: number, unclaimed: number, after: number }} cell  the cell
 * @returns {number[]} how often each number of tricks (0 to `cards`) was taken from this cell
 * Side effects: none.
 */
const countsAt = (total, p, cards, trump, cell) => Array.from({ length: cards + 1 }, (_, t) => total[indexOf(p, cards, trump, cell, t)]);

/**
 * One cell as probabilities. A window of neighbouring estimates and unclaimed counts (same number of players still to
 * nominate) is widened until at least `minN` hands are in it, and past a width of 3 the other positions join too, at half weight.
 * Returns null for a cell nobody reached and that has no busy neighbours.
 * Why smooth: a rare cell's raw counts are noisy, so it borrows from similar hands (nearby estimates, similar claims),
 * weighting the nearer ones more (triangular weights); other table positions count half because position matters but less than the hand.
 * @param {Float64Array} total  the summed counts
 * @param {number} p  players at the table
 * @param {number} cards  cards each
 * @param {number} trump  trump index
 * @param {number} e  key bucket (hand estimate, or the card in a one-card round)
 * @param {number} u  unclaimed bucket
 * @param {number} a  players still to nominate after this one
 * @returns {number[] | null} the chance of taking 0 to `cards` tricks (to four decimals), or null if the cell cannot be filled
 * Side effects: none.
 */
function probabilities(total, p, cards, trump, e, u, a) {
  const eMax = keyBuckets(cards, jokers);
  const uMax = unclaimedBuckets(cards);
  // A cell that never came up (an impossible combination, or a freak one) stays empty: the AI falls back to the plain table.
  if (countsAt(total, p, cards, trump, { key: e, unclaimed: u, after: a }).every((n) => n === 0)) return null;
  for (let width = 0; width <= Math.max(eMax, uMax); width++) {
    const sums = new Array(cards + 1).fill(0);
    const keyWidth = cards === 1 ? 0 : width; // neighbouring cards in a one-card round are unrelated: only widen over the rest
    for (let oe = Math.max(0, e - keyWidth); oe <= Math.min(eMax - 1, e + keyWidth); oe++) {
      for (let ou = Math.max(0, u - width); ou <= Math.min(uMax - 1, u + width); ou++) {
        const weight = (keyWidth + 1 - Math.abs(oe - e)) * (width + 1 - Math.abs(ou - u));
        for (let oa = 0; oa < AFTER_BUCKETS; oa++) {
          if (oa !== a && width <= 3) continue;
          const cell = countsAt(total, p, cards, trump, { key: oe, unclaimed: ou, after: oa });
          for (let t = 0; t <= cards; t++) sums[t] += weight * cell[t] * (oa === a ? 1 : 0.5);
        }
      }
    }
    const sum = sums.reduce((x, y) => x + y, 0);
    if (sum >= minN) return sums.map((s) => Math.round((s / sum) * 10000) / 10000);
  }
  return null;
}

// Main: collect the counts, smooth every cell into a row of probabilities, and write the table the `lutc` AI reads.
const deals = num(opts.deals);
console.log(`${players.join(',')} players, ${deals.toLocaleString('en-GB')} deals${jokers ? ', with Jokers' : ''}`);
const started = Date.now();
const total = await collect();
console.log(`collected in ${Math.round((Date.now() - started) / 1000)}s; smoothing ...`);
const model = { kind: 'bidding-context', version: 1, estimateSteps: ESTIMATE_STEPS, unclaimedMin: UNCLAIMED_MIN, afterBuckets: AFTER_BUCKETS, trainedOn: { deals, players, minN, jokers }, players: {} };
let made = 0;
let missing = 0;
for (const p of players) {
  model.players[p] = {};
  for (let cards = 1; cards <= MAX_CARDS; cards++) {
    model.players[p][cards] = {};
    TRUMP_ORDER.forEach((trump, trumpIndex) => {
      const table = Array.from({ length: keyBuckets(cards, jokers) }, (_, e) =>
        Array.from({ length: unclaimedBuckets(cards) }, (_, u) =>
          Array.from({ length: AFTER_BUCKETS }, (_, a) => {
            const row = probabilities(total, p, cards, trumpIndex, e, u, a);
            row ? made++ : missing++;
            return row;
          }),
        ),
      );
      model.players[p][cards][trump ?? 'N'] = table;
    });
  }
}
const file = path.resolve(outFile);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(model));
console.log(`Wrote ${outFile}: ${made.toLocaleString('en-GB')} rows filled, ${missing.toLocaleString('en-GB')} cells never reached (the AI falls back to the plain bidding table there), ${(fs.statSync(file).size / 1048576).toFixed(1)} MB.`);
