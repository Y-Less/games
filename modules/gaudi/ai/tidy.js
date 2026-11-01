// "Tidy": cares about nothing but a full window. It never makes a space that no die could fill, prefers placements that
// leave every neighbouring space with as many options as possible, fills the awkward restricted spaces first, picks the
// easiest window, and spends a favour token only when it has no legal placement at all.
import { ORTHOGONAL, patternOf } from '../rules.js';
import { chooseStep, fillChance, newDeadSpaces, withDie } from './common.js';

export default {
  id: 'tidy',
  name: 'Tidy',
  description: 'Plays for a full window: never boxes in a space, keeps neighbours flexible and fills restricted spaces first. Takes the easiest window.',
  weight: 1.5,
  /**
   * Chooses this computer player's window from the four it is offered.
   *
   * @param {string[]} options  pattern ids on offer
   * @param {() => number} rng  random source returning [0, 1); used for variety or tie-breaking
   * @returns {string} one of the options
   *
   * Side effects: none (other than advancing rng).
   */
  chooseWindow(options, rng) {
    return options.reduce((best, pid) => {
      // Fewer restrictions means fewer awkward spaces to fill, so the easiest window gives the best chance of a full grid.
      const score = -patternOf(pid).difficulty + rng() * 0.8;
      return !best || score > best.score ? { pid, score } : best;
    }, null).pid;
  },
  /**
   * Decides one step of this computer player's turn: place a die, use a tool, or end the turn. Changes nothing.
   *
   * @param {object} state  the read-only snapshot described in common.js
   * @param {number} seat   the seat deciding
   * @param {() => number} rng  random source returning [0, 1); used for tie-breaking noise
   * @returns {{ type: 'place', die: number, cell: number } | { type: 'tool', tool: string, params: object } | { type: 'end' }}
   *
   * Side effects: none (other than advancing rng); the caller applies the returned step.
   */
  chooseStep(state, seat, rng) {
    return chooseStep(state, seat, rng, {
      // Tokens are only worth spending to rescue a stuck turn; a tidy window never needs a tool otherwise.
      tools: 'stuck',
      /**
       * How good it is to put `die` on `cell` for this AI: higher is better. Its own measure of a placement; see the
       * file header for what it values.
       *
       * @param {object} s     the snapshot
       * @param {number} who   the seat deciding
       * @param {object} die   { id, c, v } (as it would be after a tool, if one is being considered)
       * @param {number} cell  the space
       * @returns {number} the placement's value; only the ordering between candidates matters
       *
       * Side effects: none.
       */
      score(s, who, die, cell) {
        const grid = s.grids[who];
        const pattern = patternOf(s.patterns[who]);
        const after = withDie(grid, cell, die);
        // Weights: dead spaces are by far the worst outcome (25), then squeezing a neighbour's options (3), then relieving a hard space (2).
        let score = 2 * (1 - fillChance(grid, pattern, cell)); // a hard space filled is a risk removed
        for (const n of ORTHOGONAL[cell]) if (!grid[n]) score -= 3 * (fillChance(grid, pattern, n) - fillChance(after, pattern, n));
        score -= 25 * newDeadSpaces(grid, after, pattern);
        return score;
      },
    });
  },
};
