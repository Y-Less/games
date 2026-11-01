// Takes the clue at face value: plays the card whose category suits the word best, and suspects the card that
// suits it least. Knows nothing about the other players, and bluffs at random when it cannot see the word.
// Depends on ./util.js for the clue-to-category fit scoring; uses only the caller's rng.
import { best, clueStrength, fitter, pick } from './util.js';

export const literal = {
  id: 'literal',
  name: 'Literal',
  description: 'Matches the clue word to each card\'s category. Plays the best fit and distrusts the worst.',
  weight: 2,
  /**
   * Picks the strongest hint, i.e. the clue that matches one category most clearly.
   * @param {{ hints: string[], cards: object }} ctx  the candidate clues and the card metadata
   * @param {() => number} rng  random source for breaking ties
   * @returns {string} one of `hints`
   * Side effects: none.
   */
  chooseWord: ({ hints, cards }, rng) => best(hints, (hint) => clueStrength(hint, cards), rng),
  /**
   * Plays the card whose category fits the clue best; random if the clue means nothing or the word is hidden.
   * @param {{ word: string | null, hand: number[], cards: object }} ctx  the clue (null for the imposter), the hand and the card metadata
   * @param {() => number} rng  random source for ties and fallback
   * @returns {number} a card id from `hand`
   * Side effects: none.
   */
  playCard({ word, hand, cards }, rng) {
    const fit = fitter(word, cards);
    return fit ? best(hand, fit, rng) : pick(hand, rng);
  },
  /**
   * Accuses the player whose card fits the clue worst (in the favourite style, picks the best fit instead).
   * @param {{ word: string, table: { playerId: string, cardId: number }[], targets: string[], judging: string, cards: object }} ctx  the round as the voter sees it
   * @param {() => number} rng  random source for ties and fallback
   * @returns {string} a player id from `targets`
   * Side effects: none.
   */
  vote({ word, table, targets, judging, cards }, rng) {
    const fit = fitter(word, cards);
    if (!fit) return pick(targets, rng);
    const cardOf = Object.fromEntries(table.map((row) => [row.playerId, row.cardId]));
    const sign = judging === 'favourite' ? 1 : -1; // favourite: the best fit; otherwise the worst fit is the bluffer
    return best(targets, (id) => sign * fit(cardOf[id]), rng);
  },
};
