// Pure chance: any allowed nomination, any legal card.
import { sample } from './cards.js';

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Nominates any allowed number and plays any legal card at random.',
  weight: 0.5,
  /**
   * Any allowed nomination.
   *
   * @param {{allowed: number[], rng: () => number}} ctx  nomination context
   * @returns {number} the nomination
   * Side effects: advances ctx.rng.
   */
  nominate: ({ allowed, rng }) => sample(allowed, rng),
  /**
   * Any legal card.
   *
   * @param {{legal: string[], rng: () => number}} ctx  play context
   * @returns {string} the card to play
   * Side effects: advances ctx.rng.
   */
  play: ({ legal, rng }) => sample(legal, rng),
};
