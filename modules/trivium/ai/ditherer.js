// Sits on its hands.  It knows about as much as anybody, but it leaves it so late that it quite often misses the
// question altogether, which is the one thing that scores nothing at all even when you knew the answer.
import { decide } from './judgement.js';

export default {
  id: 'ditherer',
  name: 'Dithering',
  description: 'Leaves it late, and sometimes leaves it too late.',
  weight: 1,
  /**
   * Answers one question.
   *
   * @param {object} context  the question, its answers, which is right, and how hard it is
   * @param {() => number} rng  random source returning a number in [0, 1)
   * @returns {{ choice: number, x: number, y: number, speed: number } | null} the answer, or null to let it go by
   * Side effects: none beyond advancing `rng`.
   */
  answer: (context, rng) => decide(context, rng, { knows: { easy: 0.8, medium: 0.6, hard: 0.4 }, pace: [0.7, 0.95], silence: 0.2 }),
};
