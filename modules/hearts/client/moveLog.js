// The "Recent moves" list for Hearts.  The server sends the table as it is, not a history, so the client keeps one: every
// state that arrives is compared with the one before it, and what changed (cards played, a trick taken, a new hand) is
// added as a line.  Each line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put
// into words by the table when it is drawn, so the list reads in the player's language whenever they switch.  The list
// starts when the page does (a reload shows moves from then on).  It lives outside the table component so that every
// state is looked at, even when several arrive before the page redraws.
//
// It holds two tricks: the one being played and the one before it.  At a table of four that is the last eight cards —
// the four of the trick just taken, and however many are down in this one.  A list of every card played all evening
// would be a perfect memory for whoever thought to scroll it and a disadvantage for whoever did not, which is not the
// game; what the list is for is catching up on the moment you were looking away for.  The window is also what keeps
// it from growing without end, so there is no separate limit on its length.
import { cardMsg, msg } from '../../../shared/messages.js';

/** How many tricks the list keeps: the one being played and the one before it. */
const TRICKS_KEPT = 2;

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
 * The log after `next` arrives, given the log so far and the previous state (null when there was none).  It is empty when
 * there is no game, a lobby, or a different game from before; otherwise it is the old log plus lines for what changed,
 * with everything older than the trick before this one dropped.
 * @param {object[]} log  the lines so far (messages, each carrying the `hand` and `trick` it happened in)
 * @param {object | null} prev  the state before this one
 * @param {object | null} next  the state that has just arrived
 * @returns {object[]} the new list (a new array; the old one is not changed)
 * Side effects: none.
 */
export function advanceLog(log, prev, next) {
  if (!next || next.phase === 'lobby') return [];
  if (!prev || prev.code !== next.code) return [];
  // Which trick a line belongs to: the one on the table as it was added.  `trickNumber` counts the trick whose cards
  // are down, and it only moves on once the finished trick has been gathered up (see resolveTrick), so the four cards
  // of a trick and the line saying who took it all belong to the same one.
  const where = () => ({ hand: next.handNumber, trick: next.trickNumber ?? 0 });
  if (prev.phase === 'lobby') return [{ ...msg('log.dealt', { n: next.handNumber }), ...where() }];
  const out = [...log];
  const add = (key, params) => out.push({ ...msg(key, params), ...where() });

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
  // The last TRICKS_KEPT tricks anything was written about, and everything written about them.  Counting the tricks
  // present rather than the lines is what makes a trick arrive and leave whole: the pass and the deal at the start of
  // a hand belong to its first trick, and the line closing a hand to its last, so each goes when its trick does.
  const trickOf = (line) => `${line.hand ?? -1}:${line.trick ?? 0}`;
  const newest = (a, b) => a.hand - b.hand || a.trick - b.trick;
  const tricks = [...new Map(out.map((line) => [trickOf(line), { hand: line.hand ?? -1, trick: line.trick ?? 0 }])).values()].sort(newest);
  const kept = new Set(tricks.slice(-TRICKS_KEPT).map(trickOf));
  return out.filter((line) => kept.has(trickOf(line)));
}
