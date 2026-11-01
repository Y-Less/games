// Card helpers shared by the Nomination Whist AIs. Pure functions over cards such as "QS", with no room or sockets.
import { deckFor, isJoker, JOKERS, rankValue, suitOf } from '../../../shared/cards.js';
import { winningCard } from '../trick.js';

export { winningCard };

/**
 * How strong a card is for winning a trick: Jokers beat everything, then trumps, then rank.
 *
 * @param {string} card  a card such as "QS", or a Joker
 * @param {string | null} trump  the trump suit, or null for none
 * @returns {number} a comparable score (Joker 40, trump rank + 20, otherwise rank)
 * Side effects: none.
 */
export const strength = (card, trump) => (isJoker(card) ? 40 : rankValue(card) + (suitOf(card) === trump ? 20 : 0));
/**
 * The strongest card of a non-empty list (the first one wins a tie).
 *
 * @param {string[]} cards  the candidates
 * @param {string | null} trump  the trump suit, or null for none
 * @returns {string} the strongest card
 * Side effects: none.
 */
export const highest = (cards, trump) => cards.reduce((a, b) => (strength(b, trump) > strength(a, trump) ? b : a));
/**
 * The weakest card of a non-empty list (the first one wins a tie).
 *
 * @param {string[]} cards  the candidates
 * @param {string | null} trump  the trump suit, or null for none
 * @returns {string} the weakest card
 * Side effects: none.
 */
export const lowest = (cards, trump) => cards.reduce((a, b) => (strength(b, trump) < strength(a, trump) ? b : a));

/**
 * No higher card of its suit is still out there: everything higher is in the hand or already played. A Joker is a
 * master unless the other Joker is still out (it could cancel it, or beat it if it led). When the Jokers are in play (`jokers`),
 * no other card is a master while a Joker is still out.
 *
 * @param {string} card  the card to test
 * @param {string[]} hand  the player's own hand (these cards cannot be held by anybody else)
 * @param {string[]} played  every card already played this round
 * @param {boolean} [jokers=false]  whether the Jokers are in the pack
 * @returns {boolean} true if nothing unseen can beat the card in its own suit
 * Side effects: none.
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

/**
 * The cards a player cannot see: the whole deck (with the Jokers if they are in play) minus their hand and everything already played.
 *
 * @param {string[]} hand  the player's own hand
 * @param {string[]} played  every card already played this round
 * @param {boolean} [jokers=false]  whether the Jokers are in the pack
 * @returns {string[]} the unseen cards
 * Side effects: none.
 */
export function unseenCards(hand, played, jokers = false) {
  const gone = new Set([...hand, ...played]);
  return deckFor(jokers).filter((card) => !gone.has(card));
}

/**
 * The nearest allowed nomination to a target number (ties go to the lower).
 *
 * @param {number[]} allowed  the nominations the player may make (the dealer may be barred from one)
 * @param {number} target  the ideal, possibly fractional, number of tricks
 * @returns {number} the allowed nomination closest to the target
 * Side effects: none.
 */
export const nearestAllowed = (allowed, target) =>
  [...allowed].sort((a, b) => a - b).reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best));

/**
 * A random member of a list.
 *
 * @param {Array} list  non-empty list to pick from
 * @param {() => number} rng  random source returning [0, 1)
 * @returns {*} the chosen member
 * Side effects: advances the random source.
 */
export const sample = (list, rng) => list[Math.floor(rng() * list.length)];
