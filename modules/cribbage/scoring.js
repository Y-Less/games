// Cribbage counting: the show (hands and the crib) and the play (pegging). Pure functions over cards such as "5H".
import { rankOf, rankValue, suitOf } from '../../shared/cards.js';

/** What a card is worth towards fifteens and the running count: ace 1, court cards 10. */
export function pipValue(card) {
  const rank = rankOf(card);
  if (rank === 'A') return 1;
  return 'JQK'.includes(rank) ? 10 : Number(rank);
}

/** Position in a run: ace low, then 2 to 10, J, Q, K (13). */
export const runOrder = (card) => {
  const value = rankValue(card);
  return value === 14 ? 1 : value;
};

const subsetCache = new Map();
/** Every set of `size` positions out of `length`, as arrays of indexes. */
function subsets(length, size) {
  const key = `${length}:${size}`;
  if (!subsetCache.has(key)) {
    const found = [];
    const walk = (start, chosen) => {
      if (chosen.length === size) return found.push(chosen);
      for (let i = start; i < length; i++) walk(i + 1, [...chosen, i]);
    };
    walk(0, []);
    subsetCache.set(key, found);
  }
  return subsetCache.get(key);
}

const isRun = (cards) => {
  const orders = cards.map(runOrder).sort((a, b) => a - b);
  return orders.every((order, i) => i === 0 || order === orders[i - 1] + 1);
};

/** What the dealer scores for turning up a Jack ("his heels"). */
export const HEELS_POINTS = 2;

/**
 * Scores a four-card hand (or crib) with the starter. Returns { total, items }, where each item is
 * { kind: 'fifteen' | 'pair' | 'run' | 'flush' | 'nobs', cards, points, label }.
 * A flush in the crib counts only when the starter matches as well.
 */
export function scoreHand(hand, starter, { crib = false } = {}) {
  const all = [...hand, starter];
  const items = [];

  for (let size = 2; size <= all.length; size++) {
    for (const indexes of subsets(all.length, size)) {
      const cards = indexes.map((i) => all[i]);
      if (cards.reduce((sum, card) => sum + pipValue(card), 0) === 15) items.push({ kind: 'fifteen', cards, points: 2, label: 'Fifteen' });
    }
  }
  for (const [a, b] of subsets(all.length, 2)) {
    if (rankOf(all[a]) === rankOf(all[b])) items.push({ kind: 'pair', cards: [all[a], all[b]], points: 2, label: 'Pair' });
  }
  for (let size = all.length; size >= 3; size--) {
    const runs = subsets(all.length, size).map((indexes) => indexes.map((i) => all[i])).filter(isRun);
    if (runs.length) {
      for (const cards of runs) items.push({ kind: 'run', cards, points: size, label: `Run of ${size}` });
      break;
    }
  }
  if (hand.every((card) => suitOf(card) === suitOf(hand[0]))) {
    if (suitOf(starter) === suitOf(hand[0])) items.push({ kind: 'flush', cards: all, points: 5, label: 'Flush of five' });
    else if (!crib) items.push({ kind: 'flush', cards: [...hand], points: 4, label: 'Flush of four' });
  }
  const nobs = hand.find((card) => rankOf(card) === 'J' && suitOf(card) === suitOf(starter));
  if (nobs) items.push({ kind: 'nobs', cards: [nobs], points: 1, label: 'His nobs' });

  return { total: items.reduce((sum, item) => sum + item.points, 0), items };
}

const PAIR_LABELS = { 2: 'Pair', 3: 'Pair royal', 4: 'Double pair royal' };
const PAIR_POINTS = { 2: 2, 3: 6, 4: 12 };

/**
 * Scores the card just played in the current sequence of the play (the last card of `sequence`).
 * Returns { count, total, items } with items { kind: 'fifteen' | 'thirty-one' | 'pair' | 'run', points, label }.
 */
export function scorePlay(sequence) {
  const count = sequence.reduce((sum, card) => sum + pipValue(card), 0);
  const items = [];
  if (count === 15) items.push({ kind: 'fifteen', points: 2, label: 'Fifteen' });
  if (count === 31) items.push({ kind: 'thirty-one', points: 2, label: 'Thirty-one' });

  const last = sequence[sequence.length - 1];
  let same = 1;
  while (same < sequence.length && same < 4 && rankOf(sequence[sequence.length - 1 - same]) === rankOf(last)) same++;
  if (same >= 2) items.push({ kind: 'pair', points: PAIR_POINTS[same], label: PAIR_LABELS[same] });

  for (let size = sequence.length; size >= 3; size--) {
    if (isRun(sequence.slice(-size))) {
      items.push({ kind: 'run', points: size, label: `Run of ${size}` });
      break;
    }
  }
  return { count, total: items.reduce((sum, item) => sum + item.points, 0), items };
}
