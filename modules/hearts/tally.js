// What Hearts counts about each player for the statistics and achievements (see module.json "stats"). The game calls
// tallyHand once a hand is scored; nothing here changes the game.
import { bump, freshTally } from '../../shared/tally.js';
import { HAND_POINTS } from './deals.js';

export const STAT_KEYS = ['handsPlayed', 'moonsShot', 'queensTaken', 'heartsTaken', 'jacksTaken', 'queensAvoided', 'zeroHands', 'missedMoons'];
export const newTally = () => freshTally(STAT_KEYS);

/** A hand that scores exactly this was one heart short of shooting the moon. */
export const MISSED_MOON_POINTS = HAND_POINTS - 1;

/**
 * Counts one player's scored hand.
 *   cards  what they took: { hearts, queen, jack } (see scoreHand)
 *   hand   { points, shotMoon, moonShot, jackScores }: their points, whether they shot the moon, whether anybody did, and
 *          whether the Jack of Diamonds counted in this game
 */
export function tallyHand(tally, cards, { points, shotMoon, moonShot, jackScores }) {
  bump(tally, 'handsPlayed');
  bump(tally, 'heartsTaken', cards.hearts);
  if (cards.queen) bump(tally, 'queensTaken');
  else bump(tally, 'queensAvoided');
  if (!cards.queen && cards.hearts === 0) bump(tally, 'zeroHands');
  if (cards.jack && jackScores) bump(tally, 'jacksTaken');
  if (shotMoon) bump(tally, 'moonsShot');
  if (!moonShot && points === MISSED_MOON_POINTS) bump(tally, 'missedMoons');
}
