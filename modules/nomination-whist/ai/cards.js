// Card helpers shared by the Nomination Whist AIs. Pure functions over cards such as "QS", with no room or sockets.
import { deckFor, isJoker, JOKERS, rankValue, suitOf } from '../../../shared/cards.js';
import { winningCard } from '../trick.js';

export { winningCard };

/** How strong a card is for winning a trick: Jokers beat everything, then trumps, then rank. */
export const strength = (card, trump) => (isJoker(card) ? 40 : rankValue(card) + (suitOf(card) === trump ? 20 : 0));
export const highest = (cards, trump) => cards.reduce((a, b) => (strength(b, trump) > strength(a, trump) ? b : a));
export const lowest = (cards, trump) => cards.reduce((a, b) => (strength(b, trump) < strength(a, trump) ? b : a));

/**
 * No higher card of its suit is still out there: everything higher is in the hand or already played. A Joker is a
 * master unless the other Joker is still out (it could cancel it, or beat it if it led). When the Jokers are in play (`jokers`),
 * no other card is a master while a Joker is still out.
 */
export function isMaster(card, hand, played, jokers = false) {
  const gone = new Set([...hand, ...played]);
  if (isJoker(card)) return JOKERS.every((joker) => joker === card || gone.has(joker));
  if (jokers && JOKERS.some((joker) => !gone.has(joker))) return false; // a Joker still out there could take the trick from it
  for (let rank = rankValue(card) + 1; rank <= 14; rank++) {
    const name = rank <= 10 ? String(rank) : { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[rank];
    if (!gone.has(`${name}${suitOf(card)}`)) return false;
  }
  return true;
}

/** The cards a player cannot see: the whole deck (with the Jokers if they are in play) minus their hand and everything already played. */
export function unseenCards(hand, played, jokers = false) {
  const gone = new Set([...hand, ...played]);
  return deckFor(jokers).filter((card) => !gone.has(card));
}

/** The nearest allowed nomination to a target number (ties go to the lower). */
export const nearestAllowed = (allowed, target) =>
  [...allowed].sort((a, b) => a - b).reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best));

export const sample = (list, rng) => list[Math.floor(rng() * list.length)];
