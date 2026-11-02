// 'Random': shouts out any word in the book.  The weakest player at the table, for a relaxed game.
import { oneOf } from './fit.js';

export default {
  id: 'random',
  name: 'Random',
  description: 'Draws any of the words offered and guesses any word at all.',
  weight: 0.5,
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
   * Guesses a word, any word.
   * @param {object} ctx  AI context; uses words and rng.
   * @returns {string | null} the guess.
   * Side effects: advances ctx.rng.
   */
  guess({ words, rng }) {
    return oneOf(words, rng);
  },
};
