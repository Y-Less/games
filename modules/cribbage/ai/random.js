// Pure chance: any legal discard, any legal card. Depends on ./helpers.js. Used for testing and as the weakest opponent.
import { legalPlays, sample, splits } from './helpers.js';

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Discards and plays any legal card at random.',
  weight: 0.5,
  // A random choice among every split of the hand.
  discard: ({ hand, discardCount, rng }) => sample(splits(hand, discardCount), rng).discards,
  // A random card among those that keep the count at 31 or below (null when none).
  play: ({ hand, count, rng }) => sample(legalPlays(hand, count), rng) ?? null,
};
