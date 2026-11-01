// What Nomination Whist counts about each player for the statistics and achievements (see module.json "stats"). The game
// calls tallyRound once a round is scored; nothing here changes the game.
import { bump, freshTally, peak } from '../../shared/tally.js';

export const STAT_KEYS = ['roundsPlayed', 'bidsMade', 'tricksWon', 'singledOut', 'zeroBidsMade', 'sevenMade', 'missedByOne', 'biggestBidMade'];
/**
 * A fresh tally with every statistic at zero.
 *
 * @returns {object} a new tally keyed by STAT_KEYS
 * Side effects: none.
 */
export const newTally = () => freshTally(STAT_KEYS);

/** The most cards anyone is dealt: the first and last rounds of a full game. */
export const FULL_HAND = 7;

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
