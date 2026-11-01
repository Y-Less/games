// "Public hunter": plays for the three public objectives on the table, which everyone shares. It counts progress towards
// sets, rows and columns, not only finished ones, and gives its secret colour little thought.
import { patternOf } from '../rules.js';
import { chooseStep, newDeadSpaces, privateOf, publicPotential, withDie } from './common.js';

export default {
  id: 'public-hunter',
  name: 'Public hunter',
  description: 'Builds for the shared objectives: rows and columns without repeats, matching pairs and full sets. Mostly ignores its secret colour.',
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
    // The windows with the fewest restricted spaces leave the most freedom to build rows and columns.
    return options.reduce((best, pid) => {
      const restricted = patternOf(pid).cells.filter((c) => c !== '.').length;
      const score = -restricted + rng() * 2;
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
      // Tokens are worth a little more to it (1.2, margin 2, two kept back): the shared objectives rarely justify a costly tool.
      tools: 'eager',
      tokenValue: 1.2,
      margin: 2,
      reserve: 2,
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
        const after = withDie(grid, cell, die);
        // Progress on the shared objectives dominates (x3); the secret colour is a minor tie-break (x0.3); dead spaces cost 6.
        let score = 3 * (publicPotential(s, after) - publicPotential(s, grid));
        score += 0.3 * (privateOf(s, after) - privateOf(s, grid));
        score += 1 - 6 * newDeadSpaces(grid, after, patternOf(s.patterns[who]));
        return score;
      },
    });
  },
};
