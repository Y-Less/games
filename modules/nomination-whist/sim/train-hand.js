#!/usr/bin/env node
// Learns the hand model (hand-model.js) by self-play, a few rounds of: play lots of deals with one random seat trying a
// random nomination and the model's best by the others, train the network on every nomination made and what it turned
// out to be worth, then measure it.  Run from the platform folder:
//   node modules/nomination-whist/sim/train-hand.js --players 3-7 --deals 20_000_000 --iterations 3
// Writes models/hand-values.json (or hand-values-jokers.json with --jokers) after every iteration.
// Depends on: hand-collect.js (the worker that plays the deals), hand-features.js and hand-model.js (what is learned),
// and tourney.js (run in a child process to measure the result).  A top-level script: importing it starts training.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { INPUTS } from './hand-features.js';
import { BIDS, HAND_FILES, handModel, modelToJson, newModel } from './hand-model.js';
import { mulberry32 } from './rng.js';

const HELP = `Usage: node modules/nomination-whist/sim/train-hand.js [options]
  --players LIST     player counts, e.g. 3-7 or 4,5                    (default 3-7)
  --deals N          deals per iteration (underscores allowed)         (default 20 million)
  --iterations N     rounds of collect, learn and measure              (default 3)
  --jokers           train for games with the two Jokers (a separate file: hand-values-jokers.json)
  --lr X             learning rate at the start of each iteration      (default 0.002)
  --eval-games N     games per player count against the bid-value table after each iteration (default 100000; 0 = skip)
  --fresh            start from random weights (default: carry on from the saved model)
  --seed, --workers, --chunk (deals per job, default 20000), --batch (default 256)`;

const { values: opts } = parseArgs({
  options: {
    players: { type: 'string', default: '3-7' },
    deals: { type: 'string', default: '20000000' },
    iterations: { type: 'string', default: '3' },
    jokers: { type: 'boolean', default: false },
    lr: { type: 'string', default: '0.002' },
    'eval-games': { type: 'string', default: '100000' },
    fresh: { type: 'boolean', default: false },
    seed: { type: 'string', default: '1' },
    workers: { type: 'string', default: String(Math.max(1, os.cpus().length - 1)) },
    chunk: { type: 'string', default: '20000' },
    batch: { type: 'string', default: '256' },
    help: { type: 'boolean', default: false },
  },
});
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
/** Parses a command-line number, allowing underscores (20_000_000).  Pure. */
const num = (text) => Number(String(text).replaceAll('_', ''));
const players = opts.players.split(',').flatMap((part) => {
  const [from, to = from] = part.split('-').map(Number);
  if (!(from >= 3 && to <= 7 && from <= to)) throw new Error('--players must be within 3-7');
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
});
const jokers = opts.jokers;
const outFile = fileURLToPath(HAND_FILES[jokers]);
const BATCH = num(opts.batch);
// How much the squared loss on tricks-taken-on-a-miss counts against the hit loss: the miss output matters less to the
// choice of nomination than the chance of hitting, so it is down-weighted so it does not dominate the shared hidden layer.
const MISS_WEIGHT = 0.5;

/**
 * Adam optimiser state and gradient accumulators for a model (one zeroed array per parameter, plus the step count).
 * @param {{ w1: Float32Array, b1: Float32Array, w2: Float32Array, b2: Float32Array }} model  the network to train
 * @returns {{ params: string[], state: { grad: object, m: object, v: object, step: number } }} the trainer
 * Side effects: none (allocates the arrays).
 */
function trainerFor(model) {
  const zeros = (a) => new Float32Array(a.length);
  const params = ['w1', 'b1', 'w2', 'b2'];
  const state = { grad: {}, m: {}, v: {}, step: 0 };
  for (const p of params) {
    state.grad[p] = zeros(model[p]);
    state.m[p] = zeros(model[p]);
    state.v[p] = zeros(model[p]);
  }
  return { params, state };
}

/**
 * Trains on one chunk of examples (shuffled, in batches) and returns how well the model had predicted them before.
 * Scoring each example before learning from it gives an honest (out-of-sample) error figure at no extra cost.
 * The loss is logistic on the hit chance of the nominated number, plus a squared loss on the tricks taken on a miss (only
 * the two outputs of that nomination get a gradient).
 * @param {object} model  the network weights (updated in place)
 * @param {{ params: string[], state: object }} trainer  from trainerFor
 * @param {{ n: number, x: Float32Array, bid: Uint8Array, taken: Uint8Array, explorer: Uint8Array, table: Float32Array }} data  the examples from hand-collect.js
 * @param {number} lr  learning rate for this chunk
 * @param {() => number} rng  random source for the shuffle
 * @returns {{ n: number, modelSq: number, tableSq: number, compared: number, modelSqCompared: number, bce: number }} error sums before learning
 * Side effects: mutates `model` and the trainer's state (weights, Adam moments, step count).
 */
function learnFrom(model, trainer, data, lr, rng) {
  const { n, x, bid, taken, explorer, table } = data;
  const { hidden } = model;
  const { params, state } = trainer;
  const h = new Float32Array(hidden);
  const dh = new Float32Array(hidden);
  const order = Uint32Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const score = { n: 0, modelSq: 0, tableSq: 0, compared: 0, modelSqCompared: 0, bce: 0 };
  let inBatch = 0;
  /** Takes one Adam step from the gradients summed over the current batch, then clears them.  Side effects: updates the model weights, the moments, and `inBatch`. */
  const apply = () => {
    state.step++;
    const c1 = 1 - 0.9 ** state.step;
    const c2 = 1 - 0.999 ** state.step;
    for (const p of params) {
      const w = model[p];
      const g = state.grad[p];
      const m = state.m[p];
      const v = state.v[p];
      for (let i = 0; i < w.length; i++) {
        const gi = g[i] / inBatch;
        m[i] = 0.9 * m[i] + 0.1 * gi;
        v[i] = 0.999 * v[i] + 0.001 * gi * gi;
        w[i] -= (lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + 1e-8);
        g[i] = 0;
      }
    }
    inBatch = 0;
  };

  for (let s = 0; s < n; s++) {
    const k = order[s];
    const base = k * INPUTS;
    const b = bid[k];
    const hit = taken[k] === b ? 1 : 0;
    const miss = hit ? 0 : taken[k];
    // forward
    for (let j = 0; j < hidden; j++) {
      let sum = model.b1[j];
      const row = j * INPUTS;
      for (let i = 0; i < INPUTS; i++) {
        const xi = x[base + i];
        if (xi !== 0) sum += model.w1[row + i] * xi;
      }
      h[j] = Math.tanh(sum);
    }
    const kHit = b;
    const kMiss = BIDS + b;
    let zHit = model.b2[kHit];
    let zMiss = model.b2[kMiss];
    for (let j = 0; j < hidden; j++) {
      zHit += model.w2[kHit * hidden + j] * h[j];
      zMiss += model.w2[kMiss * hidden + j] * h[j];
    }
    const p = 1 / (1 + Math.exp(-zHit));
    const predicted = p * (10 + b) + Math.max(0, zMiss);
    const actual = hit ? 10 + b : taken[k];
    // how well it predicted this before learning from it
    score.n++;
    score.bce += -(hit ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9));
    score.modelSq += (predicted - actual) ** 2;
    if (Number.isFinite(table[k])) {
      score.compared++;
      score.modelSqCompared += (predicted - actual) ** 2;
      score.tableSq += (table[k] - actual) ** 2;
    }
    // backward: the logistic loss on the hit output and a squared loss on the tricks taken on a miss
    const dHit = p - hit;
    const dMiss = MISS_WEIGHT * (zMiss - miss);
    state.grad.b2[kHit] += dHit;
    state.grad.b2[kMiss] += dMiss;
    for (let j = 0; j < hidden; j++) {
      state.grad.w2[kHit * hidden + j] += dHit * h[j];
      state.grad.w2[kMiss * hidden + j] += dMiss * h[j];
      dh[j] = (model.w2[kHit * hidden + j] * dHit + model.w2[kMiss * hidden + j] * dMiss) * (1 - h[j] * h[j]);
      state.grad.b1[j] += dh[j];
    }
    for (let i = 0; i < INPUTS; i++) {
      const xi = x[base + i];
      if (xi === 0) continue;
      for (let j = 0; j < hidden; j++) state.grad.w1[j * INPUTS + i] += dh[j] * xi;
    }
    if (++inBatch === BATCH) apply();
  }
  if (inBatch) apply();
  return score;
}

/**
 * Plays the deals in worker threads, training on each chunk as it arrives.  Returns the totals of how well it predicted.
 * The learning rate follows a cosine decay from `--lr` down to 5% of it over the iteration, so it settles at the end.
 * @param {object} model  the network being trained (updated in place)
 * @param {object | null} opponents  the model the workers' seats nominate with, or null to use the bid-value table
 * @param {{ params: string[], state: object }} trainer  from trainerFor
 * @param {number} iteration  0-based iteration number, which varies the seeds between iterations
 * @returns {Promise<object>} the summed error figures (see learnFrom)
 * Side effects: starts and terminates worker threads, mutates `model`, and writes a progress bar to stderr.
 */
async function iterate(model, opponents, trainer, iteration) {
  const chunk = num(opts.chunk);
  const jobs = Math.ceil(num(opts.deals) / chunk);
  const lr0 = num(opts.lr);
  const rng = mulberry32(num(opts.seed) * 7919 + iteration);
  const totals = { n: 0, modelSq: 0, tableSq: 0, compared: 0, modelSqCompared: 0, bce: 0, explorerN: 0 };
  const base = { model: opponents ? modelToJson(opponents) : null, seed: num(opts.seed) + iteration * 1000003, size: chunk, players, jokers };
  const started = Date.now();
  let next = 0;
  let done = 0;
  let lastDraw = 0;
  const workers = Array.from({ length: Math.min(num(opts.workers), jobs) }, () => new Worker(fileURLToPath(new URL('./hand-collect.js', import.meta.url)), { workerData: base }));
  await new Promise((resolve) => {
    /** Gives `worker` the next chunk number, if any are left.  Side effects: posts a message. */
    const give = (worker) => (next < jobs ? worker.postMessage({ chunk: next++ }) : undefined);
    for (const worker of workers) {
      worker.on('message', (data) => {
        const progress = done / jobs;
        const lr = lr0 * (0.05 + 0.95 * 0.5 * (1 + Math.cos(Math.PI * progress)));
        const score = learnFrom(model, trainer, data, lr, rng);
        for (const key of Object.keys(score)) totals[key] += score[key];
        done++;
        const now = Date.now();
        if (process.stderr.isTTY && (now - lastDraw > 500 || done === jobs)) {
          lastDraw = now;
          const rate = (done * chunk) / ((now - started) / 1000);
          const eta = Math.round(((jobs - done) * chunk) / rate);
          process.stderr.write(`\r  [${'#'.repeat(Math.round((30 * done) / jobs)).padEnd(30, '-')}] ${((100 * done) / jobs).toFixed(0).padStart(3)}%  ${Math.round(rate).toLocaleString('en-GB')} deals/s  ETA ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}  rmse ${Math.sqrt(totals.modelSq / totals.n).toFixed(3)}\x1b[K`);
        }
        if (done === jobs) resolve();
        else give(worker);
      });
      worker.on('error', (error) => {
        throw error;
      });
      give(worker);
    }
  });
  if (process.stderr.isTTY) process.stderr.write('\n');
  await Promise.all(workers.map((w) => w.terminate()));
  return totals;
}

/**
 * Plays the model against the bid-value table in child processes, at every player count, and prints the scores.
 * Seats alternate between the two, so neither benefits from position.  Skipped when `--eval-games` is 0.
 * @returns {void}
 * Side effects: reloads the saved model, runs tourney.js child processes, and logs one line; throws if one fails.
 */
function evaluate() {
  const games = num(opts['eval-games']);
  if (!games) return;
  handModel(jokers, true);
  const rows = [];
  for (const count of players) {
    const names = Array.from({ length: count }, (_, i) => (i % 2 ? 'lutv-table' : 'lutv'));
    const args = [fileURLToPath(new URL('./tourney.js', import.meta.url)), '--games', String(games), '--ai', names.join(','), '--json', ...(jokers ? ['--jokers'] : [])];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (run.status !== 0) throw new Error(`evaluation failed: ${run.stderr}`);
    const result = JSON.parse(run.stdout);
    rows.push(`${count}p ${result.lutv['mean score']} v ${result['lutv-table']['mean score']}`);
  }
  console.log(`  hand model v bid-value table (mean score): ${rows.join(' | ')}`);
}

// Main loop: each iteration collects with the current model (opponents) and trains on what it collects, then saves and measures.
const saved = opts.fresh ? null : handModel(jokers, true);
const model = saved ?? newModel(mulberry32(num(opts.seed)));
const trainer = trainerFor(model);
console.log(`${players.join(',')} players${jokers ? ', with Jokers' : ''}, ${num(opts.iterations)} iterations of ${num(opts.deals).toLocaleString('en-GB')} deals, starting from ${saved ? 'the saved model' : 'random weights (opponents use the bid-value table at first)'}`);
for (let iteration = 0; iteration < num(opts.iterations); iteration++) {
  const started = Date.now();
  const totals = await iterate(model, iteration === 0 && !saved ? null : model, trainer, iteration);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(modelToJson(model, { trainedOn: { players, jokers, iteration, savedAt: new Date().toISOString() } })));
  /** Root mean square error from a sum of squares and a count, to three decimals.  Pure. */
  const rmse = (sq, n) => Math.sqrt(sq / n).toFixed(3);
  console.log(
    `iteration ${iteration + 1}: ${totals.n.toLocaleString('en-GB')} nominations, predicted points rmse ${rmse(totals.modelSq, totals.n)}, hit loss ${(totals.bce / totals.n).toFixed(4)}` +
      (totals.compared ? `; where the bid-value table had a row (${totals.compared.toLocaleString('en-GB')}): table ${rmse(totals.tableSq, totals.compared)}, model ${rmse(totals.modelSqCompared, totals.compared)}` : '') +
      `, ${Math.round((Date.now() - started) / 1000)}s`,
  );
  evaluate();
}
