// Helpers shared by the Hearts AIs. Everything here works on plain data (see the context described in index.js) and
// knows nothing about rooms or sockets. No Math.random: a game passes its own `rng` in the context.
import { rankValue, suitOf } from '../../../shared/cards.js';
import { DEFAULT_SEATS, deckFor, tricksFor } from '../deals.js';

// The number of players varies (3 to 7), so nothing here is a constant: the context says how many seats, tricks and
// pass cards this game has (seatCount, trickCount, passCount); a context without them is a four-player one.
/**
 * The number of seats in this game.
 * @param {object} ctx  AI context; uses seatCount or taken.
 * @returns {number} seat count, defaulting to four.
 * Side effects: none.
 */
export const seatsIn = (ctx) => ctx.seatCount ?? ctx.taken?.length ?? DEFAULT_SEATS;
/**
 * The number of tricks in a hand of this game.
 * @param {object} ctx  AI context; uses trickCount or the seat count.
 * @returns {number} tricks per hand.
 * Side effects: none.
 */
export const tricksIn = (ctx) => ctx.trickCount ?? tricksFor(seatsIn(ctx));
/**
 * How many cards each player passes.
 * @param {object} ctx  AI context; uses passCount.
 * @returns {number} cards to pass, defaulting to three.
 * Side effects: none.
 */
export const passSize = (ctx) => ctx.passCount ?? 3;
export const QUEEN = 'QS';
export const JACK = 'JD';
export const SUIT_LIST = ['C', 'D', 'H', 'S'];

/**
 * Whether a card is a heart.
 * @param {string} card  card code such as 'QS'.
 * @returns {boolean} true for hearts.
 * Side effects: none.
 */
export const isHeart = (card) => suitOf(card) === 'H';
/**
 * Whether a card scores penalty points (a heart or the Queen of Spades).
 * @param {string} card  card code.
 * @returns {boolean} true if it is a heart or the Queen.
 * Side effects: none.
 */
export const isPointCard = (card) => isHeart(card) || card === QUEEN;
/**
 * The lowest-ranked card of a non-empty list (first one wins ties).
 * @param {string[]} cards  non-empty list of card codes.
 * @returns {string} the lowest card.
 * Side effects: none.
 */
export const lowest = (cards) => cards.reduce((a, b) => (rankValue(b) < rankValue(a) ? b : a));
/**
 * The highest-ranked card of a non-empty list (first one wins ties).
 * @param {string[]} cards  non-empty list of card codes.
 * @returns {string} the highest card.
 * Side effects: none.
 */
export const highest = (cards) => cards.reduce((a, b) => (rankValue(b) > rankValue(a) ? b : a));
/**
 * Filters cards down to one suit.
 * @param {string[]} cards  card codes.
 * @param {string} suit  suit letter (C, D, H or S).
 * @returns {string[]} the cards of that suit.
 * Side effects: none.
 */
export const bySuit = (cards, suit) => cards.filter((c) => suitOf(c) === suit);

/**
 * Keeps the cards that satisfy `keep`, unless that would leave none (so a preference never empties the options).
 * @param {string[]} cards  candidate cards.
 * @param {(card: string) => boolean} keep  predicate for cards to prefer.
 * @returns {string[]} the preferred cards, or all of them if none qualify.
 * Side effects: none.
 */
export function preferring(cards, keep) {
  const kept = cards.filter(keep);
  return kept.length ? kept : cards;
}
/**
 * Drops the cards that satisfy `unwanted`, unless that would leave none.
 * @param {string[]} cards  candidate cards.
 * @param {(card: string) => boolean} unwanted  predicate for cards to avoid.
 * @returns {string[]} the remaining cards, or all of them if every card is unwanted.
 * Side effects: none.
 */
export const avoiding = (cards, unwanted) => preferring(cards, (c) => !unwanted(c));

/**
 * Every card taken in a finished trick so far this hand, plus the ones on the table.
 * @param {object} ctx  AI context; uses taken and trick.
 * @returns {Set<string>} the cards no longer in anybody's hand.
 * Side effects: none.
 */
export const playedSet = (ctx) => new Set([...ctx.taken.flat(), ...ctx.trick.map((p) => p.card)]);

/**
 * Card counting from public information only.
 * @param {object} ctx  AI context; uses hand, taken, trick, history, tricksPlayed and seat count.
 * @returns {{played: Set<string>, unseen: Set<string>, voids: Set<string>[], sizes: number[]}} what can be known
 *   without seeing anybody else's hand:
 *  played   every card gone from play (finished tricks and the table)
 *  unseen   the cards that are not in my hand and have not been played: they are in other hands
 *  voids    per seat, the suits that seat is known to be out of (it failed to follow a suit that was led)
 *  sizes    per seat, how many cards that seat still holds
 * Side effects: none.
 */
export function observe(ctx) {
  const played = playedSet(ctx);
  const mine = new Set(ctx.hand);
  const seats = seatsIn(ctx);
  const unseen = new Set();
  for (const card of deckFor(seats)) if (!played.has(card) && !mine.has(card)) unseen.add(card);
  const voids = Array.from({ length: seats }, () => new Set());
  // Records a void for every seat that failed to follow the suit led in this set of plays.
  const note = (plays) => {
    if (!plays.length) return;
    const led = suitOf(plays[0].card);
    for (const play of plays) if (suitOf(play.card) !== led) voids[play.seat].add(led);
  };
  for (const entry of ctx.history ?? []) note(entry.plays);
  note(ctx.trick);
  const onTable = new Set(ctx.trick.map((p) => p.seat));
  const sizes = Array.from({ length: seats }, (_, s) => tricksIn(ctx) - ctx.tricksPlayed - (onTable.has(s) ? 1 : 0));
  return { played, unseen, voids, sizes };
}

/**
 * The seats that have taken a heart or the Queen of Spades this hand. A moon needs this to stay at one seat.
 * @param {object} ctx  AI context; uses taken.
 * @returns {Set<number>} seat indexes that hold at least one point card.
 * Side effects: none.
 */
export const pointTakers = (ctx) => new Set(ctx.taken.flatMap((cards, s) => (cards.some(isPointCard) ? [s] : [])));
