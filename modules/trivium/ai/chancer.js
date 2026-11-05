// Knows nothing and admits it: one of the answers, picked evenly, at whatever moment takes its fancy.  This is the
// "just pick a legal move" player every game should offer, and it is the floor the others are measured against.
import { decide } from './judgement.js';

export default {
  id: 'chancer',
  name: 'Chancer',
  description: 'Picks an answer at random and hopes.',
  weight: 1,
  /**
   * Answers one question.
   *
   * @param {object} context  the question, its answers, which is right, and how hard it is
   * @param {() => number} rng  random source returning a number in [0, 1)
   * @returns {{ choice: number, x: number, y: number, speed: number } | null} the answer
   * Side effects: none beyond advancing `rng`.
   */
  answer: (context, rng) => {
    const answers = Array.isArray(context?.answers) ? context.answers : [];
    // Evenly across every answer, which means ignoring `correct` altogether rather than rolling against it.
    const even = answers.length ? 1 / answers.length : 0;
    return decide(context, rng, { knows: { easy: even, medium: even, hard: even }, pace: [0.1, 0.9] });
  },
};
