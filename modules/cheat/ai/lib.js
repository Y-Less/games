// What the Cheat computer players share.  Everything works on the plain-data context that game.js builds (aiContext): the
// player's own hand and what everybody can see, never other hands or what was really played.  Depends on shared/cards.js.
import { rankOf } from '../../../shared/cards.js';

/**
 * Picks one element of a list at random.
 *
 * @param {Array} list  the candidates (non-empty)
 * @param {() => number} rng  random source returning [0, 1); the clamp guards against an rng that returns exactly 1
 * @returns {*} one element of the list
 * Side effects: advances the rng.
 */
export const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/**
 * The cards of a hand with this rank.
 *
 * @param {string[]} hand  card codes
 * @param {string} rank  the rank to keep
 * @returns {string[]} the matching cards, in hand order
 * Side effects: none.
 */
export const ofRank = (hand, rank) => hand.filter((card) => rankOf(card) === rank);

/**
 * How many cards of each rank a hand holds: { A: 2, 7: 1 ... }.
 *
 * @param {string[]} hand  card codes
 * @returns {Object<string, number>} count per rank held (ranks not held are absent)
 * Side effects: none.
 */
export function counts(hand) {
  const out = {};
  for (const card of hand) out[rankOf(card)] = (out[rankOf(card)] ?? 0) + 1;
  return out;
}

/**
 * The cards to put down when there is no honest play: the ones that are cheapest to lose, those of the ranks the hand holds
 * fewest of (a pair or a triple is worth keeping for a true play later).
 *
 * @param {string[]} hand  card codes
 * @param {number} howMany  how many cards to put down
 * @param {() => number} rng  random source, used to break ties between equally cheap cards
 * @returns {string[]} the chosen cards
 * Side effects: advances the rng.
 */
export function junk(hand, howMany, rng) {
  const have = counts(hand);
  const sorted = [...hand].map((card) => ({ card, n: have[rankOf(card)], tie: rng() })).sort((a, b) => a.n - b.n || a.tie - b.tie);
  return sorted.slice(0, howMany).map((entry) => entry.card);
}

/**
 * True when the last play cannot have been honest from where this player sits: it claims more cards of a rank than there are
 * in the packs outside their own hand.
 *
 * @param {object} ctx  the call context from aiContext (hand, decks, last)
 * @returns {boolean} true when the claim is impossible, so calling is certain to be right
 * Side effects: none.
 */
export function impossible(ctx) {
  if (!ctx.last) return false;
  const outside = ctx.decks * 4 - ofRank(ctx.hand, ctx.last.rank).length;
  return ctx.last.count > outside;
}
