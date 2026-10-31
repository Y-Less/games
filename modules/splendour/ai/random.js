// "Random": a uniformly random legal move, whatever the position. The easiest opponent, and the baseline the others
// are measured against.
import { randomReturn } from './lib.js';

export default {
  id: 'random',
  name: 'Random',
  description: 'Just picks a random legal move. Great for a relaxed game.',
  weight: 1,
  /**
   * Picks any legal move at random.
   *
   * @param {object} s  the situation (see lib.js)
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {object} one of s.moves, or { type: 'pass' } when there are none
   */
  chooseMove(s, rng) {
    if (!s.moves.length) return { type: 'pass' };
    return s.moves[Math.floor(rng() * s.moves.length)];
  },
  // Which tokens to give back: chosen at random (see randomReturn in lib.js).
  chooseReturn: randomReturn,
  /**
   * Picks any of the visiting nobles at random.
   *
   * @param {object} s  the situation (uses options)
   * @param {() => number} rng
   * @returns {string} a noble id from s.options
   */
  chooseNoble(s, rng) {
    return s.options[Math.floor(rng() * s.options.length)];
  },
};
