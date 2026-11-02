// 'Sharp': draws the shortest word it is offered, because a word people get is worth more to the drawer than a word
// they do not, and never wastes a guess on a word somebody at the table has already tried.
import { freshGuess, oneOf, wordsOfLength, wordsThatFit } from './fit.js';

export default {
  id: 'sharp',
  name: 'Sharp',
  description: 'Draws the shortest word it is offered, and never guesses a word anybody has already tried.',
  weight: 2,
  /**
   * Chooses the shortest of the words offered (the first of them when several are as short).
   * @param {object} ctx  AI context; uses choices.
   * @returns {number} which of the words offered, as its place in the list.
   * Side effects: none.
   */
  chooseWord({ choices }) {
    let best = 0;
    for (const [n, word] of choices.entries()) if ([...word].length < [...choices[best]].length) best = n;
    return best;
  },
  /**
   * Guesses a word that fits the hints and that nobody has tried yet - the wrong guesses of the others are in the
   * panel for everybody to read, so they are worth reading.
   * @param {object} ctx  AI context; uses hints, words, seen, tried and rng.
   * @returns {string | null} the guess, or null when it can think of nothing new.
   * Side effects: advances ctx.rng.
   */
  guess({ hints, words, seen, tried, rng }) {
    const spent = [...new Set([...seen, ...tried])];
    return freshGuess(wordsThatFit(hints, words), spent, rng) ?? freshGuess(wordsOfLength(hints, words), spent, rng) ?? oneOf(words, rng);
  },
};
