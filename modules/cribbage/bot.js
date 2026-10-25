// The computer players' decisions. Both functions are pure and always return legal moves.
import { fullDeck } from '../../shared/cards.js';
import { pipValue, runOrder, scoreHand, scorePlay } from './scoring.js';

const CRIB_WEIGHT = 0.8;

/** A rough guide to what a crib containing these discards is worth to whoever owns it. */
export function cribPotential(discards) {
  if (discards.length === 1) return pipValue(discards[0]) === 5 ? 1.3 : 0.4;
  const [a, b] = discards;
  let value = 0;
  if (a.slice(0, -1) === b.slice(0, -1)) value += 2;
  if (pipValue(a) + pipValue(b) === 15) value += 2;
  for (const card of discards) if (pipValue(card) === 5) value += 0.7;
  const gap = Math.abs(runOrder(a) - runOrder(b));
  if (gap === 1) value += 0.8;
  else if (gap === 2) value += 0.4;
  if (a.slice(-1) === b.slice(-1)) value += 0.3;
  return value;
}

function keeps(hand, keepCount) {
  const found = [];
  const walk = (start, chosen) => {
    if (chosen.length === keepCount) return found.push(chosen);
    for (let i = start; i < hand.length; i++) walk(i + 1, [...chosen, i]);
  };
  walk(0, []);
  return found;
}

/**
 * Picks the cards to put in the crib: the choice whose kept hand is worth most on average over every starter that
 * could turn up, nudged by how much the crib is likely to be worth (good for the dealer, bad for everyone else).
 */
export function chooseDiscard(hand, { discardCount, isDealer }) {
  const unseen = fullDeck().filter((card) => !hand.includes(card));
  let best = null;
  for (const indexes of keeps(hand, hand.length - discardCount)) {
    const keep = indexes.map((i) => hand[i]);
    const discards = hand.filter((_, i) => !indexes.includes(i));
    let sum = 0;
    for (const starter of unseen) sum += scoreHand(keep, starter).total;
    const value = sum / unseen.length + (isDealer ? 1 : -1) * CRIB_WEIGHT * cribPotential(discards);
    if (!best || value > best.value) best = { value, discards };
  }
  return best.discards;
}

/**
 * Picks the card to play, or null when none is legal. Prefers points, avoids leaving a count of 5, 10 or 21 (an easy
 * fifteen or thirty-one for the next player), and otherwise plays low when leading and high when following.
 */
export function choosePlay(hand, { count, sequence }) {
  let best = null;
  for (const card of hand) {
    if (count + pipValue(card) > 31) continue;
    const { count: newCount, total } = scorePlay([...sequence, card]);
    let value = total;
    if (newCount === 5 || newCount === 10 || newCount === 21) value -= 0.9;
    value += sequence.length === 0 ? -pipValue(card) * 0.03 : pipValue(card) * 0.01;
    if (!best || value > best.value) best = { value, card };
  }
  return best?.card ?? null;
}
