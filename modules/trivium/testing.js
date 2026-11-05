// A question bank for the tests: thousands of made-up questions, in every category, with no network anywhere near it.
// `TRIVIUM_TRIVIA=test` makes server.js build its store on this instead of The Trivia API, exactly as
// `SCRIBBLERS_PICTURES=test` gives Scribblers something to draw without the web.
//
// It plugs in as a question bank (server/triviaBank.js's shape: count and draw) rather than as a fake `fetch`, so the
// questions travel through the real shared/trivia.js - its weighing, its shuffling, its "nobody sees one twice" - and
// a test is therefore exercising the same path a game really uses.  The store it is given also has a `fetch` that
// always refuses, so nothing ever reaches out.
// Depends on: ./wheel.js (the list of categories) and shared/trivia.js (the store itself).
import { createTriviaStore } from '../../shared/trivia.js';
import { CATEGORY_ORDER } from './wheel.js';

/** How many questions the bank claims to hold of each category, so the test wheel has slices of different widths. */
const HELD = [40, 900, 60, 300, 500, 450, 380, 420, 120, 260];
/** The difficulties the made-up questions are labelled with, in turn. */
const DIFFICULTIES = ['easy', 'medium', 'hard'];

/**
 * A question bank of made-up questions, in the shape shared/trivia.js expects of a source.
 *
 * @returns {{ count: Function, draw: Function }} the bank
 * Side effects: none; `draw` counts up so that no two questions are alike.
 */
export function testBank() {
  let serial = 0;
  /** How many of a category the bank says it has (its place in the list decides, so it never changes). */
  const held = (name) => HELD[CATEGORY_ORDER.indexOf(name)] ?? 0;
  return {
    count: ({ categories } = {}) => (categories ? String(categories).split(',').reduce((sum, name) => sum + held(name), 0) : HELD.reduce((a, b) => a + b, 0)),
    draw(count, { categories } = {}) {
      const category = String(categories ?? CATEGORY_ORDER[0]).split(',')[0];
      return Array.from({ length: count }, () => {
        const n = serial++;
        return {
          id: `${category}-${n}`,
          question: { text: `${category} question ${n}?` },
          correctAnswer: `${category} right ${n}`,
          incorrectAnswers: [`${category} wrong ${n}a`, `${category} wrong ${n}b`, `${category} wrong ${n}c`],
          category,
          difficulty: DIFFICULTIES[n % DIFFICULTIES.length],
          tags: [],
          regions: [],
        };
      });
    },
  };
}

/**
 * A trivia store that answers from the made-up bank and never touches the network.
 *
 * @param {object} [options]  passed on to createTriviaStore (a seeded `rng`, say)
 * @returns {object} the store, with the same methods the shared one has
 * Side effects: none until it is used.
 */
export const testStore = (options = {}) =>
  createTriviaStore({
    bank: testBank(),
    fetchImpl: () => Promise.reject(new Error('no network in the tests')),
    ...options,
  });
