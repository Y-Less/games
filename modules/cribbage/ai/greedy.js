// Short-sighted: the best-scoring hand now, and the most points from each card as it is played.
import { pipValue, scorePlay } from '../scoring.js';
import { averageHandScore, splits, unseenFrom } from './helpers.js';

export const greedy = {
  id: 'greedy',
  name: 'Greedy',
  description: 'Keeps the highest-scoring hand whatever it feeds the crib, and plays whichever card scores most right now.',
  weight: 1,
  discard({ hand, discardCount }) {
    const unseen = unseenFrom(hand);
    let best = null;
    for (const { keep, discards } of splits(hand, discardCount)) {
      const value = averageHandScore(keep, unseen);
      if (!best || value > best.value) best = { value, discards };
    }
    return best.discards;
  },
  play({ hand, count, sequence }) {
    let best = null;
    for (const card of hand) {
      if (count + pipValue(card) > 31) continue;
      const value = scorePlay([...sequence, card]).total + pipValue(card) * 0.001;
      if (!best || value > best.value) best = { value, card };
    }
    return best?.card ?? null;
  },
};
