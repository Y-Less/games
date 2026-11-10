// What the computer players of Hearts do next, and the doing of it.  How a computer *chooses* is its AI's business
// (see ai/, reached through game.botPassFor and game.botPlay); this file only decides whose turn it is to be asked and
// applies the answer through the ordinary rules, so a computer can never make a move a person could not.
//
// It is a file of its own because that is where the other modules keep this: azulejo, gaudi, rummikub and splendour all
// have a bot.js and their server.js drives the game through it.  Hearts, Cheat and Nomination Whist kept the same two
// functions in game.js instead, which meant a server.js had to know which kind of module it was adapting.
//
// Randomness is always passed in as `rng` (the server and the tests inject it); there is no default.
// Depends on: ./game.js (the rules, and the AI lookups).
import * as game from './game.js';

/**
 * The next thing a computer (or the clock) has to do, or null when the game waits for a person.
 * @param {object} room  not changed.
 * @returns {{type: 'pass'|'play'|'resolve', seat?: number, key: string}|null} the pending action; `key` names it, and stays
 *   the same while unrelated things happen (another person passing, somebody connecting), so the server's timer for it is
 *   not restarted by them.
 * Side effects: none.
 */
export function pendingAction(room) {
  if (room.phase === 'passing') {
    const seat = room.seats.findIndex((s, i) => game.isBot(s) && !room.passes[i]);
    return seat === -1 ? null : { type: 'pass', seat, key: `pass:${seat}:${room.handNumber}` };
  }
  if (room.phase !== 'playing') return null;
  if (room.trick.length === room.seats.length) return { type: 'resolve', key: `resolve:${room.handNumber}:${room.tricksPlayed}` };
  return game.isBot(room.seats[room.turn]) ? { type: 'play', seat: room.turn, key: `play:${room.turn}:${room.handNumber}:${room.tricksPlayed}:${room.trick.length}` } : null;
}

/**
 * Performs a pending action.  Returns the action, or null if there was nothing to do.
 * @param {object} room  the room.
 * @param {() => number} rng  random source for the computer players.
 * @returns {{type: string, seat?: number}|null} the action performed.
 * Side effects: mutates the room (a computer pass, play, or the resolving of a full trick); throws if a computer makes an illegal move.
 */
export function runPending(room, rng) {
  const action = pendingAction(room);
  if (!action) return null;
  const result =
    action.type === 'pass'
      ? game.choosePass(room, action.seat, game.botPassFor(room, action.seat, rng))
      : action.type === 'play'
        ? game.playCard(room, action.seat, game.botPlay(room, action.seat, rng))
        : game.resolveTrick(room);
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}
