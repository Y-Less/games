// Helpers for the AI tests: play a whole game of computer players, and run a seeded tournament. Not used by the game.
import * as game from './game.js';
import * as bot from './bot.js';
import { roundRobin } from '../../shared/arena.js';
import { seeded } from '../../shared/testkit.js';

/**
 * Plays one complete game between computer players, one per entry of `ais` (AI ids, in seat order). Returns the room and
 * how many actions were taken. `onStep(room, action)` is called after each action.
 */
export function playBotGame(ais, { seed = 1, free = false, onStep = null, limit = 5000 } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: ais.length, settings: { freeWall: free } });
  game.fillWithBots(room, 1);
  room.seats[0] = { kind: 'human', id: 1, name: 'p1' }; // somebody has to be able to start it
  assert(game.start(room, 1, rng).ok, 'the game starts');
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * A seeded round-robin: every game seats the given AIs at one table, rotating who sits where, and tallies each AI's mean
 * score and win share (a shared win counts as a fraction). Returns { [id]: { games, mean, wins, winRate } }, and `rounds`:
 * how many rounds each game lasted.
 *
 * @param {string[]} ais  AI ids, one per seat
 * @param {{ games?: number, seed?: number, free?: boolean }} [options]  `free` makes every second game a free-wall one
 * @returns {object} the tally
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
