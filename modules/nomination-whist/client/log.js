// The "Recent moves" list of Nomination Whist. The server sends the state, not a history, so the list is worked out
// here from what changed between one state and the next: a new round, a nomination, a card played, a trick won.
import { SUIT_NAMES, SUIT_SYMBOLS, rankOf, suitOf } from '../../../shared/cards.js';

const shortCard = (card) => `${rankOf(card)}${SUIT_SYMBOLS[suitOf(card)]}`;

/** The log entries ({ text }) for what changed from `prev` to `next` (either may be null), oldest first. */
export function movesBetween(prev, next) {
  if (!next || next.phase === 'lobby' || !next.round) return [];
  const name = (seat) => next.seats[seat]?.name ?? 'Someone';
  const out = [];
  const same = prev && prev.round && prev.code === next.code && prev.round.number === next.round.number;
  if (!same) {
    const trump = next.round.trump ? SUIT_NAMES[next.round.trump] : 'no trumps';
    out.push({ text: `Round ${next.round.number}: ${next.round.cards} ${next.round.cards === 1 ? 'card' : 'cards'} each, ${next.round.trump ? `${trump} are trumps` : trump}.` });
    return out;
  }
  next.seats.forEach((seat, i) => {
    if (seat.bid !== null && prev.seats[i]?.bid === null) out.push({ text: `${name(i)} nominated ${seat.bid}.` });
  });
  for (const play of next.trick.slice(prev.trick.length)) out.push({ text: `${name(play.seat)} played ${shortCard(play.card)}.` });
  if (next.trick.length === next.seats.length && prev.trick.length !== next.seats.length) out.push({ text: `${name(next.trickWinner)} won the trick.` });
  if (next.phase === 'roundEnd' && prev.phase !== 'roundEnd') out.push({ text: `Round ${next.round.number} is over.` });
  if (next.phase === 'finished' && prev.phase !== 'finished') out.push({ text: 'The game is over.' });
  return out;
}
