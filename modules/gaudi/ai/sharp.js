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

/** Expected empty spaces of a pattern with no dice in it: each restriction makes a space a little harder to fill. */
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
  chooseWindow(options, rng) {
    return options.reduce((best, pid) => {
      const score = patternOf(pid).difficulty - EMPTY_RISK * 1.6 * expectedEmpty(pid) + rng() * 0.3;
      return !best || score > best.score ? { pid, score } : best;
    }, null).pid;
  },
  chooseStep(state, seat, rng) {
    return chooseStep(state, seat, rng, {
      tools: 'eager',
      tokenValue: 1,
      margin: 0.6,
      reserve: 0,
      noise: 0.15,
      context(s, who) {
        const grid = s.grids[who];
        const pattern = patternOf(s.patterns[who]);
        return { pattern, publicBefore: publicPotential(s, grid), privateBefore: privateOf(s, grid), chance: grid.map((_, i) => fillChance(grid, pattern, i)) };
      },
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

