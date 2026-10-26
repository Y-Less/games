// "Tool user": spends its favour tokens freely. It takes the hardest window (the most tokens), and each turn it checks
// whether turning a die over, shifting it a shade, swapping it with one from the round track or placing it anywhere
// (Free Pane) gives a better placement than the best plain one, and uses the tool when it does, down to its last token.
import { chooseStep } from './common.js';
import { patternOf } from '../rules.js';
import { placementScore } from './standard.js';

export default {
  id: 'tool-user',
  name: 'Tool user',
  description: 'Takes the hardest window for the most favour tokens, then spends them on tools whenever one improves the placement even a little: lathe, mirror, exchange and free pane.',
  weight: 1.5,
  chooseWindow(options, rng) {
    return options.reduce((best, pid) => {
      const score = patternOf(pid).difficulty + rng() * 0.5;
      return !best || score > best.score ? { pid, score } : best;
    }, null).pid;
  },
  chooseStep(state, seat, rng) {
    return chooseStep(state, seat, rng, {
      tools: 'eager',
      tokenValue: 0.7,
      margin: 0.5,
      reserve: 0,
      freePane: true,
      exchange: true,
      noise: 0,
      score: (s, who, die, cell, options) => placementScore(s, who, die, cell, options, rng),
    });
  },
};
