// What the Cheat computer players share. Everything works on the plain-data context that game.js builds (aiContext): the
// player's own hand and what everybody can see, never other hands or what was really played.
import { rankOf } from '../../../shared/cards.js';

export const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** The cards of a hand with this rank. */
export const ofRank = (hand, rank) => hand.filter((card) => rankOf(card) === rank);

/** How many cards of each rank a hand holds: { A: 2, 7: 1 ... }. */
export function counts(hand) {
  const out = {};
  for (const card of hand) out[rankOf(card)] = (out[rankOf(card)] ?? 0) + 1;
  return out;
}

/**
 * The cards to put down when there is no honest play: the ones that are cheapest to lose, those of the ranks the hand holds
 * fewest of (a pair or a triple is worth keeping for a true play later).
 */
export function junk(hand, howMany, rng) {
  const have = counts(hand);
  const sorted = [...hand].map((card) => ({ card, n: have[rankOf(card)], tie: rng() })).sort((a, b) => a.n - b.n || a.tie - b.tie);
  return sorted.slice(0, howMany).map((entry) => entry.card);
}

/**
 * True when the last play cannot have been honest from where this player sits: it claims more cards of a rank than there are
 * in the packs outside their own hand.
 */
export function impossible(ctx) {
  if (!ctx.last) return false;
  const outside = ctx.decks * 4 - ofRank(ctx.hand, ctx.last.rank).length;
  return ctx.last.count > outside;
}
