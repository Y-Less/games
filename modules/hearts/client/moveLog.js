// The "Recent moves" list for Hearts.  The server sends the table as it is, not a history, so the client keeps one: every
// state that arrives is compared with the one before it, and what changed (a trick taken, a new hand) is
// added as a line.  Each line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put
// into words by the table when it is drawn, so the list reads in the player's language whenever they switch.  The list
// starts when the page does (a reload shows moves from then on).  It lives outside the table component so that every
// state is looked at, even when several arrive before the page redraws.
//
// It is a summary of the hand rather than a record of it: the deal, the pass, who took each trick, and how it ended.
// It holds two hands, the one being played and the one before it, which is about a dozen lines each and bounds the
// list without needing a separate limit on its length.  What it is for is catching up on what happened while you were
// looking elsewhere, which wants something readable at a glance.
import { msg } from '../../../shared/messages.js';

/** How many hands the list keeps: the current one and the one before it. */
const HANDS_KEPT = 2;

/**
 * A seat's name for a log line.
 * @param {object} state  a view from the server
 * @param {number} seat  the seat number
 * @returns {string | { key: string }} the name, or the site's "Someone" if the seat is empty
 * Side effects: none.
 */
const nameOf = (state, seat) => state.seats[seat]?.name ?? msg('common.someone');

/**
 * The log after `next` arrives, given the log so far and the previous state (null when there was none).  It is empty when
 * there is no game, a lobby, or a different game from before; otherwise it is the old log plus lines for what changed,
 * with everything older than the hand before this one dropped.
 * @param {object[]} log  the lines so far (messages, each carrying the `hand` it happened in)
 * @param {object | null} prev  the state before this one
 * @param {object | null} next  the state that has just arrived
 * @returns {object[]} the new list (a new array; the old one is not changed)
 * Side effects: none.
 */
export function advanceLog(log, prev, next) {
  if (!next || next.phase === 'lobby') return [];
  if (!prev || prev.code !== next.code) return [];
  if (prev.phase === 'lobby') return [{ ...msg('log.dealt', { n: next.handNumber }), hand: next.handNumber }];
  const out = [...log];
  // Each line remembers the hand it happened in, which is the hand in play when it was added, so that the window
  // below can let go of the ones that are two hands old.  A line a game was never dealt belongs to no hand and goes.
  const add = (key, params) => out.push({ ...msg(key, params), hand: next.handNumber });

  if (next.handNumber !== prev.handNumber) add('log.dealt', { n: next.handNumber });
  if (prev.phase === 'passing' && next.phase === 'playing') add('log.passed');

  // A line for the trick, and none for the cards in it.  Every card played was a line of its own once, which is
  // fifty-two of them a hand: a list nobody could read at a glance, and the thing it was supposed to be good for —
  // seeing what happened while you were looking elsewhere — was buried in it.  The trick in the middle of the table
  // shows the cards while they are being played, and who took each one is what is worth keeping afterwards.
  if (next.phase === 'playing' || prev.phase === 'playing') {
    if (next.trickWinner !== null && next.trickWinner !== undefined && next.trickWinner !== prev.trickWinner) add('log.takesTrick', { name: nameOf(next, next.trickWinner) });
  }

  const claim = next.lastClaim;
  if (claim && claim.hand === next.handNumber && !prev.lastClaim) add('log.claims', { name: nameOf(next, claim.seat), count: claim.tricks });

  if (next.phase === 'handEnd' && prev.phase !== 'handEnd') add('log.handOver', { n: prev.handNumber });
  if (next.phase === 'finished' && prev.phase !== 'finished') {
    const names = (next.winners ?? []).map((seat) => nameOf(next, seat));
    add('log.gameOver', { names, count: names.length });
  }
  const oldestKept = (next.handNumber ?? 0) - (HANDS_KEPT - 1);
  return out.filter((line) => (line.hand ?? -Infinity) >= oldestKept);
}
