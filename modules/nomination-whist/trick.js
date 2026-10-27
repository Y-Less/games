// What may be played to a trick and who wins it, in one place for the game, the computer players and the simulator.
// Pure functions of cards, with no room or sockets.
//
// Ordinary cards: you must follow the suit led if you can; the highest trump wins the trick, or if there is none, the
// highest card of the suit led. With the Jokers option there are two more cards, and these rules:
//   - A Joker may be led. Otherwise it may be played only when you cannot follow suit.
//   - A Joker wins the trick, even against trumps ...
//   - ... unless the other Joker is played in the same trick: then they cancel and both lose, and the rest of the trick
//     is decided as usual. The exception is a trick that a Joker led: the second Joker played on top wins it instead.
//   - A Joker that is led leaves no suit to follow: every other card is allowed.
import { isJoker, rankValue, suitOf } from '../../shared/cards.js';

/** The suit that must be followed, or null if nothing has been led or a Joker was. `cards` are the cards played so far, in order. */
export const ledSuit = (cards) => (cards.length && !isJoker(cards[0]) ? suitOf(cards[0]) : null);

/** The cards of `hand` that may be played to a trick whose cards so far are `trick` (card strings, in order). */
export function legalCards(hand, trick) {
  const led = ledSuit(trick);
  if (led === null) return hand; // leading, or a Joker was led: anything goes
  const follow = hand.filter((card) => suitOf(card) === led); // a Joker is never "of the suit", so it cannot be played while following
  return follow.length ? follow : hand;
}

/** The card that wins a set of cards played in order (also for a trick still in progress). */
export function winningCard(cards, trump) {
  const jokers = cards.filter(isJoker);
  let rest = cards;
  if (jokers.length === 1) return jokers[0];
  if (jokers.length === 2) {
    if (isJoker(cards[0])) return jokers[1]; // the second Joker beats a Joker that led
    rest = cards.filter((card) => !isJoker(card)); // otherwise they cancel each other out
  }
  const led = suitOf(rest[0]);
  const trumps = trump ? rest.filter((card) => suitOf(card) === trump) : [];
  const pool = trumps.length ? trumps : rest.filter((card) => suitOf(card) === led);
  return pool.reduce((best, card) => (rankValue(card) > rankValue(best) ? card : best));
}
