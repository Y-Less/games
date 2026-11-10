// The pieces every game's "Recent moves" works out the same way.
//
// A game's log is not kept by the server: the client compares the state it has just been sent with the one before and
// turns the difference into lines (see any module's client/moveLog.js).  Most of that is the game's own — what a turn
// is, what counts as news — but four things are not, and were written out once per game.
//
// These are for the games whose members are a growing list of players (`next.players`, shared/layout.js's roster
// family).  The three seat games keep their own: a seat log reads `next.seats[n]`, which is a different lookup, and
// two of them hold the whole log rather than the lines it has just gained.  One helper for both would be a lookup
// taking a collection and an accessor, which is longer to say than either version is to write.
//
// Depends on shared/messages.js only, so it runs on the client with no browser and no socket.
import { msg } from './messages.js';

/**
 * Has the room just entered this phase?  True on the one step that reaches it, and false on every later step while it
 * stays there, which is what makes a line appear once rather than on every state.
 * @param {object | null} prev  the state before (null for the first state received)
 * @param {object} next  the state that has just arrived
 * @param {string} phase  the phase being entered
 * @returns {boolean}
 * Side effects: none.
 */
export const entering = (prev, next, phase) => next.phase === phase && prev?.phase !== phase;

/**
 * A way of naming the players of a state: the name this player has in the new state, or the site's "Someone" when they
 * have gone, because a line about somebody who has since left still has to say who it was about.
 * @param {object} next  the state that has just arrived
 * @returns {(id: number | string) => string | object} the name, or the "Someone" message
 * Side effects: none.
 */
export const nameIn = (next) => (id) => next.players.find((p) => p.id === id)?.name ?? msg('common.someone');

/**
 * A line for each player whose flag has just turned true: "Ann has written hers", and so on.  Order follows the new
 * state's player list, so the lines read in the order the table shows people in rather than the order they acted.
 * @param {object | null} prev  the state before
 * @param {object} next  the state that has just arrived
 * @param {string} flag  the player field that goes from false to true (e.g. 'written', 'guessed', 'picked')
 * @param {string} key  the message key for one player's line, which is given `{ name }`
 * @returns {object[]} the lines as messages
 * Side effects: none.
 */
export function newlyFlagged(prev, next, flag, key) {
  if (!prev) return [];
  return next.players.filter((p) => p[flag] && !prev.players.find((q) => q.id === p.id)?.[flag]).map((p) => msg(key, { name: p.name }));
}

/**
 * The line that says who won, on the step the game finishes and not before.  A game that ends with nobody marked a
 * winner says nothing, which is how a game abandoned part-way ends quietly.
 * @param {object | null} prev  the state before
 * @param {object} next  the state that has just arrived
 * @returns {object[]} the line, or nothing
 * Side effects: none.
 */
export function endOfGame(prev, next) {
  if (!entering(prev, next, 'finished')) return [];
  const winners = next.players.filter((p) => p.winner).map((p) => p.name);
  return winners.length ? [msg('log.gameOver', { names: winners, count: winners.length })] : [];
}
