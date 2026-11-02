// What may be played to a trick and who wins it, in one place for the game, the computer players, and the simulator.
// Pure functions of cards, with no room or sockets.
//
// Ordinary cards: you must follow the suit led if you can; the highest trump wins the trick, or if there is none, the
// highest card of the suit led.  With the Jokers option there are two more cards, and these rules:
//   - A Joker may be led.  Otherwise it may be played only when you cannot follow suit.
//   - A Joker wins the trick, even against trumps ...
//   - ... unless the other Joker is played in the same trick: then they cancel and both lose, and the rest of the trick
//     is decided as usual.  The exception is a trick that a Joker led: the second Joker played on top wins it instead.
//   - A Joker that is led leaves no suit to follow: every other card is allowed.
import { isJoker, suitOf } from '../../shared/cards.js';
import { bestCard, followCards } from '../../shared/tricks.js';

/**
 * The suit that must be followed.
 *
 * @param {string[]} cards  the cards played so far, in order
 * @returns {string | null} the suit led, or null if nothing has been led or a Joker was
 * Side effects: none.
 */
export const ledSuit = (cards) => (cards.length && !isJoker(cards[0]) ? suitOf(cards[0]) : null);

/**
 * The cards that may be played to a trick: the suit led if the hand has any (a Joker cannot be played then), otherwise anything.
 *
 * @param {string[]} hand  the player's cards
 * @param {string[]} trick  the cards played so far, in order
 * @returns {string[]} the legal cards
 * Side effects: none.
 */
export function legalCards(hand, trick) {
  const led = ledSuit(trick);
  if (led === null) return hand; // leading, or a Joker was led: anything goes
  const follow = followCards(hand, led); // a Joker is never "of the suit", so it cannot be played while following
  return follow.length ? follow : hand;
}

/**
 * The card that wins a set of cards played in order (also for a trick still in progress), Jokers included.
 *
 * @param {string[]} cards  in the order played; not empty
 * @param {string | null} trump  the trump suit, or null for none
 * @returns {string} the winning card
 * Side effects: none.
 */
export function winningCard(cards, trump) {
  const jokers = cards.filter(isJoker);
  let rest = cards;
  if (jokers.length === 1) return jokers[0];
  if (jokers.length === 2) {
    if (isJoker(cards[0])) return jokers[1]; // the second Joker beats a Joker that led
    rest = cards.filter((card) => !isJoker(card)); // otherwise they cancel each other out
  }
  return bestCard(rest, trump);
}
