// What the computer players of Cheat do next, and the doing of it.  How a computer *chooses* — whether to call, and
// what to put down — is its AI's business (see ai/, reached through game.botCalls and game.botPlay); this file only
// decides whose turn it is to be asked and applies the answer through the ordinary rules, so a computer can never make
// a move a person could not.
//
// It is a file of its own because that is where the other modules keep this: azulejo, gaudi, rummikub and splendour all
// have a bot.js and their server.js drives the game through it.  Cheat, Hearts and Nomination Whist kept the same two
// functions in game.js instead, which meant a server.js had to know which kind of module it was adapting.
//
// Randomness is always passed in as `rng` (the server and the tests inject it); there is no default.
// Depends on: ./game.js (the rules, and the AI lookups) and the shared rule results.
import * as game from './game.js';
import { ok } from '../../shared/seats.js';

/**
 * The next thing a computer player has to do, or null when the game waits for a person.  A decision about the last play
 * comes before a play.
 *
 * @param {object} room  not changed
 * @returns {{ type: 'decide' | 'play', seat: number, key: string } | null} the action, or null when waiting for a person;
 *   `key` names it and stays the same while unrelated things happen (a person accepting the final play, say), so the
 *   server's timer for it is not restarted by them
 * Side effects: none.
 */
export function pendingAction(room) {
  if (!['playing', 'check'].includes(room.phase)) return null;
  if (room.last) {
    const seat = room.seats.findIndex((s, i) => game.isBot(s) && i !== room.last.seat && !room.decided.includes(i));
    if (seat !== -1) return { type: 'decide', seat, key: `decide:${seat}:${room.plays}` };
  }
  if (room.phase === 'playing' && game.isBot(room.seats[room.turn])) return { type: 'play', seat: room.turn, key: `play:${room.turn}:${room.plays}` };
  return null;
}

/**
 * Performs a pending action.
 * Side effects: mutates room (a call, a decision, or a play).
 *
 * @param {object} room  the room to act on
 * @param {() => number} rng  random numbers for the AI
 * @returns {{ type: string, seat: number } | null} the action done, or null if there was nothing to do
 * @throws {Error} if a computer player's move turns out to be illegal
 */
export function runPending(room, rng) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'decide') {
    // Letting the play stand is not the same as `accept`, which is a person's answer in the check phase: a computer
    // decides about every play as it is made, and most of those are made while the game is still being played.
    if (game.botCalls(room, action.seat, rng)) result = game.callCheat(room, action.seat);
    else {
      room.decided.push(action.seat);
      game.settleCheck(room);
      result = ok();
    }
  } else result = game.playCards(room, action.seat, game.botPlay(room, action.seat, rng));
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}
