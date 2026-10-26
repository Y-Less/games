// Card helpers shared by the Nomination Whist AIs. Pure functions over cards such as "QS", with no room or sockets.
import { fullDeck, rankValue, suitOf } from '../../../shared/cards.js';

/** How strong a card is for winning a trick: trumps beat everything, then rank. */
export const strength = (card, trump) => rankValue(card) + (suitOf(card) === trump ? 20 : 0);
export const highest = (cards, trump) => cards.reduce((a, b) => (strength(b, trump) > strength(a, trump) ? b : a));
export const lowest = (cards, trump) => cards.reduce((a, b) => (strength(b, trump) < strength(a, trump) ? b : a));

/** The card that wins a set of cards played in order: the highest trump, or else the highest of the suit led. */
export function winningCard(cards, trump) {
  const trumps = trump ? cards.filter((c) => suitOf(c) === trump) : [];
  const pool = trumps.length ? trumps : cards.filter((c) => suitOf(c) === suitOf(cards[0]));
  return pool.reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a));
}

/** No higher card of its suit is still out there: everything higher is in the hand or already played. */
export function isMaster(card, hand, played) {
  const gone = new Set([...hand, ...played]);
  for (let rank = rankValue(card) + 1; rank <= 14; rank++) {
    const name = rank <= 10 ? String(rank) : { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[rank];
    if (!gone.has(`${name}${suitOf(card)}`)) return false;
  }
  return true;
}

/** The cards a player cannot see: the whole deck minus their hand and everything already played. */
export function unseenCards(hand, played) {
  const gone = new Set([...hand, ...played]);
  return fullDeck().filter((card) => !gone.has(card));
}

/** The nearest allowed nomination to a target number (ties go to the lower). */
export const nearestAllowed = (allowed, target) =>
  [...allowed].sort((a, b) => a - b).reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best));

export const sample = (list, rng) => list[Math.floor(rng() * list.length)];
