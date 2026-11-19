// A test bench for the Zurubang computer players: whole games of computers against computers, with a chosen AI in
// each seat.  Used by ai.test.js and views.js, and handy from a script.  Every move goes through the real rules, so a
// game that finishes here is a game the rules allowed from beginning to end.
// Depends on ./game.js and shared/random.js.
import * as g from './game.js';
import { seeded } from '../../shared/random.js';

export { seeded };

/** How many moves a game is given before the bench decides the rules have stalled. */
const GUARD = 20000;

/**
 * Plays one whole game between two computer players.
 *
 * @param {object} options
 * @param {string[]} options.ais  the AI id for each of the two seats
 * @param {number} [options.seed]  the seed for the default rng
 * @param {object} [options.settings]  room settings (the target, by default 30)
 * @param {() => number} [options.rng]  the random source
 * @param {(room: object) => void} [options.watch]  called after every move, for a test that wants every state
 * @returns {{ room: object, moves: number, scores: number[] }} the finished room and how long it took
 * Side effects: none outside the room it makes; advances the rng; throws if the game stalls or will not finish.
 */
export function playGame({ ais, seed = 1, settings = {}, rng = seeded(seed), watch }) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { target: 30, ...settings }, now: 0 });
  g.fillWithBots(room, 1);
  g.start(room, 1, rng);
  // The second seat has to be a person for the game to start, so the bench puts a computer player in it afterwards.
  room.seats[0] = { ...room.seats[0], kind: 'bot', id: 'bot:90' };
  room.seats.forEach((seat, i) => (seat.ai = ais[i] ?? ais[0]));
  watch?.(room);

  let moves = 0;
  for (; moves < GUARD && room.phase !== 'finished'; moves++) {
    if (room.phase === 'revealing') {
      insist(g.revealNext(room, rng), room);
      watch?.(room);
      continue;
    }
    const pending = g.pendingBot(room);
    if (!pending) throw new Error(`nothing to do in ${room.phase}`);
    insist(g.botMove(room, rng, pending), room);
    watch?.(room);
  }
  if (room.phase !== 'finished') throw new Error(`the game did not finish (${moves} moves, phase ${room.phase})`);
  return { room, moves, scores: room.seats.map((seat) => seat.score) };
}

/** A refused move in the bench is a bug in the rules or in an AI, so it stops the game rather than being skipped. */
function insist(outcome, room) {
  if (!outcome.ok) throw new Error(`refused in ${room.phase}: ${outcome.error}`);
  return outcome;
}

/**
 * Plays `games` games with `subject` against `field`, swapping seats each game so that neither seat is favoured.
 *
 * @param {object} options
 * @param {string} options.subject  the AI under test
 * @param {string} options.field    the AI it plays
 * @param {number} options.games    how many to play
 * @param {number} [options.seedBase]  the first game's seed
 * @param {object} [options.settings]
 * @returns {object} the totals: games, wins, points, duels, and the moves it all took
 * Side effects: none.
 */
export function versus({ subject, field, games, seedBase = 1, settings = {} }) {
  const out = { games, subjectWins: 0, fieldWins: 0, subjectPoints: 0, fieldPoints: 0, duels: 0, moves: 0 };
  for (let n = 0; n < games; n++) {
    const seat = n % 2;
    const ais = seat === 0 ? [subject, field] : [field, subject];
    const { room, moves, scores } = playGame({ ais, seed: seedBase + n, settings });
    out.moves += moves;
    out.duels += room.seats[seat].stats.duelsFought;
    out.subjectPoints += scores[seat];
    out.fieldPoints += scores[seat === 0 ? 1 : 0];
    if (room.winner === seat) out.subjectWins += 1;
    else out.fieldWins += 1;
  }
  return out;
}
