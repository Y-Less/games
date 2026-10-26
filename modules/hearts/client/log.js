// The "Recent moves" list for Hearts. The server sends the table as it is, not a history, so the client keeps one: every
// state that arrives is compared with the one before it, and what changed (cards played, a trick taken, a new hand) is
// added as a line. The list starts when the page does (a reload shows moves from then on). It lives outside the table
// component so that every state is looked at, even when several arrive before the page redraws.
import { cardName } from '../../../shared/cards.js';

const LIMIT = 120;

const nameOf = (state, seat) => state.seats[seat]?.name ?? 'Someone';
const same = (a, b) => a.seat === b.seat && a.card === b.card;

/** The log after `next` arrives, given the log so far and the previous state (null when there was none). */
export function advanceLog(log, prev, next) {
  if (!next || next.phase === 'lobby') return [];
  if (!prev || prev.code !== next.code) return [];
  if (prev.phase === 'lobby') return [{ text: `Hand ${next.handNumber} is dealt.` }];
  const out = [...log];
  const add = (text) => out.push({ text });

  if (next.handNumber !== prev.handNumber) add(`Hand ${next.handNumber} is dealt.`);
  if (prev.phase === 'passing' && next.phase === 'playing') add('The cards have been passed.');

  if (next.phase === 'playing' || prev.phase === 'playing') {
    const before = prev.trick ?? [];
    const after = next.trick ?? [];
    const continues = after.length >= before.length && before.every((p, i) => same(p, after[i]));
    const fresh = continues ? after.slice(before.length) : after;
    for (const play of fresh) add(`${nameOf(next, play.seat)} played the ${cardName(play.card)}.`);
    if (next.trickWinner !== null && next.trickWinner !== undefined && next.trickWinner !== prev.trickWinner) add(`${nameOf(next, next.trickWinner)} takes the trick.`);
  }

  if (next.phase === 'handEnd' && prev.phase !== 'handEnd') add(`Hand ${prev.handNumber} is over.`);
  if (next.phase === 'finished' && prev.phase !== 'finished') {
    const names = (next.winners ?? []).map((seat) => nameOf(next, seat));
    add(`The game is over: ${names.join(' and ')} ${names.length > 1 ? 'win' : 'wins'}.`);
  }
  return out.length > LIMIT ? out.slice(-LIMIT) : out;
}
