#!/usr/bin/env node
// Learns the bid-value table (value-model.js) by self-play, a few rounds of: play lots of deals with every nomination
// tried by one random seat and the table's best by the others, average what each nomination was worth in each situation,
// make that the new table, and measure it. Run from the platform folder:
//   node modules/nomination-whist/sim/train-values.js --players 3-7 --deals 100_000_000 --iterations 2
// Writes models/bidding-values.json (or bidding-values-jokers.json with --jokers) after every iteration.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { OFFSETS, TOTAL } from './value-collect.js';
import { AFTER_VALUES, MAX_CARDS, REGIMES, keyBuckets, unclaimedBuckets } from './value-features.js';
import { VALUE_FILES, valueModel } from './value-model.js';

const HELP = `Usage: node modules/nomination-whist/sim/train-values.js [options]
  --players LIST     player counts, e.g. 3-7 or 4,5                    (default 3-7)
  --deals N          deals per iteration (default 100 million; underscores allowed)
  --iterations N     rounds of collect and re-learn                     (default 2)
  --min-n N          a nomination needs N tries in its window to be trusted (default 150)
  --jokers           train for games with the two Jokers (a separate table: bidding-values-jokers.json)
  --eval-games N     games per player count against lutc after each iteration (default 200000; 0 = skip)
  --fresh            start from no table (default: carry on from the saved one)
  --seed, --workers, --chunk`;

const { values: opts } = parseArgs({
  options: {
    players: { type: 'string', default: '3-7' },
    deals: { type: 'string', default: '100000000' },
    iterations: { type: 'string', default: '2' },
    'min-n': { type: 'string', default: '150' },
    jokers: { type: 'boolean', default: false },
    'eval-games': { type: 'string', default: '200000' },
    fresh: { type: 'boolean', default: false },
    seed: { type: 'string', default: '1' },
    workers: { type: 'string', default: String(Math.max(1, os.cpus().length - 1)) },
    chunk: { type: 'string', default: '400000' },
    help: { type: 'boolean', default: false },
  },
});
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
const num = (text) => Number(String(text).replaceAll('_', ''));
const players = opts.players.split(',').flatMap((part) => {
  const [from, to = from] = part.split('-').map(Number);
  if (!(from >= 3 && to <= 7 && from <= to)) throw new Error('--players must be within 3-7');
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
});
const jokers = opts.jokers;
const minN = num(opts['min-n']);
const outFile = fileURLToPath(VALUE_FILES[jokers]);

/** Plays the deals in worker threads, with a status bar, and returns the summed counts. */
async function collect(model, iteration) {
  const sums = new Float64Array(TOTAL);
  const chunk = num(opts.chunk);
  const jobs = Math.ceil(num(opts.deals) / chunk);
  let next = 0;
  let done = 0;
  let lastDraw = 0;
  const started = Date.now();
  const base = { model, seed: num(opts.seed) + iteration * 1000003, size: chunk, players, jokers };
  const workers = Array.from({ length: Math.min(num(opts.workers), jobs) }, () => new Worker(fileURLToPath(new URL('./value-collect.js', import.meta.url)), { workerData: base }));
  await new Promise((resolve) => {
    const give = (worker) => (next < jobs ? worker.postMessage({ chunk: next++ }) : undefined);
    for (const worker of workers) {
      worker.on('message', ({ counts }) => {
        for (let i = 0; i < TOTAL; i++) sums[i] += counts[i];
        done++;
        const now = Date.now();
        const rate = (done * chunk) / ((now - started) / 1000);
        const eta = Math.round(((jobs - done) * chunk) / rate);
        const line = `  [${'#'.repeat(Math.round((30 * done) / jobs)).padEnd(30, '-')}] ${((100 * done) / jobs).toFixed(0).padStart(3)}%  ${Math.round(rate).toLocaleString('en-GB')} deals/s  ETA ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}`;
        if (process.stderr.isTTY && (now - lastDraw > 250 || done === jobs)) {
          lastDraw = now;
          process.stderr.write(`\r${line}\x1b[K`);
        } else if (!process.stderr.isTTY && now - lastDraw > 15000) {
          lastDraw = now;
          process.stderr.write(`${line}\n`);
        }
        if (done === jobs) resolve();
        else give(worker);
      });
      give(worker);
    }
  });
  workers.forEach((worker) => worker.terminate());
  if (process.stderr.isTTY) process.stderr.write('\n');
  return sums;
}

/** Turns the counts into the table. */
function learn(sums) {
  const model = { kind: 'bidding-values', version: 1, trainedOn: { players, jokers, minN, savedAt: new Date().toISOString() }, players: {} };
  let rows = 0;
  let entries = 0;
  for (const count of players) {
    const byRegime = [];
    for (let regime = 0; regime < REGIMES; regime++) {
      const byCards = [];
      for (let cards = 1; cards <= MAX_CARDS; cards++) {
        const K = keyBuckets(cards);
        const U = unclaimedBuckets(cards);
        const base = OFFSETS[cards];
        const width = cards <= 2 ? 0 : 5; // exact hands are not blurred together; estimates of neighbouring hands are
        const uWidth = 3;
        const at = (key, u, a, bid, taken) => base + (((((count - 3) * REGIMES + regime) * K + key) * U + u) * AFTER_VALUES + a) * (cards + 1) * (cards + 1) + bid * (cards + 1) + taken;
        /** [tries, hits, tricks taken on a miss] for a nomination, over a window of neighbouring cells that grows until it holds minN tries. */
        const stat = (key, u, a, bid) => {
          for (let w = 0; w <= 5; w++) {
            let tries = 0;
            let hits = 0;
            let missed = 0;
            const kw = Math.min(w, width);
            const uw = Math.min(w, uWidth);
            for (let k = Math.max(0, key - kw); k <= Math.min(K - 1, key + kw); k++) {
              for (let v = Math.max(0, u - uw); v <= Math.min(U - 1, u + uw); v++) {
                for (let t = 0; t <= cards; t++) {
                  const n = sums[at(k, v, a, bid, t)];
                  tries += n;
                  if (t === bid) hits += n;
                  else missed += n * t;
                }
              }
            }
            if (tries >= minN) return [Math.round((hits / tries) * 1000) / 1000, Math.round((missed / tries) * 1000) / 1000];
          }
          return null;
        };
        const keys = [];
        for (let key = 0; key < K; key++) {
          const us = [];
          for (let u = 0; u < U; u++) {
            const as = [];
            for (let a = 0; a < AFTER_VALUES; a++) {
              let reached = false;
              for (let bid = 0; bid <= cards && !reached; bid++) for (let t = 0; t <= cards; t++) if (sums[at(key, u, a, bid, t)] > 0) reached = true;
              if (!reached) {
                as.push(null);
                continue;
              }
              const row = Array.from({ length: cards + 1 }, (_, bid) => stat(key, u, a, bid));
              if (row.every((entry) => entry === null)) {
                as.push(null);
                continue;
              }
              rows++;
              entries += row.filter(Boolean).length;
              as.push(row);
            }
            us.push(as.every((r) => r === null) ? null : as);
          }
          keys.push(us.every((r) => r === null) ? null : us);
        }
        byCards[cards] = keys;
      }
      byRegime.push(byCards);
    }
    model.players[count] = byRegime;
  }
  return { model, rows, entries };
}

/** Plays the table against lutc in child processes, at every player count, and prints the scores. */
function evaluate() {
  const games = num(opts['eval-games']);
  if (!games) return;
  valueModel(jokers, true);
  const rows = [];
  for (const count of players) {
    const names = Array.from({ length: count }, (_, i) => (i % 2 ? 'lutc' : 'lutv'));
    const args = [fileURLToPath(new URL('./tourney.js', import.meta.url)), '--games', String(games), '--ai', names.join(','), '--json', ...(jokers ? ['--jokers'] : [])];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (run.status !== 0) throw new Error(`evaluation failed: ${run.stderr}`);
    const result = JSON.parse(run.stdout);
    rows.push(`${count}p ${result.lutv['mean score']} v ${result.lutc['mean score']}`);
  }
  console.log(`  lutv v lutc (mean score): ${rows.join(' | ')}`);
}

let model = opts.fresh ? null : valueModel(jokers, true);
console.log(`${players.join(',')} players${jokers ? ', with Jokers' : ''}, ${num(opts.iterations)} iterations of ${num(opts.deals).toLocaleString('en-GB')} deals, starting from ${model ? 'the saved table' : 'the table-aware lookup'}`);
for (let iteration = 0; iteration < num(opts.iterations); iteration++) {
  const started = Date.now();
  const sums = await collect(model, iteration);
  const learned = learn(sums);
  model = learned.model;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(model));
  console.log(`iteration ${iteration + 1}: ${learned.rows.toLocaleString('en-GB')} situations, ${learned.entries.toLocaleString('en-GB')} valued nominations, ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB, ${Math.round((Date.now() - started) / 1000)}s`);
  evaluate();
}
