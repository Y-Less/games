// The "Recent moves" list of Nomination Whist. The server sends the state, not a history, so the list is worked out
// here from what changed between one state and the next: a new round, a nomination, a card played, a trick won. Each
// line is a message (`{ key, params }`, see shared/messages.js) under the game's `log.*` keys, put into words by the
// table when it is drawn, so the list reads in the player's language whenever they change it.
import { isJoker } from '../../../shared/cards.js';
import { cardMsg, msg, suitMsg } from '../../../shared/messages.js';

/**
 * The log entries (messages) for what changed from `prev` to `next` (either may be null), oldest first.
 * Diffing consecutive states is needed because the server only ever sends the current state, never a history.
 * @param {object|null} prev  previous game state (null if there was none)
 * @param {object|null} next  new game state (null, lobby or no round yields no entries)
 * @returns {{ key: string, params?: object }[]} new log entries, oldest first
 * Side effects: none.
 */
export function movesBetween(prev, next) {
  if (!next || next.phase === 'lobby' || !next.round) return [];
  // Returns a seat's display name, or the site's "Someone" if that seat is empty.
  const name = (seat) => next.seats[seat]?.name ?? msg('common.someone');
  const out = [];
  const same = prev && prev.round && prev.code === next.code && prev.round.number === next.round.number;
  if (!same) {
    const { number, cards, trump } = next.round;
    out.push(trump ? msg('log.roundTrumps', { n: number, count: cards, trump: suitMsg(trump) }) : msg('log.roundNoTrumps', { n: number, count: cards }));
    return out;
  }
  next.seats.forEach((seat, i) => {
    if (seat.bid !== null && prev.seats[i]?.bid === null) out.push(msg('log.nominated', { name: name(i), bid: seat.bid }));
  });
  for (const play of next.trick.slice(prev.trick.length)) out.push(msg('log.played', { name: name(play.seat), card: cardMsg(play.card) }));
  if (next.trick.length === next.seats.length && prev.trick.length !== next.seats.length) {
    const jokers = next.trick.filter((p) => isJoker(p.card));
    if (jokers.length === 2) out.push(isJoker(next.trick[0].card) ? msg('log.secondJokerWins') : msg('log.jokersCancel'));
    out.push(msg('log.wonTrick', { name: name(next.trickWinner) }));
  }
  if (next.phase === 'roundEnd' && prev.phase !== 'roundEnd') out.push(msg('log.roundOver', { n: next.round.number }));
  if (next.phase === 'finished' && prev.phase !== 'finished') out.push(msg('log.gameOver'));
  return out;
}
