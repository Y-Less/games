// One worker thread: plays a chunk of deals and sends the counts back. The chunk number fixes the seed and which
// scenarios it covers, so a chunk always gives the same answer wherever and whenever it is run.
import { parentPort } from 'node:worker_threads';
import { playDeal } from './engine.js';
import { mulberry32, mixSeed } from './rng.js';
import { Stats } from './tables.js';

/** Every players x cards x trump combination wanted, in a fixed order. */
export function scenariosOf(config) {
  return config.players.flatMap((players) => config.cards.flatMap((cards) => config.trumps.map((trump) => ({ players, cards, trump }))));
}

/** Plays the deals of one chunk; returns { stats, dump }. */
export function runChunk(config, chunk) {
  const scenarios = scenariosOf(config);
  const rng = mulberry32(mixSeed(config.seed, chunk));
  const stats = new Stats();
  const dump = config.dump ? [] : null;
  const first = chunk * config.chunkSize;
  for (let i = 0; i < config.chunkSize; i++) {
    const scenario = scenarios[(first + i) % scenarios.length]; // every scenario gets the same number of deals, give or take one
    playDeal({ ...scenario, policy: config.ai, instantWin: config.instantWin, missPoints: config.missPoints }, rng, stats, dump);
  }
  return { stats, dump: dump ? Uint8Array.from(dump) : null };
}

if (parentPort) {
  parentPort.on('message', ({ config, chunk }) => {
    const started = Date.now();
    const { stats, dump } = runChunk(config, chunk);
    parentPort.postMessage({ chunk, stats: stats.toMessage(), dump, ms: Date.now() - started });
  });
}
