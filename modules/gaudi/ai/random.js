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
    if (state.turn.placements >= 1) return { type: 'end' };
    const options = placementsOf(state, seat);
    if (!options.length) return { type: 'end' };
    const { die, cell } = pickOne(options, rng);
    return { type: 'place', die, cell };
  },
};
