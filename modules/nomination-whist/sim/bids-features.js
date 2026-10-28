// What the bidding table with table state looks at, for one nomination decision:
//   key        the hand: the Standard AI's estimate of its tricks in quarters; for a one-card round the card itself, because
//              there the card and where you sit decide everything (see below)
//   unclaimed  how many tricks the players before have left unclaimed, because a hand is worth more when they nominated low
//   after      the exact number of players still to nominate after you. The first to nominate leads the first trick, and
//              the dealer nominates last and plays last, so this is your table position
// Used by the collector and trainer (bids-collect.js, train-bids-context.js) and by the AI (ai/lut.js), so they cannot disagree.
//
// Why the card itself in a one-card round: with three players in a no-trump round, the player who leads wins unless one of
// the two other cards is a higher card of the same suit, which even for a deuce is only 42% likely, so whatever the card,
// nominating 1 is right (it wins 58% or more, and nominating 1 beats nominating 0 above 50%).
import { deckFor, fullDeck } from '../../../shared/cards.js';
import { estimateTricks } from '../ai/standard.js';

export const ESTIMATE_STEPS = 4; // estimates are in quarters of a trick, 0 to 4 x cards
export const UNCLAIMED_MIN = -2; // tricks claimed beyond the cards dealt, at most this many are told apart
export const AFTER_BUCKETS = 7; // players still to nominate after me, 0 (the dealer) to 6
const CARD_INDEX = new Map(deckFor(true).map((card, i) => [card, i])); // the 52 cards, then the two Jokers

/** The number of buckets of each part for a round of `cards` cards (the keys of a one-card round include the Jokers when they are in play). */
export const keyBuckets = (cards, jokers = false) => (cards === 1 ? fullDeck().length + (jokers ? 2 : 0) : cards * ESTIMATE_STEPS + 1);
export const unclaimedBuckets = (cards) => cards - UNCLAIMED_MIN + 1;

/**
 * The cell of a nomination decision, from what an AI is told when it nominates: `hand`, `trump`, `players` and the
 * `nominations` so far (null or undefined for a seat that has not nominated, which includes the player themselves).
 * `boost` turns every card's weight in the estimate up (ai/endgame.js); tables are always trained with none.
 */
export function cellOf({ hand, trump, players, nominations = [] }, boost = 0) {
  const cards = hand.length;
  const key = cards === 1 ? CARD_INDEX.get(hand[0]) : Math.min(cards * ESTIMATE_STEPS, Math.round(estimateTricks(hand, trump, players, boost) * ESTIMATE_STEPS));
  let claimed = 0;
  let waiting = 0;
  for (let seat = 0; seat < players; seat++) {
    const bid = nominations[seat];
    if (bid == null) waiting++;
    else claimed += bid;
  }
  const unclaimed = Math.max(UNCLAIMED_MIN, Math.min(cards, cards - claimed));
  return { key, unclaimed: unclaimed - UNCLAIMED_MIN, after: waiting - 1 };
}
