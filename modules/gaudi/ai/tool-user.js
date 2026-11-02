// "Tool user": spends its favour tokens freely.  It takes the hardest window (the most tokens), and each turn it checks
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
      // The hardest window carries the most restrictions and so the most favour tokens; little noise as it wants that.
      const score = patternOf(pid).difficulty + rng() * 0.5;
      return !best || score > best.score ? { pid, score } : best;
    }, null).pid;
  },
  /**
   * Decides one step of this computer player's turn: place a die, use a tool, or end the turn.  Changes nothing.
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
      // Tokens are cheap to this AI (low tokenValue, tiny margin, no reserve) so it uses a tool for any gain at all.
      tools: 'eager',
      tokenValue: 0.7,
      margin: 0.5,
      reserve: 0,
      freePane: true,
      exchange: true,
      noise: 0,
      /**
       * How good it is to put `die` on `cell` for this AI: higher is better.  Its own measure of a placement; see the
       * file header for what it values.
       *
       * @param {object} s     the snapshot
       * @param {number} who   the seat deciding
       * @param {object} die   { id, c, v } (as it would be after a tool, if one is being considered)
       * @param {number} cell  the space
       * @returns {number} the placement's value; only the ordering between candidates matters
       *
       * Side effects: none (other than advancing rng, which standard's placementScore uses for jitter).
       */
      // Reuses Standard's scoring unchanged: this AI's difference is how freely it spends tokens, not how it values a placement.
      score: (s, who, die, cell, options) => placementScore(s, who, die, cell, options, rng),
    });
  },
};
