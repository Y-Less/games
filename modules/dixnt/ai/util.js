// Small helpers shared by the AIs. Nothing here uses Math.random: the caller's `rng` is always passed in.
import { themeScores } from './lexicon.js';

/**
 * Picks one item uniformly.
 * @param {any[]} items  non-empty list to choose from
 * @param {() => number} rng  random source returning [0, 1)
 * @returns {any} one element of `items`
 * Side effects: none (advances `rng`).
 */
export const pick = (items, rng) => items[Math.floor(rng() * items.length)];

/**
 * The item with the highest score (random among ties when `rng` is given, otherwise the first one).
 * @param {any[]} items  candidates
 * @param {(item: any) => number} score  higher is better
 * @param {(() => number) | null} [rng]  tie-break source; null keeps the first of the tied items (deterministic)
 * @returns {any} the best item
 * Side effects: none (advances `rng` when given).
 */
export function best(items, score, rng = null) {
  let top = [];
  let topScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > topScore) {
      topScore = s;
      top = [item];
    } else if (s === topScore) top.push(item);
  }
  return rng ? pick(top, rng) : top[0];
}

/**
 * How well a clue fits each card: a function cardId -> 0..1, or null when the clue means nothing to the word list
 * (then there is nothing to go on, and callers fall back to guessing). Scores are normalised by the best category so
 * the closest category is 1 whatever the clue's absolute strength.
 * @param {string | null} word  the clue, or null/empty when hidden
 * @param {{ categoryOf: object, categories: object }} cards  card metadata
 * @returns {((cardId: number) => number) | null} the fit function, or null if there is nothing to go on
 * Side effects: none.
 */
export function fitter(word, cards) {
  if (!word) return null;
  const scores = themeScores(word, cards.categories);
  const top = Math.max(0, ...Object.values(scores));
  if (top <= 0) return null;
  return (cardId) => (scores[cards.categoryOf[cardId]] ?? 0) / top;
}

/**
 * The strongest single theme match of a clue (0 when the word list knows nothing about it); used to pick or avoid clear clues.
 * @param {string} word  the clue
 * @param {{ categories: object }} cards  card metadata
 * @returns {number} the top category score, 0 or more
 * Side effects: none.
 */
export function clueStrength(word, cards) {
  return Math.max(0, ...Object.values(themeScores(word, cards.categories)));
}

/**
 * For each card on the table, the share of the other cards from a different category (1 = the odd one out).
 * Cards with no known category count as their own category so they always look odd.
 * @param {{ playerId: string, cardId: number }[]} table  the played cards
 * @param {{ categoryOf: object }} cards  card metadata
 * @returns {{ [playerId: string]: number }} oddness 0..1 per player (0 when alone on the table)
 * Side effects: none.
 */
export function oddness(table, cards) {
  const categoryOf = (cardId) => cards.categoryOf[cardId] ?? `?${cardId}`;
  const out = {};
  for (const row of table) {
    const others = table.filter((r) => r.playerId !== row.playerId);
    const same = others.filter((r) => categoryOf(r.cardId) === categoryOf(row.cardId)).length;
    out[row.playerId] = others.length ? 1 - same / others.length : 0;
  }
  return out;
}
