// What Cribbage counts about each player for the statistics and achievements (see module.json "stats"). The counters live
// on the seat. The game calls these as cards are discarded and as a deal is shown and finished; nothing here changes the game.
import { rankOf } from '../../shared/cards.js';
import { bump, freshTally, peak } from '../../shared/tally.js';

export const STAT_KEYS = ['handsPlayed', 'bestHand', 'pegPoints', 'zeroHands', 'nineteens', 'fiveFlushes', 'perfectHands', 'nobs', 'fivesGiven'];
export const newTally = () => freshTally(STAT_KEYS);

/** The most a hand can score. */
export const PERFECT_HAND = 29;

/** Counts the fives a player puts into somebody else's box. `forOwnBox` is whether they are the dealer. */
export function tallyDiscard(tally, cards, forOwnBox) {
  if (!forOwnBox) bump(tally, 'fivesGiven', cards.filter((card) => rankOf(card) === '5').length);
}

/**
 * Counts a hand or box once it is scored.
 *   kind   'hand' or 'crib'
 *   shown  { total, items } from scoreHand
 */
export function tallyShown(tally, kind, { total, items }) {
  if (kind === 'hand') peak(tally, 'bestHand', total);
  if (total === 0) bump(tally, 'zeroHands');
  if (total >= PERFECT_HAND) bump(tally, 'perfectHands');
  if (items.some((item) => item.kind === 'flush' && item.cards.length === 5)) bump(tally, 'fiveFlushes');
  if (items.some((item) => item.kind === 'nobs')) bump(tally, 'nobs');
}

/** Counts a deal in which a player scored nothing at all: from the play, the heels, their hand or (as dealer) their box. */
export function tallyDeal(tally, pointsScored) {
  if (pointsScored === 0) bump(tally, 'nineteens');
}
