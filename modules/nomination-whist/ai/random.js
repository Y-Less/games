// Pure chance: any allowed nomination, any legal card.
import { sample } from './cards.js';

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Nominates any allowed number and plays any legal card at random.',
  weight: 0.5,
  nominate: ({ allowed, rng = Math.random }) => sample(allowed, rng),
  play: ({ legal, rng = Math.random }) => sample(legal, rng),
};
