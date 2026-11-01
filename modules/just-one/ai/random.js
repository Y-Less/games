// A computer player that plays at random, for testing: any usual clue, a guess of any word, or a pass, and any hint as the best.
// It depends on nothing but the rng it is handed (so seeded games stay repeatable).

/**
 * One random element of a list.
 * @param {Array} list  the candidates (must not be empty)
 * @param {() => number} rng  random source returning [0, 1)
 * @returns {*} an element of list; the Math.min guards against an rng that returns exactly 1
 * Side effects: none (advances the rng only).
 */
const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Gives any usual clue, guesses any word (or passes), and picks any hint as the best. For testing.',
  weight: 0.5,
  // Any of the word's usual clues, with no preference for the strong ones.
  clue: ({ related }, rng) => pick(related, rng),
  // One time in five it passes (returns ''), so that passing is exercised in tests too; otherwise any word.
  guess: ({ words }, rng) => (rng() < 0.2 ? '' : pick(words, rng)),
  // The index of any clue as the best hint.
  best: ({ clues }, rng) => Math.floor(rng() * clues.length),
};

export default random;
