// Deliberately hard to read.  It gives vague clues, plays cards that only half fit the word (so nobody can tell
// a bluff from a real play), and suspects whoever played the card that fits the clue a little too well.
// Depends on ./util.js for the clue-to-category fit scoring; uses only the caller's rng.
import { best, clueStrength, fitter, pick } from './util.js';

export const contrarian = {
  id: 'contrarian',
  name: 'Contrarian',
  description: 'Gives vague clues, plays ambiguous cards and suspects whoever fits the clue too neatly.',
  weight: 1,
  /**
   * Picks the weakest hint (lowest category match), because a vague clue is hard for everyone to read.
   * @param {{ hints: string[], cards: object }} ctx  the candidate clues and the card metadata
   * @param {() => number} rng  random source for breaking ties
   * @returns {string} one of `hints`
   * Side effects: none.
   */
  chooseWord: ({ hints, cards }, rng) => best(hints, (hint) => -clueStrength(hint, cards), rng),
  /**
   * Plays the card that fits the clue closest to "half" (fit 0.5), so it neither clearly belongs nor clearly bluffs.
   * @param {{ word: string | null, hand: number[], cards: object }} ctx  the clue (null for the imposter), the hand and the card metadata
   * @param {() => number} rng  random source for ties and for the no-information fallback
   * @returns {number} a card id from `hand`
   * Side effects: none.
   */
  playCard({ word, hand, cards }, rng) {
    const fit = fitter(word, cards);
    return fit ? best(hand, (cardId) => -Math.abs(fit(cardId) - 0.5), rng) : pick(hand, rng);
  },
  /**
   * Suspects whoever played the card that fits the clue best (too neat to be honest); in the favourite style it
   * picks the card closest to half-fitting as the most interesting.
   * @param {{ word: string, table: { playerId: string, cardId: number }[], targets: string[], judging: string, cards: object }} ctx  the round as the voter sees it
   * @param {() => number} rng  random source for ties and for the no-information fallback
   * @returns {string} a player id from `targets`
   * Side effects: none.
   */
  vote({ word, table, targets, judging, cards }, rng) {
    const fit = fitter(word, cards);
    if (!fit) return pick(targets, rng);
    const cardOf = Object.fromEntries(table.map((row) => [row.playerId, row.cardId]));
    // In the favourite style the chooser picks the most interesting card: the one that is neither obvious nor off.
    if (judging === 'favourite') return best(targets, (id) => -Math.abs(fit(cardOf[id]) - 0.5), rng);
    return best(targets, (id) => fit(cardOf[id]), rng);
  },
};
