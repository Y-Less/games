// "Private chaser": the secret colour is worth its dice's shades, so it takes every die of that colour it can use, puts
// the high shades in, and will turn a die over or shift it a shade (spending tokens) to make it a bigger one.
import { patternOf } from '../rules.js';
import { chooseStep, newDeadSpaces, privateOf, pickOne, publicPoints, withDie } from './common.js';

export default {
  id: 'private-chaser',
  name: 'Private chaser',
  description: 'Hunts its secret colour: takes those dice first, wants high shades, and spends favour tokens to raise them.',
  weight: 1.5,
  chooseWindow: (options, rng) => pickOne(options, rng),
  chooseStep(state, seat, rng) {
    return chooseStep(state, seat, rng, {
      tools: 'eager',
      tokenValue: 0.8,
      margin: 1.5,
      reserve: 1,
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
