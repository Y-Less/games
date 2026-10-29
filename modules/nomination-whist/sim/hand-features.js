// What the hand model (hand-model.js) sees of a nomination decision, as a vector of numbers. Unlike the bid-value table's
// key, which squeezes a hand of three or more cards into one estimate, this describes EVERY card in the hand, so the
// model can weigh a lone king of trumps differently from a hand that merely adds up to the same estimate.
//
//   0 to 12    each rank of the trump suit that is in the hand (2 to ace), 1 or 0
//   13 to 25   each rank in the other suits, as a count (an ace in two other suits is 2): the suits are interchangeable
//   26         the Jokers held, out of 2
//   27 to 30   the trump suit as a whole: how many cards, the highest, how long a run from the ace, and whether there is one
//   31 to 34   the shape of the other suits: voids, singletons and doubletons (what a trump could be used on), longest suit
//   35 to 38   honours with company: kings with another card of their suit, bare kings, ace and king together, queens backed
//   39 to 43   how many players (3 to 7), one-hot
//   44 to 50   how many cards (1 to 7), one-hot
//   51 to 53   tricks per player, the share of the tricks already claimed, and what is left unclaimed
//   54 to 60   how many players nominate after this one (0 is the dealer), one-hot
//
// The suit itself never matters, only whether it is the trump, so what the model learns holds for every trump suit.
import { isJoker, rankValue, suitOf, SUITS } from '../../../shared/cards.js';

export const INPUTS = 61;

/**
 * The features of a decision. `ctx` is what an AI is given when it nominates (hand, trump, players, nominations).
 * @param {Float32Array} [out] reused between calls to save allocating
 */
export function handFeatures(ctx, out = new Float32Array(INPUTS)) {
  out.fill(0);
  const { hand, trump = null, players, nominations = [] } = ctx;
  const cards = hand.length;
  const trumps = [];
  const sides = {};
  let jokers = 0;
  for (const card of hand) {
    if (isJoker(card)) {
      jokers++;
      continue;
    }
    const suit = suitOf(card);
    const rank = rankValue(card);
    if (trump !== null && suit === trump) {
      trumps.push(rank);
      out[rank - 2] = 1;
    } else {
      (sides[suit] ??= []).push(rank);
      out[13 + rank - 2]++;
    }
  }
  out[26] = jokers / 2;

  out[27] = trumps.length / 7;
  out[28] = trumps.length ? Math.max(...trumps) / 14 : 0;
  let run = 0;
  while (trumps.includes(14 - run)) run++;
  out[29] = run / 7;
  out[30] = trump !== null ? 1 : 0;

  const sideSuits = SUITS.filter((suit) => suit !== trump);
  let voids = 0;
  let singles = 0;
  let doubles = 0;
  let longest = 0;
  let guardedKings = 0;
  let bareKings = 0;
  let aceKings = 0;
  let backedQueens = 0;
  for (const suit of sideSuits) {
    const ranks = sides[suit] ?? [];
    if (ranks.length === 0) voids++;
    if (ranks.length === 1) singles++;
    if (ranks.length === 2) doubles++;
    longest = Math.max(longest, ranks.length);
    const has = (rank) => ranks.includes(rank);
    if (has(13)) {
      if (ranks.length >= 2) guardedKings++;
      else bareKings++;
      if (has(14)) aceKings++;
    }
    if (has(12) && ranks.length >= 2 && (has(13) || has(14))) backedQueens++;
  }
  const n = sideSuits.length;
  out[31] = voids / n;
  out[32] = singles / n;
  out[33] = doubles / n;
  out[34] = longest / 7;
  out[35] = guardedKings / n;
  out[36] = bareKings / n;
  out[37] = aceKings / n;
  out[38] = backedQueens / n;

  out[39 + Math.min(4, Math.max(0, players - 3))] = 1;
  out[44 + Math.min(6, Math.max(0, cards - 1))] = 1;
  let claimed = 0;
  let waiting = 0;
  for (let seat = 0; seat < players; seat++) {
    const bid = nominations[seat];
    if (bid == null) waiting++;
    else claimed += bid;
  }
  out[51] = cards / players;
  out[52] = claimed / cards;
  out[53] = Math.max(-2, Math.min(cards, cards - claimed)) / 7;
  out[54 + Math.min(6, Math.max(0, waiting - 1))] = 1;
  return out;
}
