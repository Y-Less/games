// The one who actually knows: right far more often than anybody, but thinks it over first, so it rarely takes the
// speed bonus off a quicker player.  It taps the middle of the button, neatly.
import { decide } from './judgement.js';

export default {
  id: 'swot',
  name: 'Bookish',
  description: 'Knows the answer more often than not, but is slow to commit.',
  weight: 2,
  /**
   * Answers one question.
   *
   * @param {object} context  the question, its answers, which is right, and how hard it is
   * @param {() => number} rng  random source returning a number in [0, 1)
   * @returns {{ choice: number, x: number, y: number, speed: number } | null} the answer
   * Side effects: none beyond advancing `rng`.
   */
  answer: (context, rng) => decide(context, rng, { knows: { easy: 0.95, medium: 0.85, hard: 0.7 }, pace: [0.45, 0.85], aim: 'centre' }),
};
