// Every decision is a uniform random choice among the legal ones. It behaves like the standard bot (which is also
// random) but is kept as its own AI so it can be asked for by name and weighted separately.
// Depends only on ./util.js (pick).
import { pick } from './util.js';

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Just picks a random legal move every time.',
  weight: 0.5,
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
