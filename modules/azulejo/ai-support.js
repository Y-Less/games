// Helpers for the AI tests: play a whole game of computer players, and run a seeded tournament.  Not used by the game.
// Depends on: ./game.js and ./bot.js (to play), shared/arena.js (the round-robin), and shared/testkit.js (seeded rng).
import * as game from './game.js';
import * as bot from './bot.js';
import { roundRobin } from '../../shared/arena.js';
import { seeded } from '../../shared/testkit.js';

/**
 * Plays one complete game between computer players, one per entry of `ais` (AI ids, in seat order). `onStep(room, action)`
 * is called after each action.
 *
 * @param {string[]} ais  the AI id of each seat
 * @param {{ seed?: number, free?: boolean, onStep?: Function | null, limit?: number }} options  rng seed, free wall, a per-action callback, and the most actions before giving up
 * @returns {{ room: object, steps: number }} the finished room and how many actions were taken
 *
 * Side effects: builds and mutates its own room; throws if the game stalls or an AI makes an illegal move.
 */
export function playBotGame(ais, { seed = 1, free = false, onStep = null, limit = 5000 } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: ais.length, settings: { freeWall: free } });
  game.fillWithBots(room, 1);
  room.seats[0] = { kind: 'human', id: 1, name: 'p1' }; // somebody has to be able to start it
  assert(game.start(room, 1, rng).ok, 'the game starts');
  // Seat the requested AIs now that the game has started (start() would have chosen random ones).
  ais.forEach((id, seat) => (room.seats[seat] = { kind: 'bot', id: `bot:${seat}`, name: `Bot ${seat}`, ai: id }));
  let steps = 0;
  while (room.phase !== 'finished' && steps < limit) {
    const action = bot.runPending(room, rng);
    if (!action) throw new Error('the game stopped waiting for a person');
    steps++;
    onStep?.(room, action);
  }
  return { room, steps };
}

/**
 * A tiny assertion, so this helper does not need node:assert.
 *
 * @param {any} condition  must be truthy
 * @param {string} message  the error text when it is not
 *
 * Side effects: throws an Error when the condition is falsy.
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * A seeded round-robin: every game seats the given AIs at one table, rotating who sits where, and tallies each AI's mean
 * score and win share (a shared win counts as a fraction). `rounds` on the result is how many rounds each game lasted.
 *
 * @param {string[]} ais  AI ids, one per seat
 * @param {{ games?: number, seed?: number, free?: boolean }} options  `free` makes every second game a free-wall one
 * @returns {object} { [id]: { games, mean, wins, winRate } } plus `rounds`
 *
 * Side effects: plays whole games on rooms of its own; nothing outside is changed.
 */
export function tournament(ais, { games = 100, seed = 1, free = false } = {}) {
  const rounds = [];
  const tally = roundRobin(ais, {
    games,
    seed,
    play: (table, gameSeed, g) => {
      const { room } = playBotGame(table, { seed: gameSeed, free: free && g % 2 === 1 });
      rounds.push(room.playedRounds);
      return room;
    },
    totalOf: (room, seat) => room.final.players[seat].total,
  });
  tally.rounds = rounds;
  return tally;
}
