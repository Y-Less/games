// The usual computer players of Just One. They know the words' usual clues (see words.js). As a writer they say one of the
// usual clues of the secret word; as the guesser they look for the word whose usual clues the visible ones come from; and
// when they have guessed right they pick the clue that is most closely tied to the word.
//
//   clue({ word, related }, rng)         -> the clue text (related: the word's usual clues, strongest first)
//   guess({ clues, words }, rng)         -> a word from `words`, or '' to pass
//   best({ word, clues }, rng)           -> the index in `clues` of the best hint
//
// Depends on words.js (the usual-clue lists, and normal() to compare clues). Two strategies come from one factory,
// differing only in which slice of the usual clues they write from and how loosely they guess.
import { normal, relatedTo } from '../words.js';

/**
 * How strongly a clue points to a word: 1 for its first usual clue, less for later ones, 0 for one it does not know.
 * The 1/(1+position) falloff models people saying the obvious clues first; the +0.1 keeps any known clue above an unknown one.
 * @param {string} word  the secret word
 * @param {string} clue  a clue as written (compared after normal())
 * @returns {number} 0 when unknown, otherwise 1/(1+position)+0.1 (so the first usual clue scores 1.1)
 * Side effects: none.
 */
export function link(word, clue) {
  const at = relatedTo(word).findIndex((r) => normal(r) === normal(clue));
  return at === -1 ? 0 : 1 / (1 + at) + 0.1;
}

// One random element of a list; the Math.min guards against an rng that returns exactly 1.
const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/**
 * Words best first for these clues (ties in a random order). A word's score is the sum of how strongly each visible clue
 * points to it, so several clues agreeing beat one strong one; words no clue points to are dropped (the caller then passes).
 * @param {string[]} clues  the clues the guesser can see
 * @param {string[]} words  the candidate words
 * @param {() => number} rng  random source, used to break ties
 * @returns {{word: string, score: number, tie: number}[]} the scoring candidates, best first
 * Side effects: none (advances the rng only).
 */
function ranked(clues, words, rng) {
  return words
    .map((word) => ({ word, score: clues.reduce((sum, clue) => sum + link(word, clue), 0), tie: rng() }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tie - b.tie);
}

/**
 * Builds a computer player from a slice of usual clues and a guessing looseness.
 * @param {object} config  { id, name, description, weight } as for any AI, plus:
 *   from, to  the slice of the word's usual clues (strongest first) the writer picks from: a narrow early slice is obvious,
 *             a later slice is less likely to collide with another writer and be cancelled
 *   loose     how many of the best-ranked words the guesser may choose between at random (1 = always the best)
 * @returns {object} an AI object with clue, guess and best functions
 * Side effects: none.
 */
export function makeStandard({ id, name, description, weight, from, to, loose = 1 }) {
  return {
    id,
    name,
    description,
    weight,
    // A random clue from the chosen slice of the word's usual clues.
    clue: ({ related }, rng) => pick(related.slice(from, to), rng),
    // The best-ranked word, or '' (pass) when no visible clue points at any candidate.
    guess: ({ clues, words }, rng) => {
      const top = ranked(clues, words, rng).slice(0, loose);
      return top.length ? pick(top, rng).word : '';
    },
    // The clue most strongly tied to the guessed word; the tiny random term only breaks ties.
    best: ({ word, clues }, rng) => {
      const scores = clues.map((clue, n) => ({ n, score: link(word, clue) + rng() * 0.01 }));
      return scores.sort((a, b) => b.score - a.score)[0]?.n ?? 0;
    },
  };
}

// The default player: obvious clues, always guesses the best word.
export const standard = makeStandard({
  id: 'standard',
  name: 'Standard',
  description: 'Gives one of the first few usual clues, guesses the word the clues point to best, and picks the clue most tied to it.',
  weight: 3,
  from: 0,
  to: 4,
});

// Subtler clues (less often cancelled) and a guesser that sometimes takes the runner-up.
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
