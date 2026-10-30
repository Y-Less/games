// What Cribbage counts about each player for the statistics and achievements (see module.json "stats"). The counters live
// on the seat. The game calls these as cards are discarded and as a deal is shown and finished; nothing here changes the game.
import { rankOf } from '../../shared/cards.js';
import { bump, freshTally, peak } from '../../shared/tally.js';

export const STAT_KEYS = ['handsPlayed', 'bestHand', 'pegPoints', 'zeroHands', 'nineteens', 'fiveFlushes', 'perfectHands', 'nobs', 'fivesGiven'];
export const newTally = () => freshTally(STAT_KEYS);

/** The most a hand can score; with a Jack turned up the dealer can make it 30 with his heels. */
export const PERFECT_HAND = 29;

/** Counts the fives a player puts into somebody else's box. `forOwnBox` is whether they are the dealer. */
export function tallyDiscard(tally, cards, forOwnBox) {
  if (!forOwnBox) bump(tally, 'fivesGiven', cards.filter((card) => rankOf(card) === '5').length);
}

/**
 * Counts a hand or box once it is scored.
 *   kind   'hand' or 'crib'
 *   shown  { total, items } from scoreHand
 *   heels  what the player scored for turning up a Jack this deal: 2 for the dealer, who can then reach 30 with a 28
 */
export function tallyShown(tally, kind, { total, items }, heels = 0) {
  if (kind === 'hand') peak(tally, 'bestHand', total);
  if (total === 0) bump(tally, 'zeroHands');
  if (total >= PERFECT_HAND || total + heels > PERFECT_HAND) bump(tally, 'perfectHands');
  if (items.some((item) => item.kind === 'flush' && item.cards.length === 5)) bump(tally, 'fiveFlushes');
  if (items.some((item) => item.kind === 'nobs')) bump(tally, 'nobs');
}

/** Counts a deal in which the dealer scored nothing at all: from the play, the heels, their hand or their box. */
export function tallyDeal(tally, dealerPoints) {
  if (dealerPoints === 0) bump(tally, 'nineteens');
}
