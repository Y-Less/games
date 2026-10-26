// Knows whose crib it is: keeps what helps its own crib, and starves an opponent's crib of fives, pairs and runs.
import { averageHandScore, cribEstimate, hashedRng, splits, unseenFrom } from './helpers.js';
import { standard } from './standard.js';

const SAMPLES = 24;

export const balanced = {
  id: 'balanced',
  name: 'Balanced',
  description: 'Weighs its hand against the crib: feeds its own crib, and avoids giving fives and pairs to an opponent\'s.',
  weight: 1,
  discard({ hand, discardCount, isDealer, players = 2 }) {
    const unseen = unseenFrom(hand);
    const rng = hashedRng(hand.join(','));
    // With more players the crib belongs to one dealer but hurts every other player only a little.
    const sign = isDealer ? 1 : -1 / Math.max(1, players - 1);
    let best = null;
    for (const { keep, discards } of splits(hand, discardCount)) {
      const value = averageHandScore(keep, unseen) + sign * cribEstimate(discards, unseen, SAMPLES, rng);
      if (!best || value > best.value) best = { value, discards };
    }
    return best.discards;
  },
  play: (ctx) => standard.play(ctx),
};
