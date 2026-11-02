// The "Recent moves" list for Cheat.  The server sends the table as it is, not a history, so the client keeps one: every
// state that arrives is compared with the one before it, and what changed (a play, a call, a pick-up) is added as a line.
// Each line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put into words by the
// table when it is drawn, so the list reads in the player's language whenever they switch.  The list starts when the page
// does.  It lives outside the table component so that every state is looked at.
import { msg } from '../../../shared/messages.js';
import { rankMsg } from './rank.js';
import { callMsg } from './text.js';

const LIMIT = 120; // the most lines kept, so a long game cannot grow the list without bound
/**
 * The name shown for a seat in a state (the site's "Someone" if the seat is gone).
 * @param {object} state  A state from the server.
 * @param {number} seat  Seat index.
 * @returns {string | { key: string }} The seat's name, or the message for "Someone".
 * Side effects: none.
 */
const nameOf = (state, seat) => state.seats[seat]?.name ?? msg('common.someone');

/**
 * Works out the "Recent moves" list after a new state arrives.
 *
 * @param {object[]} log  the lines so far (messages; not changed)
 * @param {object | null} prev  the previous state, or null if there was none
 * @param {object | null} next  the state that has just arrived (null when the player left the game)
 * @returns {object[]} a new list: empty for a lobby or a different game, otherwise the old lines plus any new ones (at most LIMIT)
 *
 * Side effects: none (the input list is copied, never changed).
 */
export function advanceLog(log, prev, next) {
  if (!next || next.phase === 'lobby') return [];
  if (!prev || prev.code !== next.code) return [];
  if (prev.phase === 'lobby') return [msg('log.dealt')];
  const out = [...log];
  // Appends one line to the new list (returns nothing).
  const add = (key, params) => out.push(msg(key, params));

  if (next.plays > prev.plays && next.last) add('log.played', { name: nameOf(next, next.last.seat), count: next.last.count, rank: rankMsg(next.last.rank, next.last.count) });
  // A call is new when it differs from the previous state's: the same call arrives again in every later state.
  const call = next.lastCall;
  if (call && JSON.stringify(call) !== JSON.stringify(prev.lastCall)) {
    out.push(callMsg(call, (seat) => nameOf(next, seat), 'log'));
  }
  if (next.phase === 'finished' && prev.phase !== 'finished') add('log.wins', { name: nameOf(next, next.winner) });
  return out.length > LIMIT ? out.slice(-LIMIT) : out;
}
