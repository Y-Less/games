// What Nomination Whist counts about each player for the statistics and achievements (see module.json "stats").  The game
// calls tallyRound once a round is scored; nothing here changes the game.
import { isJoker } from '../../shared/cards.js';
import { bump, freshTally, peak } from '../../shared/tally.js';

export const STAT_KEYS = ['roundsPlayed', 'bidsMade', 'tricksWon', 'singledOut', 'zeroBidsMade', 'sevenMade', 'missedByOne', 'biggestBidMade', 'circuses'];
/**
 * A fresh tally with every statistic at zero.
 *
 * @returns {object} a new tally keyed by STAT_KEYS
 * Side effects: none.
 */
export const newTally = () => freshTally(STAT_KEYS);

/** The most cards anyone is dealt: the first and last rounds of a full game. */
export const FULL_HAND = 7;

/** The round in which a hand of nothing but Jokers is a whole hand: two cards, and both of them Jokers. */
export const CIRCUS_HAND = 2;

/**
 * Counts a hand as it is dealt.  A two-card round dealt as the two Jokers and nothing else is a circus; it can only
 * happen in a game with the Jokers turned on, which is the only way they are in the pack at all.
 *
 * @param {object} tally  the player's tally
 * @param {string[]} hand  the cards they were dealt
 * @returns {void}
 * Side effects: mutates `tally` (circuses).
 */
export function tallyDeal(tally, hand) {
  if (hand.length === CIRCUS_HAND && hand.every(isJoker)) bump(tally, 'circuses');
}

/**
 * Counts one player's scored round.
 *
 * @param {object} tally  the player's tally
 * @param {object} round  the player's result
 * @param {number} round.bid  what they nominated
 * @param {number} round.taken  the tricks they won
 * @param {boolean} round.onlyOneMadeIt  whether they were the only player to make their nomination
 * @returns {void}
 * Side effects: mutates `tally` (counters bumped, biggestBidMade raised).
 */
export function tallyRound(tally, { bid, taken, onlyOneMadeIt }) {
  const madeIt = bid === taken;
  bump(tally, 'roundsPlayed');
  bump(tally, 'tricksWon', taken);
  if (Math.abs(bid - taken) === 1) bump(tally, 'missedByOne');
  if (!madeIt) return;
  peak(tally, 'biggestBidMade', bid);
  bump(tally, 'bidsMade');
  if (bid === FULL_HAND) bump(tally, 'sevenMade');
  if (bid === 0) bump(tally, 'zeroBidsMade');
  if (onlyOneMadeIt) bump(tally, 'singledOut');
}
