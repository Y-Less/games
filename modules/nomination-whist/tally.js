// What Nomination Whist counts about each player for the statistics and achievements (see module.json "stats"). The game
// calls tallyRound once a round is scored; nothing here changes the game.
import { bump, freshTally } from '../../shared/tally.js';

export const STAT_KEYS = ['roundsPlayed', 'bidsMade', 'tricksWon', 'singledOut', 'zeroBidsMade', 'sevenMade'];
export const newTally = () => freshTally(STAT_KEYS);

/** The most cards anyone is dealt: the first and last rounds of a full game. */
export const FULL_HAND = 7;

/**
 * Counts one player's scored round.
 *   bid, taken  what they nominated and the tricks they won
 *   onlyOneMadeIt  whether they were the only player to make their nomination
 */
export function tallyRound(tally, { bid, taken, onlyOneMadeIt }) {
  const madeIt = bid === taken;
  bump(tally, 'roundsPlayed');
  bump(tally, 'tricksWon', taken);
  if (!madeIt) return;
  bump(tally, 'bidsMade');
  if (bid === FULL_HAND) bump(tally, 'sevenMade');
  if (bid === 0) bump(tally, 'zeroBidsMade');
  if (onlyOneMadeIt) bump(tally, 'singledOut');
}
