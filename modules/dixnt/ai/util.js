// Small helpers shared by the AIs. Nothing here uses Math.random: the caller's `rng` is always passed in.
import { themeScores } from './lexicon.js';

export const pick = (items, rng) => items[Math.floor(rng() * items.length)];

/** The item with the highest score (random among ties when `rng` is given, otherwise the first one). */
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
 * (then there is nothing to go on, and callers fall back to guessing).
 */
export function fitter(word, cards) {
  if (!word) return null;
  const scores = themeScores(word, cards.categories);
  const top = Math.max(0, ...Object.values(scores));
  if (top <= 0) return null;
  return (cardId) => (scores[cards.categoryOf[cardId]] ?? 0) / top;
}

/** The strongest single theme match of a clue (0 when the word list knows nothing about it). */
export function clueStrength(word, cards) {
  return Math.max(0, ...Object.values(themeScores(word, cards.categories)));
}

/** For each card on the table, the share of the other cards from a different category (1 = the odd one out). */
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
