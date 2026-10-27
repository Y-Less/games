#!/usr/bin/env node
// Learns the card-play table by self-play, a few rounds of: play lots of deals with the current table (plus random
// exploration), average what each kind of play was worth, make that the new table, and measure it against Standard.
// Run from the platform folder:
//   node modules/nomination-whist/sim/train-play.js --players 3-7 --iterations 3 --deals 20_000_000
// The table is saved after every iteration (models/play.json and play.bin), so it can be stopped at any time.
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { emptyTotals } from './play-collect.js';
import { COARSE_CELLS, FINE_CELLS, coarseOfFine } from './play-features.js';
import { emptyPlayModel, loadPlayModel, savePlayModel } from './play-model.js';

const HELP = `Usage: node modules/nomination-whist/sim/train-play.js [options]
  --players LIST      player counts to train on, e.g. 3-7 or 4,5     (default 3-7)
  --iterations N      rounds of collect and re-learn                  (default 3)
  --deals N           deals per iteration                             (default 20 million)
  --epsilon X         how often a seat plays a random card instead     (default 0.3)
  --min-coarse N      plays a coarse cell needs before it is trusted   (default 10)
  --shrink K          a fine cell counts as K plays of its coarse cell's value as well (default 25)
  --eval-games N      games per player count against Standard after each iteration (default 20000; 0 = skip)
  --fresh             start from no table (default: carry on from the saved one)
  --seed, --workers, --chunk`;

const { values: opts } = parseArgs({
  options: {
    players: { type: 'string', default: '3-7' },
    iterations: { type: 'string', default: '3' },
    deals: { type: 'string', default: '20000000' },
    epsilon: { type: 'string', default: '0.3' },
    'min-coarse': { type: 'string', default: '10' },
    shrink: { type: 'string', default: '25' },
    seed: { type: 'string', default: '1' },
    workers: { type: 'string', default: String(Math.max(1, os.cpus().length - 1)) },
    chunk: { type: 'string', default: '20000' },
    'eval-games': { type: 'string', default: '20000' },
    fresh: { type: 'boolean', default: false },
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
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
});

/** Collects `--deals` deals with `model` as the policy, in worker threads, with a status bar. */
async function collect(model, iteration) {
  const total = emptyTotals();
  const chunk = num(opts.chunk);
  const jobs = Math.ceil(num(opts.deals) / chunk);
  const base = { model, seed: num(opts.seed) + iteration * 1000003, size: chunk, players, epsilon: num(opts.epsilon) };
  let next = 0;
  let done = 0;
  let lastDraw = 0;
  const started = Date.now();
  const workers = Array.from({ length: Math.min(num(opts.workers), jobs) }, () => new Worker(fileURLToPath(new URL('./play-collect.js', import.meta.url)), { workerData: base }));
  await new Promise((resolve) => {
    const give = (worker) => (next < jobs ? worker.postMessage({ chunk: next++ }) : worker.terminate());
    for (const worker of workers) {
      worker.on('message', ({ totals }) => {
        for (const key of ['fineSum', 'fineN', 'coarseSum', 'coarseN']) for (let i = 0; i < total[key].length; i++) total[key][i] += totals[key][i];
        total.deals += totals.deals;
        total.plays += totals.plays;
        done++;
        const now = Date.now();
        if (process.stderr.isTTY && (now - lastDraw > 250 || done === jobs)) {
          lastDraw = now;
          const rate = (done * chunk) / ((now - started) / 1000);
          const eta = Math.round(((jobs - done) * chunk) / rate);
          process.stderr.write(`\r  [${'#'.repeat(Math.round((30 * done) / jobs)).padEnd(30, '-')}] ${((100 * done) / jobs).toFixed(0).padStart(3)}%  ${Math.round(rate).toLocaleString('en-GB')} deals/s  ETA ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, '0')}\x1b[K`);
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

/** Turns the collected sums into a table: a coarse cell needs `--min-coarse` plays; a fine cell is pulled towards its coarse cell. */
function learn(total) {
  const minCoarse = num(opts['min-coarse']);
  const shrink = num(opts.shrink);
  const model = emptyPlayModel();
  let sum = 0;
  let count = 0;
  let coarseFilled = 0;
  for (let i = 0; i < COARSE_CELLS; i++) {
    sum += total.coarseSum[i];
    count += total.coarseN[i];
    if (total.coarseN[i] >= minCoarse) {
      model.coarse[i] = total.coarseSum[i] / total.coarseN[i];
      coarseFilled++;
    }
  }
  const overall = sum / count;
  let fineFilled = 0;
  for (let i = 0; i < FINE_CELLS; i++) {
    if (!total.fineN[i]) continue;
    const prior = model.coarse[coarseOfFine(i)];
    model.fine[i] = (total.fineSum[i] + shrink * (Number.isNaN(prior) ? overall : prior)) / (total.fineN[i] + shrink);
    fineFilled++;
  }
  return { model, fineFilled, coarseFilled };
}

/** Plays the table against Standard (alternate seats) at every player count, in child processes, and prints the scores. */
function evaluate() {
  const games = num(opts['eval-games']);
  if (!games) return;
  const rows = [];
  for (const count of players) {
    const names = Array.from({ length: count }, (_, i) => (i % 2 ? 'standard' : 'lut'));
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('./tourney.js', import.meta.url)), '--games', String(games), '--ai', names.join(','), '--json'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (run.status !== 0) throw new Error(`evaluation failed: ${run.stderr}`);
    const result = JSON.parse(run.stdout);
    rows.push(`${count}p ${result.lut['mean score']} v ${result.standard['mean score']}`);
  }
  console.log(`  lut v standard (mean score): ${rows.join(' | ')}`);
}

let model = opts.fresh ? null : loadPlayModel();
console.log(`${players.join(',')} players, ${num(opts.iterations)} iterations of ${num(opts.deals).toLocaleString('en-GB')} deals, starting from ${model ? 'the saved table' : "Standard's play"}`);
for (let iteration = 0; iteration < num(opts.iterations); iteration++) {
  const started = Date.now();
  const total = await collect(model, iteration);
  const learned = learn(total);
  model = learned.model;
  savePlayModel(model, { trainedOn: { players, deals: total.deals, plays: total.plays, epsilon: num(opts.epsilon), iteration, savedAt: new Date().toISOString() } });
  console.log(`iteration ${iteration + 1}: ${total.deals.toLocaleString('en-GB')} deals, ${total.plays.toLocaleString('en-GB')} recorded plays, ${learned.fineFilled.toLocaleString('en-GB')} fine and ${learned.coarseFilled.toLocaleString('en-GB')} coarse cells, ${Math.round((Date.now() - started) / 1000)}s`);
  evaluate();
}
