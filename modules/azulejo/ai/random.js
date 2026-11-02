// "Random": any legal move, chosen uniformly (including the floor), and any legal column.
// Depends on: ./common.js (pickOne).  It is the weakest AI and the baseline the others are measured against.
import { pickOne } from './common.js';

export default {
  id: 'random',
  name: 'Random',
  description: 'Picks any legal move at random. Never plans, never blocks, often fills its own floor.',
  weight: 0.5,
  /**
   * Any legal move, uniformly.
   *
   * @param {object} state  the AI snapshot (unused)
   * @param {number} seat   the seat moving (unused)
   * @param {object[]} moves  the legal moves
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {{ source: 'centre' | number, colour: number, line: number | 'floor' } | null} null when there is no move
   *
   * Side effects: none, apart from drawing once from `rng`.
   */
  chooseMove(state, seat, moves, rng) {
    if (!moves.length) return null;
    const { source, colour, line } = pickOne(moves, rng);
    return { source, colour, line };
  },
  /**
   * Any offered column, uniformly.
   *
   * @param {object} state  the AI snapshot
   * @param {number} seat   the seat choosing
   * @param {{ row: number, colour: number, columns: number[] }} pending  the choice to make
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {number} the chosen column
   *
   * Side effects: none, apart from drawing once from `rng`.
   */
  chooseColumn: (state, seat, pending, rng) => pickOne(pending.columns, rng),
};
