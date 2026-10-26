// "Random": a uniformly random legal move, whatever the position. The easiest opponent, and the baseline the others
// are measured against.
import { randomReturn } from './lib.js';

export default {
  id: 'random',
  name: 'Random',
  description: 'Just picks a random legal move. Great for a relaxed game.',
  weight: 1,
  chooseMove(s, rng) {
    if (!s.moves.length) return { type: 'pass' };
    return s.moves[Math.floor(rng() * s.moves.length)];
  },
  chooseReturn: randomReturn,
  chooseNoble(s, rng) {
    return s.options[Math.floor(rng() * s.options.length)];
  },
};
