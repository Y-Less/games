// Straight in with the first thing that looks right.  It takes the speed bonus whenever it happens to be right, and
// its finger lands wherever it lands.
import { decide } from './judgement.js';

export default {
  id: 'quickfire',
  name: 'Trigger finger',
  description: 'Answers almost at once, right or wrong.',
  weight: 2,
  /**
   * Answers one question.
   *
   * @param {object} context  the question, its answers, which is right, and how hard it is
   * @param {() => number} rng  random source returning a number in [0, 1)
   * @returns {{ choice: number, x: number, y: number, speed: number } | null} the answer
   * Side effects: none beyond advancing `rng`.
   */
  answer: (context, rng) => decide(context, rng, { knows: { easy: 0.75, medium: 0.5, hard: 0.3 }, pace: [0.03, 0.18], aim: 'edge' }),
};
