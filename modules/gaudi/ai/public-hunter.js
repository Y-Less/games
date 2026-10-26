// "Public hunter": plays for the three public objectives on the table, which everyone shares. It counts progress towards
// sets, rows and columns, not only finished ones, and gives its secret colour little thought.
import { patternOf } from '../rules.js';
import { chooseStep, newDeadSpaces, privateOf, publicPotential, withDie } from './common.js';

export default {
  id: 'public-hunter',
  name: 'Public hunter',
  description: 'Builds for the shared objectives: rows and columns without repeats, matching pairs and full sets. Mostly ignores its secret colour.',
  weight: 1.5,
  chooseWindow(options, rng) {
    // The windows with the fewest restricted spaces leave the most freedom to build rows and columns.
    return options.reduce((best, pid) => {
      const restricted = patternOf(pid).cells.filter((c) => c !== '.').length;
      const score = -restricted + rng() * 2;
      return !best || score > best.score ? { pid, score } : best;
    }, null).pid;
  },
  chooseStep(state, seat, rng) {
    return chooseStep(state, seat, rng, {
      tools: 'eager',
      tokenValue: 1.2,
      margin: 2,
      reserve: 2,
      score(s, who, die, cell) {
        const grid = s.grids[who];
        const after = withDie(grid, cell, die);
        let score = 3 * (publicPotential(s, after) - publicPotential(s, grid));
        score += 0.3 * (privateOf(s, after) - privateOf(s, grid));
        score += 1 - 6 * newDeadSpaces(grid, after, patternOf(s.patterns[who]));
        return score;
      },
    });
  },
};
