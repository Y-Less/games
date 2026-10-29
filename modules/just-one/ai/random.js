// A computer player that plays at random, for testing: any usual clue, a guess of any word, or a pass, and any hint as the best.
const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Gives any usual clue, guesses any word (or passes), and picks any hint as the best. For testing.',
  weight: 0.5,
  clue: ({ related }, rng) => pick(related, rng),
  guess: ({ words }, rng) => (rng() < 0.2 ? '' : pick(words, rng)),
  best: ({ clues }, rng) => Math.floor(rng() * clues.length),
};

export default random;
