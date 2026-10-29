// The usual computer players of Just One. They know the words' usual clues (see words.js). As a writer they say one of the
// usual clues of the secret word; as the guesser they look for the word whose usual clues the visible ones come from; and
// when they have guessed right they pick the clue that is most closely tied to the word.
//
//   clue({ word, related }, rng)         -> the clue text (related: the word's usual clues, strongest first)
//   guess({ clues, words }, rng)         -> a word from `words`, or '' to pass
//   best({ word, clues }, rng)           -> the index in `clues` of the best hint
import { normal, relatedTo } from '../words.js';

/** How strongly a clue points to a word: 1 for its first usual clue, less for later ones, 0 for one it does not know. */
export function link(word, clue) {
  const at = relatedTo(word).findIndex((r) => normal(r) === normal(clue));
  return at === -1 ? 0 : 1 / (1 + at) + 0.1;
}

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** Words best first for these clues (ties in a random order). */
function ranked(clues, words, rng) {
  return words
    .map((word) => ({ word, score: clues.reduce((sum, clue) => sum + link(word, clue), 0), tie: rng() }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tie - b.tie);
}

export function makeStandard({ id, name, description, weight, from, to, loose = 1 }) {
  return {
    id,
    name,
    description,
    weight,
    clue: ({ related }, rng) => pick(related.slice(from, to), rng),
    guess: ({ clues, words }, rng) => {
      const top = ranked(clues, words, rng).slice(0, loose);
      return top.length ? pick(top, rng).word : '';
    },
    best: ({ word, clues }, rng) => {
      const scores = clues.map((clue, n) => ({ n, score: link(word, clue) + rng() * 0.01 }));
      return scores.sort((a, b) => b.score - a.score)[0]?.n ?? 0;
    },
  };
}

export const standard = makeStandard({
  id: 'standard',
  name: 'Standard',
  description: 'Gives one of the first few usual clues, guesses the word the clues point to best, and picks the clue most tied to it.',
  weight: 3,
  from: 0,
  to: 4,
});

export const adventurous = makeStandard({
  id: 'adventurous',
  name: 'Adventurous',
  description: 'Gives less obvious clues, which are less likely to be cancelled, and sometimes guesses the second best word.',
  weight: 2,
  from: 3,
  to: 8,
  loose: 2,
});

export default standard;
