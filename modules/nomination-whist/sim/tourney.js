#!/usr/bin/env node
// Plays whole games of Nomination Whist between AIs, on every core, and reports how each AI did. Run it from the platform
// folder:  node modules/nomination-whist/sim/tourney.js --games 20000 --ai sharp,standard,counter,random
// The AI list is one entry per seat (so its length is the number of players). Seats are rotated game by game, and the
// first dealer is random, so position does not favour anybody. The same seed and options give the same results.
import os from 'node:os';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { MAX_SEATS, MIN_SEATS } from '../game.js';
import { FULL_SCHEDULE, SHORT_SCHEDULE } from './game.js';
import { blank, byId, playGames } from './tournament.js';

if (!isMainThread) {
  parentPort.on('message', (job) => parentPort.postMessage({ job: job.id, totals: playGames({ ...workerData, ...job }) }));
} else {
  const HELP = `Usage: node modules/nomination-whist/sim/tourney.js [options]

  --ai LIST        one AI id per seat, e.g. sharp,standard,counter,random (${[...byId.keys()].join(', ')})   (default standard x4)
  --games N        games to play (default 10000; underscores allowed)
  --short          the 7-down-to-1 game (seven rounds) instead of the full fourteen
  --no-instant-win nominating 7 and taking all 7 tricks in a 7-card first or last round does not end the game (default: it does)
  --no-miss-points a miss scores nothing (default: a miss scores the tricks taken)
  --seed N         base seed (default 1)
  --workers N      worker threads (default: cores - 1)
  --chunk N        games per job (default 200)
`;
  const { values: opts } = parseArgs({
    options: {
      ai: { type: 'string', default: 'standard,standard,standard,standard' },
      games: { type: 'string', default: '10000' },
      short: { type: 'boolean', default: false },
      'no-instant-win': { type: 'boolean', default: false },
      'no-miss-points': { type: 'boolean', default: false },
      seed: { type: 'string', default: '1' },
      workers: { type: 'string', default: String(Math.max(1, os.cpus().length - 1)) },
      chunk: { type: 'string', default: '200' },
      help: { type: 'boolean', default: false },
    },
  });
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }
  const names = opts.ai.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = names.find((n) => !byId.has(n));
  if (unknown) throw new Error(`Unknown AI "${unknown}" (use ${[...byId.keys()].join(', ')})`);
  if (names.length < MIN_SEATS || names.length > MAX_SEATS) throw new Error(`--ai needs ${MIN_SEATS} to ${MAX_SEATS} entries`);
  const num = (text) => Number(String(text).replaceAll('_', ''));
  const games = num(opts.games);
  const chunk = num(opts.chunk);
  const base = { names, seed: num(opts.seed), schedule: opts.short ? SHORT_SCHEDULE : FULL_SCHEDULE, missPoints: !opts['no-miss-points'], instantWin: !opts['no-instant-win'] };

  const jobs = Array.from({ length: Math.ceil(games / chunk) }, (_, id) => ({ id, from: id * chunk, to: Math.min(games, (id + 1) * chunk) }));
  const totals = Object.fromEntries([...new Set(names)].map((name) => [name, blank()]));
  const started = Date.now();
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(num(opts.workers), jobs.length) }, () => new Worker(fileURLToPath(import.meta.url), { workerData: base }));
  const give = (worker) => (next < jobs.length ? worker.postMessage(jobs[next++]) : worker.terminate());
  await new Promise((resolve) => {
    for (const worker of workers) {
      worker.on('message', ({ totals: part }) => {
        for (const [name, t] of Object.entries(part)) for (const key of Object.keys(t)) totals[name][key] += t[key];
        if (++done === jobs.length) resolve();
        else give(worker);
        if (done % 20 === 0) process.stderr.write(`\r${done * chunk} games, ${Math.round((done * chunk) / ((Date.now() - started) / 1000))}/s   `);
      });
      give(worker);
    }
  });
  workers.forEach((w) => w.terminate());
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n${games} games, ${names.length} players (${names.join(', ')}), ${seconds.toFixed(1)}s, ${Math.round(games / seconds)} games/s`);
  const rows = Object.entries(totals).map(([name, t]) => ({
    ai: name,
    'mean score': +(t.score / t.games).toFixed(1),
    'win %': +((100 * t.wins) / t.games).toFixed(1),
    'bid hit %': +((100 * t.hits) / t.bids).toFixed(1),
    'avg bid': +(t.bidTotal / t.bids).toFixed(2),
    'avg tricks': +(t.tricks / t.bids).toFixed(2),
    'instant wins': t.instantWins,
  }));
  console.table(rows.sort((a, b) => b['mean score'] - a['mean score']));
}
