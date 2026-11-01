// The original bot: a random hint, a random card from the hand, a random vote.
// Depends only on ./util.js (pick).
import { pick } from './util.js';

export const standard = {
  id: 'standard',
  name: 'Standard',
  description: 'Picks a hint word, plays a card and votes at random. The bot as it always was.',
  weight: 3,
  /**
   * Picks a hint uniformly at random.
   * @param {{ hints: string[] }} ctx  the candidate clues
   * @param {() => number} rng  random source
   * @returns {string} one of `hints`
   * Side effects: none.
   */
  chooseWord: ({ hints }, rng) => pick(hints, rng),
  /**
   * Plays a uniformly random card from the hand.
   * @param {{ hand: number[] }} ctx  the hand
   * @param {() => number} rng  random source
   * @returns {number} a card id from `hand`
   * Side effects: none.
   */
  playCard: ({ hand }, rng) => pick(hand, rng),
  /**
   * Votes for a uniformly random legal target.
   * @param {{ targets: string[] }} ctx  the legal vote targets
   * @param {() => number} rng  random source
   * @returns {string} a player id from `targets`
   * Side effects: none.
   */
  vote: ({ targets }, rng) => pick(targets, rng),
};
