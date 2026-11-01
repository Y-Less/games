// Short-sighted: the best-scoring hand now, and the most points from each card as it is played. Ignores the crib completely.
// Depends on ../scoring.js and ./helpers.js.
import { pipValue, scorePlay } from '../scoring.js';
import { averageHandScore, splits, unseenFrom } from './helpers.js';

export const greedy = {
  id: 'greedy',
  name: 'Greedy',
  description: 'Keeps the highest-scoring hand whatever it feeds the crib, and plays whichever card scores most right now.',
  weight: 1,
  /**
   * Keeps the four-card hand (or fewer) with the highest average score over every possible starter, whatever it feeds the crib.
   *
   * @param {object} ctx  the discard context from the game
   * @param {string[]} ctx.hand  the dealt cards
   * @param {number} ctx.discardCount  how many cards to discard
   * @returns {string[]} the cards to discard
   * Side effects: none.
   */
  discard({ hand, discardCount }) {
    const unseen = unseenFrom(hand);
    let best = null;
    for (const { keep, discards } of splits(hand, discardCount)) {
      const value = averageHandScore(keep, unseen);
      if (!best || value > best.value) best = { value, discards };
    }
    return best.discards;
  },
  /**
   * Plays the card that scores most right now; the tiny pip term makes ties go to the higher card (it empties the hand of big cards).
   *
   * @param {object} ctx  the play context from the game
   * @param {string[]} ctx.hand  the cards still held
   * @param {number} ctx.count  the running count
   * @param {string[]} ctx.sequence  the cards played since the count last reset
   * @returns {string | null} the card, or null when none can be played without passing 31
   * Side effects: none.
   */
  play({ hand, count, sequence }) {
    let best = null;
    for (const card of hand) {
      if (count + pipValue(card) > 31) continue;
      const value = scorePlay([...sequence, card]).total + pipValue(card) * 0.001;
      if (!best || value > best.value) best = { value, card };
    }
    return best?.card ?? null;
  },
};
