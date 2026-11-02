// Helpers for the AI tests: play a whole game of computer players, and run a seeded tournament.  Not used by the game.
// Depends on game.js (rules), bot.js (the bot driver), shared/arena.js (round-robin tallying), and shared/testkit.js (seeded rng).
import * as game from './game.js';
import * as bot from './bot.js';
import { roundRobin } from '../../shared/arena.js';
import { seeded } from '../../shared/testkit.js';

/**
 * Plays one complete game between computer players, one per entry of `ais` (AI ids, in seat order).  Returns the room and
 * how many actions were taken. `onStep(room, action)` is called after each action.
 *
 * @param {string[]} ais  AI ids, one per seat in seat order
 * @param {{ seed?: number, badPrivate?: boolean, onStep?: ((room: object, action: object) => void) | null, limit?: number }} [options]
 *   seed for the rng; badPrivate for the unlucky private objectives; onStep an observer; limit a cap on actions so a stuck
 *   game cannot loop for ever
 * @returns {{ room: object, steps: number }} the finished (or limit-stopped) room and the number of actions taken
 * @throws {Error} if the game cannot start, or stops waiting for a person
 *
 * Side effects: creates and mutates a private in-memory room; no logs or writes.  Calls onStep after every action.
 */
export function playBotGame(ais, { seed = 1, badPrivate = false, onStep = null, limit = 20000 } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'p1', size: ais.length, settings: { badPrivate } });
  game.fillWithBots(room, 1);
  room.seats[0] = { kind: 'human', id: 1, name: 'p1' }; // somebody has to be able to start it
  if (!game.start(room, 1, rng).ok) throw new Error('the game does not start');
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
 * A seeded round-robin: every game seats the given AIs at one table, rotating who sits where, and tallies each AI's mean
 * score and win share (a shared win counts as a fraction).  Every fourth game uses the unlucky private objectives.
 * Returns { [id]: { games, mean, wins, winRate } }.
 *
 * @param {string[]} ais  AI ids, one per seat
 * @param {{ games?: number, seed?: number }} [options]  number of games and the base seed
 * @returns {object} the tally
 *
 * Side effects: none outside the games it plays (each in its own in-memory room).
 */
export function tournament(ais, { games = 100, seed = 1 } = {}) {
  return roundRobin(ais, {
    games,
    seed,
    // Plays one game for the arena at the given table and seed; every fourth game (g % 4 === 3) uses the unlucky privates.
    play: (table, gameSeed, g) => playBotGame(table, { seed: gameSeed, badPrivate: g % 4 === 3 }).room,
    // The score the arena tallies for a seat: its final total.
    totalOf: (room, seat) => room.final.players[seat].total,
  });
}
