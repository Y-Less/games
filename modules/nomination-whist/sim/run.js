#!/usr/bin/env node
// Runs Nomination Whist simulations on every core of this machine and collects the counts. Run it from the platform
// folder:  node modules/nomination-whist/sim/run.js --deals 5000000 --out sim-out/whist
// See README.md for the options, what is counted and how to use it. Ctrl-C stops cleanly: the counts so far are saved
// and `--resume` carries on from there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { DUMP_ROW_BYTES, POLICIES, seatAIs } from './engine.js';
import { loadCounts, saveCounts, writeCsvs } from './export.js';
import { MAX_CARDS, MAX_PLAYERS, MIN_PLAYERS, Stats, TRUMPS } from './tables.js';
import { scenariosOf } from './worker.js';

const HELP = `Usage: node modules/nomination-whist/sim/run.js [options]

  --deals N          deals to play in total (default 1000000; underscores allowed, e.g. 5_000_000)
  --players LIST     player counts, e.g. 4 or 3-7 or 3,4,6   (default 3-7)
  --cards LIST       cards each, e.g. 7 or 1-7                (default 1-7)
  --trumps LIST      trump suits H,C,D,S and N for no trumps  (default H,C,D,S,N)
  --ai POLICY        who plays: an AI id (${POLICIES.join(', ')}),
                     a comma list used seat by seat, mix (random AIs) or contest (everyone fights for every trick).
                     Default standard. "sharp" is far slower than the rest.
  --seed N           base seed (default 1); the same seed and options give the same counts
  --workers N        worker threads (default: cores - 1)
  --chunk N          deals per job (default 20000)
  --out DIR          where the counts and CSV files go (default sim-out/whist)
  --resume           carry on from the counts already in --out (needs the same options)
  --dump             also write hands.bin, one row per hand dealt (large: about 13 bytes a hand)
  --instant-win      let AIs go for the 7-card instant win (default off)
  --no-miss-points   a miss scores nothing (default: misses score the tricks taken)
  --csv-every N      rewrite the CSV files every N chunks (default 50; they are also written at the end)
  --help
`;

const { values: opts } = parseArgs({
  options: {
    deals: { type: 'string', default: '1000000' },
    players: { type: 'string', default: '3-7' },
    cards: { type: 'string', default: '1-7' },
    trumps: { type: 'string', default: TRUMPS.join(',') },
    ai: { type: 'string', default: 'standard' },
    seed: { type: 'string', default: '1' },
    workers: { type: 'string', default: String(Math.max(1, os.cpus().length - 1)) },
    chunk: { type: 'string', default: '20000' },
    out: { type: 'string', default: 'sim-out/whist' },
    resume: { type: 'boolean', default: false },
    dump: { type: 'boolean', default: false },
    'instant-win': { type: 'boolean', default: false },
    'no-miss-points': { type: 'boolean', default: false },
    'csv-every': { type: 'string', default: '50' },
    help: { type: 'boolean', default: false },
  },
});
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const whole = (text, name, min = 1) => {
  const n = Number(String(text).replaceAll('_', ''));
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be a whole number of at least ${min}`);
  return n;
};
/** "3-7", "4" or "3,5,6" -> [3, 4, 5, 6, 7] and so on, within bounds. */
function listOf(text, name, min, max) {
  const out = new Set();
  for (const part of String(text).split(',')) {
    const [from, to = from] = part.split('-').map((s) => Number(s.trim()));
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || from < min || to > max) throw new Error(`--${name} "${text}" must be within ${min}-${max}`);
    for (let n = from; n <= to; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

const config = {
  players: listOf(opts.players, 'players', MIN_PLAYERS, MAX_PLAYERS),
  cards: listOf(opts.cards, 'cards', 1, MAX_CARDS),
  trumps: opts.trumps.split(',').map((t) => t.trim().toUpperCase()),
  ai: opts.ai,
  seed: whole(opts.seed, 'seed', 0),
  chunkSize: whole(opts.chunk, 'chunk'),
  dump: opts.dump,
  instantWin: opts['instant-win'],
  missPoints: !opts['no-miss-points'],
};
for (const t of config.trumps) if (!TRUMPS.includes(t)) throw new Error(`--trumps: "${t}" is not one of ${TRUMPS.join(', ')}`);
seatAIs(config.ai, 3, Math.random); // fails early on an unknown AI

const totalDeals = whole(opts.deals, 'deals');
const chunks = Math.ceil(totalDeals / config.chunkSize);
const workerCount = Math.min(whole(opts.workers, 'workers'), chunks);
const csvEvery = whole(opts['csv-every'], 'csv-every');
const outDir = path.resolve(opts.out);
const scenarios = scenariosOf(config).length;

let stats = new Stats();
const done = new Set();
if (opts.resume) {
  const saved = loadCounts(outDir);
  if (!saved) throw new Error(`--resume: nothing to resume in ${outDir}`);
  if (JSON.stringify(saved.meta.config) !== JSON.stringify(config)) throw new Error('--resume: the options differ from the saved run (compare meta.json). Use a new --out, or the same options.');
  stats = Stats.fromFloats(saved.stats.toFloats(), saved.stats.deals);
  for (const id of saved.meta.doneChunks) done.add(id);
  console.log(`Resuming: ${done.size} of ${chunks} chunks (${stats.deals.toLocaleString()} deals) already done.`);
} else if (fs.existsSync(path.join(outDir, 'meta.json'))) {
  throw new Error(`${outDir} already holds a run. Use --resume to carry on, or choose another --out.`);
}
fs.mkdirSync(outDir, { recursive: true });
const dumpFile = config.dump ? fs.openSync(path.join(outDir, 'hands.bin'), opts.resume ? 'a' : 'w') : null;

console.log(
  `${totalDeals.toLocaleString()} deals in ${chunks} chunks of ${config.chunkSize.toLocaleString()}, ${scenarios} scenarios ` +
    `(players ${config.players.join(',')}; cards ${config.cards.join(',')}; trumps ${config.trumps.join(',')}), AI "${config.ai}", ${workerCount} workers -> ${outDir}`,
);
if (/sharp/.test(config.ai) || config.ai === 'mix') console.log('Note: "sharp" simulates inside every decision and is hundreds of times slower than the other AIs.');

const checkpoint = () => saveCounts(stats, { config, doneChunks: [...done].sort((a, b) => a - b), totalChunks: chunks }, outDir);
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log('\nStopping after the jobs in progress ...');
});

const pending = [];
for (let id = 0; id < chunks; id++) if (!done.has(id)) pending.push(id);
const started = Date.now();
const startDeals = stats.deals;
let sinceCsv = 0;
let lastLine = 0;

await new Promise((resolve, reject) => {
  if (!pending.length) return resolve();
  let running = 0;
  const workers = [];
  const finish = () => {
    if (running === 0) {
      for (const w of workers) w.terminate();
      resolve();
    }
  };
  const next = (worker) => {
    if (stopping || !pending.length) {
      running--;
      return finish();
    }
    worker.postMessage({ config, chunk: pending.shift() });
  };
  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker(fileURLToPath(new URL('./worker.js', import.meta.url)));
    workers.push(worker);
    running++;
    worker.on('error', reject);
    worker.on('message', ({ chunk, stats: message, dump }) => {
      stats.merge(Stats.fromMessage(message));
      done.add(chunk);
      if (dump && dumpFile !== null) fs.writeSync(dumpFile, dump);
      sinceCsv++;
      if (done.size % 5 === 0) checkpoint();
      if (sinceCsv >= csvEvery) {
        sinceCsv = 0;
        writeCsvs(stats, outDir);
      }
      const now = Date.now();
      if (now - lastLine > 5000) {
        lastLine = now;
        const rate = (stats.deals - startDeals) / ((now - started) / 1000);
        const left = (chunks - done.size) * config.chunkSize;
        console.log(`${done.size}/${chunks} chunks, ${stats.deals.toLocaleString()} deals, ${Math.round(rate).toLocaleString()} deals/s, about ${Math.round(left / rate / 60)} min left`);
      }
      next(worker);
    });
    next(worker);
  }
});

checkpoint();
const files = writeCsvs(stats, outDir);
if (dumpFile !== null) fs.closeSync(dumpFile);
const seconds = (Date.now() - started) / 1000;
console.log(`${stopping ? 'Stopped' : 'Finished'}: ${stats.deals.toLocaleString()} deals in ${Math.round(seconds)} s. Wrote ${files.join(', ')}, tables.bin and meta.json to ${outDir}.`);
if (config.dump) console.log(`hands.bin has ${DUMP_ROW_BYTES} bytes per hand (see README).`);
process.exit(0);
