// "Private chaser": the secret colour is worth its dice's shades, so it takes every die of that colour it can use, puts
// the high shades in, and will turn a die over or shift it a shade (spending tokens) to make it a bigger one.
import { patternOf } from '../rules.js';
import { chooseStep, newDeadSpaces, privateOf, pickOne, publicPoints, withDie } from './common.js';

export default {
  id: 'private-chaser',
  name: 'Private chaser',
  description: 'Hunts its secret colour: takes those dice first, wants high shades, and spends favour tokens to raise them.',
  weight: 1.5,
  /**
   * Chooses this computer player's window from the four it is offered.
   *
   * @param {string[]} options  pattern ids
   * @param {() => number} rng
   * @returns {string} one of the options
   */
  chooseWindow: (options, rng) => pickOne(options, rng),
  /**
   * Decides one step of this computer player's turn: place a die, use a tool, or end the turn. Changes nothing.
   *
   * @param {object} state  the read-only snapshot described in common.js
   * @param {number} seat   the seat deciding
   * @param {() => number} rng
   * @returns {{ type: 'place', die: number, cell: number } | { type: 'tool', tool: string, params: object } | { type: 'end' }}
   */
  chooseStep(state, seat, rng) {
    return chooseStep(state, seat, rng, {
      tools: 'eager',
      tokenValue: 0.8,
      margin: 1.5,
      reserve: 1,
      /**
       * How good it is to put `die` on `cell` for this AI: higher is better. Its own measure of a placement; see the
       * file header for what it values.
       *
       * @param {object} s     the snapshot
       * @param {number} who   the seat deciding
       * @param {object} die   { id, c, v } (as it would be after a tool, if one is being considered)
       * @param {number} cell  the space
       * @returns {number}
       */
      score(s, who, die, cell) {
        const grid = s.grids[who];
        const after = withDie(grid, cell, die);
        let score = 3 * (privateOf(s, after) - privateOf(s, grid));
        score += 0.4 * (publicPoints(s, after) - publicPoints(s, grid));
        score += 1 - 6 * newDeadSpaces(grid, after, patternOf(s.patterns[who]));
        return score;
      },
    });
  },
};
