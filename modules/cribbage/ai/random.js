// Pure chance: any legal discard, any legal card.
import { legalPlays, sample, splits } from './helpers.js';

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Discards and plays any legal card at random.',
  weight: 0.5,
  discard: ({ hand, discardCount, rng = Math.random }) => sample(splits(hand, discardCount), rng).discards,
  play: ({ hand, count, rng = Math.random }) => sample(legalPlays(hand, count), rng) ?? null,
};
