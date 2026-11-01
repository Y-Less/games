// The parts of a trick-taking game that are the same in every one of them: whose turn follows a play, and what following suit
// and winning a trick mean for ordinary cards. Pure functions of seats and card strings ("QH", "10S"), with no room or sockets.
// The rules that differ (the opening card and "no points on the first trick" in Hearts, the Jokers in Nomination Whist) stay in
// the game that has them.
// Depends on: ./cards.js (rankValue, suitOf).
import { rankValue, suitOf } from './cards.js';

/**
 * The seat after this one, going round the table.
 *
 * @param {number} seat
 * @param {number} count  how many seats there are
 * @returns {number}
 * Side effects: none.
 */

export const nextSeat = (seat, count) => (seat + 1) % count;

/**
 * Whose turn it is after a card has been played to a trick: the next seat, or nobody once the trick is full (it waits to be
 * resolved).
 *
 * @param {number} seat  who has just played
 * @param {number} played  how many cards are now in the trick
 * @param {number} count  how many seats there are
 * @returns {number | null}
 * Side effects: none.
 */
export const turnAfterPlay = (seat, played, count) => (played === count ? null : nextSeat(seat, count));

/**
 * The cards of a hand that follow the suit led (a Joker is never "of the suit").
 *
 * @param {string[]} hand
 * @param {string} led  the suit led
 * @returns {string[]} in hand order; empty when the player cannot follow
 * Side effects: none.
 */
export const followCards = (hand, led) => hand.filter((card) => suitOf(card) === led);

/**
 * The best of some ordinary cards (no Jokers): the highest trump if any was played, otherwise the highest card of the suit led,
 * which is that of the first card.
 *
 * @param {string[]} cards  in the order played; not empty
 * @param {string | null} [trump]  the trump suit, or null for none
 * @returns {string} the winning card
 * Side effects: none.
 */
export function bestCard(cards, trump = null) {
  const trumps = trump ? cards.filter((card) => suitOf(card) === trump) : [];
  const pool = trumps.length ? trumps : followCards(cards, suitOf(cards[0]));
  return pool.reduce((best, card) => (rankValue(card) > rankValue(best) ? card : best));
}

/**
 * The seat winning a (possibly unfinished) trick of ordinary cards.
 *
 * @param {{ seat: number, card: string }[]} trick  in the order played; not empty
 * @param {string | null} [trump]  the trump suit, or null for none
 * @returns {number} the seat of the best card
 * Side effects: none.
 */
export function trickWinnerSeat(trick, trump = null) {
  const best = bestCard(trick.map((play) => play.card), trump);
  return trick.find((play) => play.card === best).seat;
}
