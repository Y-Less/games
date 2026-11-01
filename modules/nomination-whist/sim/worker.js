// One worker thread: plays a chunk of deals and sends the counts back. The chunk number fixes the seed and which
// scenarios it covers, so a chunk always gives the same answer wherever and whenever it is run.
// Depends on: engine.js (playDeal), tables.js (Stats), rng.js. run.js starts one of these per core.
import { parentPort } from 'node:worker_threads';
import { playDeal } from './engine.js';
import { mulberry32, mixSeed } from './rng.js';
import { Stats } from './tables.js';

/**
 * Every players x cards x trump combination wanted, in a fixed order.
 * @param {{ players: number[], cards: number[], trumps: string[] }} config  the run's scenario lists
 * @returns {{ players: number, cards: number, trump: string }[]} the scenarios
 * Side effects: none.
 */
export function scenariosOf(config) {
  return config.players.flatMap((players) => config.cards.flatMap((cards) => config.trumps.map((trump) => ({ players, cards, trump }))));
}

/**
 * Plays the deals of one chunk (with the two Jokers shuffled in when `config.jokers` is true); returns { stats, dump }.
 * @param {object} config  the run's config (scenarios, chunkSize, seed, ai, dump, instantWin, missPoints, jokers)
 * @param {number} chunk  the chunk number, which fixes the seed and the first scenario
 * @returns {{ stats: import('./tables.js').Stats, dump: Uint8Array | null }} the counts and, if dumping, the hands rows
 * Side effects: none (the RNG is local to the chunk).
 */
export function runChunk(config, chunk) {
  const scenarios = scenariosOf(config);
  const rng = mulberry32(mixSeed(config.seed, chunk));
  const stats = new Stats();
  const dump = config.dump ? [] : null;
  const first = chunk * config.chunkSize;
  for (let i = 0; i < config.chunkSize; i++) {
    const scenario = scenarios[(first + i) % scenarios.length]; // every scenario gets the same number of deals, give or take one
    playDeal({ ...scenario, policy: config.ai, instantWin: config.instantWin, missPoints: config.missPoints, jokers: config.jokers === true }, rng, stats, dump);
  }
  return { stats, dump: dump ? Uint8Array.from(dump) : null };
}

// Worker entry point: each message is a { config, chunk } job, answered with the chunk's counts.
if (parentPort) {
  parentPort.on('message', ({ config, chunk }) => {
    const started = Date.now();
    const { stats, dump } = runChunk(config, chunk);
    parentPort.postMessage({ chunk, stats: stats.toMessage(), dump, ms: Date.now() - started });
  });
}
