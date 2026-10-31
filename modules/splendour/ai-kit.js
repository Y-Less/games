// Helpers for the AI tests: whole computer-only games with chosen AIs, and tournaments between them.
import * as game from './game.js';
import * as bot from './bot.js';
import { botsOnly, checkInvariants } from './kit.js';
import { seeded } from '../../shared/testkit.js';

/**
 * Plays one all-bot game to the end.
 *
 * @param {string[]} ids  the AI for each seat in turn order
 * @param {() => number} rng
 * @param {{ target?: number, check?: boolean }} options  `check` runs the invariants after every step
 * @returns {object} the finished room
 */
export function playWith(ids, rng, { target = 15, check = false } = {}) {
  const room = botsOnly(ids.length, rng, { target });
  room.ais = Object.fromEntries(ids.map((id, i) => [`bot:x${i}`, id]));
  let steps = 0;
  while (room.phase === 'playing') {
    if (!bot.runPending(room, rng)) throw new Error('nobody had anything to do');
    if (check) checkInvariants(room, `${ids} step ${steps}`);
    if (++steps > 2000) throw new Error(`the game did not end (${ids})`);
  }
  return room;
}

/**
 * Plays `games` games between the AIs in `lineup` (each game a fresh deal, with the seats rotated so that nobody
 * always goes first).
 *
 * @param {string[]} lineup  AI ids, one per seat
 * @param {number} games
 * @param {number} seed  makes the run repeatable
 * @param {object} options  as for playWith
 * @returns {Record<string, { games: number, wins: number, rate: number }>} wins (shared wins count as a fraction)
 */
export function tournament(lineup, games, seed, options) {
  const rng = seeded(seed);
  const tally = Object.fromEntries([...new Set(lineup)].map((id) => [id, { games: 0, wins: 0, rate: 0 }]));
  for (let g = 0; g < games; g++) {
    const turn = g % lineup.length;
    const ids = [...lineup.slice(turn), ...lineup.slice(0, turn)];
    const room = playWith(ids, rng, options);
    ids.forEach((id, seat) => {
      tally[id].games++;
      if (room.winners.includes(seat)) tally[id].wins += 1 / room.winners.length;
    });
  }
  for (const row of Object.values(tally)) row.rate = row.wins / row.games;
  return tally;
}

/** One line of win rates, e.g. "sharp 62.5%, random 12.5%". */
export const summary = (tally) => Object.entries(tally).map(([id, r]) => `${id} ${(r.rate * 100).toFixed(1)}%`).join(', ');
