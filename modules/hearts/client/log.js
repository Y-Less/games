// The "Recent moves" list for Hearts. The server sends the table as it is, not a history, so the client keeps one: every
// state that arrives is compared with the one before it, and what changed (cards played, a trick taken, a new hand) is
// added as a line. Each line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put
// into words by the table when it is drawn, so the list reads in the player's language whenever they switch. The list
// starts when the page does (a reload shows moves from then on). It lives outside the table component so that every
// state is looked at, even when several arrive before the page redraws.
import { cardMsg, msg } from '../../../shared/messages.js';

const LIMIT = 120;

/**
 * A seat's name for a log line.
 * @param {object} state  a view from the server
 * @param {number} seat  the seat number
 * @returns {string | { key: string }} the name, or the site's "Someone" if the seat is empty
 * Side effects: none.
 */
const nameOf = (state, seat) => state.seats[seat]?.name ?? msg('common.someone');
/**
 * Whether two plays in a trick are the same play (used to tell a trick that grew from a new one).
 * @param {{ seat: number, card: string }} a  one play
 * @param {{ seat: number, card: string }} b  another play
 * @returns {boolean}
 * Side effects: none.
 */
const same = (a, b) => a.seat === b.seat && a.card === b.card;

/**
 * The log after `next` arrives, given the log so far and the previous state (null when there was none). It is empty when
 * there is no game, a lobby, or a different game from before; otherwise it is the old log plus lines for what changed, kept to
 * the last LIMIT lines.
 * @param {object[]} log  the lines so far (messages)
 * @param {object | null} prev  the state before this one
 * @param {object | null} next  the state that has just arrived
 * @returns {object[]} the new list (a new array; the old one is not changed)
 * Side effects: none.
 */
export function advanceLog(log, prev, next) {
  if (!next || next.phase === 'lobby') return [];
  if (!prev || prev.code !== next.code) return [];
  if (prev.phase === 'lobby') return [msg('log.dealt', { n: next.handNumber })];
  const out = [...log];
  const add = (key, params) => out.push(msg(key, params)); // appends one line to this call's copy of the log; returns the new length

  if (next.handNumber !== prev.handNumber) add('log.dealt', { n: next.handNumber });
  if (prev.phase === 'passing' && next.phase === 'playing') add('log.passed');

  if (next.phase === 'playing' || prev.phase === 'playing') {
    const before = prev.trick ?? [];
    const after = next.trick ?? [];
    const continues = after.length >= before.length && before.every((p, i) => same(p, after[i]));
    const fresh = continues ? after.slice(before.length) : after;
    for (const play of fresh) add('log.played', { name: nameOf(next, play.seat), card: cardMsg(play.card) });
    if (next.trickWinner !== null && next.trickWinner !== undefined && next.trickWinner !== prev.trickWinner) add('log.takesTrick', { name: nameOf(next, next.trickWinner) });
  }

  const claim = next.lastClaim;
  if (claim && claim.hand === next.handNumber && !prev.lastClaim) add('log.claims', { name: nameOf(next, claim.seat), count: claim.tricks });

  if (next.phase === 'handEnd' && prev.phase !== 'handEnd') add('log.handOver', { n: prev.handNumber });
  if (next.phase === 'finished' && prev.phase !== 'finished') {
    const names = (next.winners ?? []).map((seat) => nameOf(next, seat));
    add('log.gameOver', { names, count: names.length });
  }
  return out.length > LIMIT ? out.slice(-LIMIT) : out;
}
