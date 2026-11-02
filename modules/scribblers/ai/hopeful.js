// 'Hopeful': counts the letters but never looks at which ones have been shown, so it keeps guessing words that the
// hints have already ruled out.  A gentler opponent.
import { freshGuess, oneOf, wordsOfLength } from './fit.js';

export default {
  id: 'hopeful',
  name: 'Hopeful',
  description: 'Guesses words of the right length without looking at the letters shown.',
  weight: 1,
  /**
   * Chooses a word to draw.
   * @param {object} ctx  AI context; uses choices and rng.
   * @returns {number} which of the words offered, as its place in the list.
   * Side effects: advances ctx.rng.
   */
  chooseWord({ choices, rng }) {
    return Math.min(choices.length - 1, Math.floor(rng() * choices.length));
  },
  /**
   * Guesses any word of the right length.
   * @param {object} ctx  AI context; uses hints, words, tried and rng.
   * @returns {string | null} the guess, or null when it can think of nothing new.
   * Side effects: advances ctx.rng.
   */
  guess({ hints, words, tried, rng }) {
    return freshGuess(wordsOfLength(hints, words), tried, rng) ?? oneOf(words, rng);
  },
};
