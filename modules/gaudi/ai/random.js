// "Random": any legal placement of any pool die, chosen uniformly; never uses a tool; any window.
import { pickOne, placementsOf } from './common.js';

export default {
  id: 'random',
  name: 'Random',
  description: 'Places a random die on a random legal space, never uses a tool and picks its window at random.',
  weight: 0.5,
  /**
   * Chooses this computer player's window from the four it is offered.
   *
   * @param {string[]} options  pattern ids on offer
   * @param {() => number} rng  random source returning [0, 1); used for variety or tie-breaking
   * @returns {string} one of the options
   *
   * Side effects: none (other than advancing rng).
   */
  chooseWindow: (options, rng) => pickOne(options, rng),
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
    // One die per turn; stop once it is placed. (Random never uses a tool, so there is nothing else to try.)
    if (state.turn.placements >= 1) return { type: 'end' };
    const options = placementsOf(state, seat);
    if (!options.length) return { type: 'end' };
    const { die, cell } = pickOne(options, rng);
    return { type: 'place', die, cell };
  },
};
