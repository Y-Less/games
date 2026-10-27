// The only computer player for Tints and Hints, for testing: it has no logic at all. As the hinter it types a random
// everyday word, and as a guesser it picks a random square (in round two as well, ignoring the first guesses).
// Randomness comes only from the `rng` the game passes in.
import { COLS, ROWS } from '../grid.js';

export const WORDS = [
  'apple', 'river', 'blanket', 'thunder', 'candle', 'bicycle', 'garden', 'pencil', 'window', 'ocean',
  'sandwich', 'mountain', 'teapot', 'lantern', 'carpet', 'bridge', 'pocket', 'harvest', 'kettle', 'meadow',
];

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Gives a random everyday word as its hint and guesses a random square. For testing.',
  /** hint({ round }, rng) -> a word */
  hint: (_context, rng) => pick(WORDS, rng),
  /** guess({ round, cells }, rng) -> one of the squares (`cells` lists every legal one) */
  guess: ({ cells = COLS.flatMap((c) => ROWS.map((r) => c + r)) }, rng) => pick(cells, rng),
};

export default random;
