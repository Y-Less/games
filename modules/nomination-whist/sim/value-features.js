// The cell of a nomination decision for the bid-value table (value-model.js): what the table looks up to find out what each
// possible nomination is worth. It adds two things to the table-state cell of bids-features.js:
//   - the hand is described exactly when it is small. With one or two cards, a card is its rank and whether it is a trump
//     (the suit itself does not matter once that is said), and a pair also says whether the two cards share a suit. Standard's
//     estimate rounds a queen of trumps and a low trump with a lucky side card to the same half-trick, which is how a table
//     keyed on it came to advise nominating 0 with the queen of trumps. From three cards up the estimate is still used.
//   - the trump suit does not matter, only whether the round has trumps (`regime`), so each cell gets four times the data.
// Used by the collector, the trainer and the AI, so they cannot disagree.
import { isJoker, rankValue, suitOf } from '../../../shared/cards.js';
import { cellOf } from './bids-features.js';

export const REGIMES = 2; // a round with no trumps, or with trumps
export const DESCRIPTORS = 27; // 13 ranks of an ordinary card, 13 ranks of a trump, and a Joker (the two Jokers are alike)
export const PLAYER_COUNTS = 5; // 3 to 7
export const AFTER_VALUES = 7; // players still to nominate after you, 0 to 6
export const MAX_CARDS = 7;

/** A card as a small number: rank (0 to 12), plus 13 for a trump; 26 for a Joker. */
export const descriptorOf = (card, trump) => (isJoker(card) ? 26 : rankValue(card) - 2 + (trump !== null && suitOf(card) === trump ? 13 : 0));

/** How many different keys a hand of `cards` cards can have. */
export const keyBuckets = (cards) => (cards === 1 ? DESCRIPTORS : cards === 2 ? DESCRIPTORS * DESCRIPTORS * 2 : cards * 4 + 1);
export const unclaimedBuckets = (cards) => cards + 3; // from 2 over-claimed to every trick unclaimed

/** The key of a hand: exact for one or two cards, otherwise Standard's estimate in quarters of a trick. */
function keyOf(ctx, base) {
  const { hand, trump } = ctx;
  if (hand.length === 1) return descriptorOf(hand[0], trump);
  if (hand.length === 2) {
    const [high, low] = hand.map((card) => descriptorOf(card, trump)).sort((a, b) => b - a);
    const sameSuit = !isJoker(hand[0]) && !isJoker(hand[1]) && suitOf(hand[0]) === suitOf(hand[1]);
    return (high * DESCRIPTORS + low) * 2 + (sameSuit ? 1 : 0);
  }
  return base.key;
}

/** The cell for a nomination: `hand`, `trump`, `players` and the `nominations` so far, as the AIs are given them (`boost`: see cellOf). */
export function valueCell(ctx, boost = 0) {
  const base = cellOf(ctx, boost);
  return { key: keyOf(ctx, base), unclaimed: base.unclaimed, after: base.after, regime: ctx.trump ? 1 : 0 };
}
