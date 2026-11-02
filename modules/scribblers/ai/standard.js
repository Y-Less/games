// 'Standard': draws whichever word takes its fancy and guesses words that fit the letters shown so far.  This is the
// one a computer player falls back to, so it must always answer with something legal.
import { freshGuess, oneOf, wordsOfLength, wordsThatFit } from './fit.js';

export default {
  id: 'standard',
  name: 'Standard',
  description: 'Draws any of the words offered, and guesses words that fit the letters shown.',
  weight: 2,
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
   * Guesses a word that fits the hints, never one it has already tried this turn.
   * @param {object} ctx  AI context; uses hints, words, tried and rng.
   * @returns {string | null} the guess, or null when it can think of nothing new.
   * Side effects: advances ctx.rng.
   */
  guess({ hints, words, tried, rng }) {
    const fitting = freshGuess(wordsThatFit(hints, words), tried, rng);
    return fitting ?? freshGuess(wordsOfLength(hints, words), tried, rng) ?? oneOf(words, rng);
  },
};
