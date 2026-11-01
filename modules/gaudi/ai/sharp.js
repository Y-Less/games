// "Sharp": the strongest computer player. Every placement is valued as expected points:
//   - the private objective (the shade of a die of its secret colour, or the flat 3 on "bad private scoring"),
//   - progress on the public objectives (finished sets exactly, unfinished ones by how far along they are, and a
//     penalty for breaking a row or column that was going well),
//   - the cost of an empty space (one point each at the end): it models how likely every space is to be filled by some
//     die over the rest of the game, from its own restriction and its neighbours' colours and shades, so filling a hard
//     space now is rewarded and shutting a neighbour in (or making a dead space) is charged,
//   - a one-move look at what is left: the placements still possible with the other dice in the pool.
// A favour token is worth one point at the end, so a tool is used only when it improves the best placement by more than
// that. The window is chosen by tokens gained against the empty spaces its restrictions are expected to leave.
import { CELLS, ORTHOGONAL, legalCells, patternOf } from '../rules.js';
import { chooseStep, fillChance, newDeadSpaces, privateOf, publicPotential, withDie } from './common.js';

const EMPTY_RISK = 1; // points lost per space expected to stay empty
const LOOKAHEAD = 0.12; // per other pool die that can still be placed

/**
 * Expected empty spaces of a pattern with no dice in it: each restriction makes a space a little harder to fill.
 * Used to compare windows when choosing one, since restrictions earn tokens but also risk unfilled spaces.
 *
 * @param {string} pid  a pattern id
 * @returns {number} the sum over all spaces of the chance each stays empty (using a generous 5 chances per space)
 *
 * Side effects: none.
 */
function expectedEmpty(pid) {
  const pattern = patternOf(pid);
  const grid = Array(CELLS).fill(null);
  let empty = 0;
  for (let i = 0; i < CELLS; i++) empty += 1 - fillChance(grid, pattern, i, 5);
  return empty;
}

export default {
  id: 'sharp',
  name: 'Sharp',
  description: 'Weighs expected points: its secret colour, the shared objectives, and the cost of every space it might leave empty. Uses a tool only when it beats a favour token.',
  weight: 3,
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
      // Difficulty is the tokens gained; the rest is the points expected to be lost to empty spaces (1.6 pads for neighbour effects).
      const score = patternOf(pid).difficulty - EMPTY_RISK * 1.6 * expectedEmpty(pid) + rng() * 0.3;
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
      // A token is worth exactly one end-of-game point (tokenValue 1) and a tool must beat the best placement by a margin on top.
      tools: 'eager',
      tokenValue: 1,
      margin: 0.6,
      reserve: 0,
      noise: 0.15,
      /**
       * Works out once per decision whatever the scores share (before-values and fill chances).
       *
       * @param {object} s    the snapshot
       * @param {number} who  the seat deciding
       * @returns {object} handed to score() as its last argument
       *
       * Side effects: none.
       */
      context(s, who) {
        const grid = s.grids[who];
        const pattern = patternOf(s.patterns[who]);
        return { pattern, publicBefore: publicPotential(s, grid), privateBefore: privateOf(s, grid), chance: grid.map((_, i) => fillChance(grid, pattern, i)) };
      },
      /**
       * How good it is to put `die` on `cell` for this AI: higher is better. Its own measure of a placement; see the
       * file header for what it values.
       *
       * @param {object} s     the snapshot
       * @param {number} who   the seat deciding
       * @param {object} die   { id, c, v } (as it would be after a tool, if one is being considered)
       * @param {number} cell  the space
       * @param {object | null} options  placement rules relaxed by a tool (only ignoreTouch matters here)
       * @param {object} context  what context() worked out for this decision
       * @returns {number} the placement's value; only the ordering between candidates matters
       *
       * Side effects: none.
       */
      score(s, who, die, cell, options, context) {
        const grid = s.grids[who];
        const { pattern } = context;
        const after = withDie(grid, cell, die);
        let score = privateOf(s, after) - context.privateBefore;
        score += publicPotential(s, after) - context.publicBefore;
        score += EMPTY_RISK * (1 - context.chance[cell]); // a hard space filled is a point saved
        for (const n of ORTHOGONAL[cell]) {
          if (!grid[n]) score -= EMPTY_RISK * (context.chance[n] - fillChance(after, pattern, n));
        }
        // A dead space is a certain lost point plus the loss of any chance it had; 4 is deliberately more than EMPTY_RISK.
        score -= 4 * newDeadSpaces(grid, after, pattern);
        if (!grid.some(Boolean)) score += 0.3; // the first die goes on an edge anyway; the corners keep most options
        if (options?.ignoreTouch) score -= 0.3;
        // Look ahead: will the rest of the pool still have somewhere to go?
        const rest = s.pool.filter((d) => d.id !== die.id);
        score += LOOKAHEAD * Math.min(3, rest.filter((d) => legalCells(after, pattern, d).length > 0).length);
        return score;
      },
    });
  },
};

