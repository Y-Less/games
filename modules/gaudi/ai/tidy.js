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
  chooseWindow(options, rng) {
    return options.reduce((best, pid) => {
      const score = -patternOf(pid).difficulty + rng() * 0.8;
      return !best || score > best.score ? { pid, score } : best;
    }, null).pid;
  },
  chooseStep(state, seat, rng) {
    return chooseStep(state, seat, rng, {
      tools: 'stuck',
      score(s, who, die, cell) {
        const grid = s.grids[who];
        const pattern = patternOf(s.patterns[who]);
        const after = withDie(grid, cell, die);
        let score = 2 * (1 - fillChance(grid, pattern, cell)); // a hard space filled is a risk removed
        for (const n of ORTHOGONAL[cell]) if (!grid[n]) score -= 3 * (fillChance(grid, pattern, n) - fillChance(after, pattern, n));
        score -= 25 * newDeadSpaces(grid, after, pattern);
        return score;
      },
    });
  },
};
