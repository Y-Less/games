// "Greedy": only the points on offer right now.  A move that completes a line is worth the wall score of its tile, less
// the floor; a move that does not is worth almost nothing.  It never plans for bonuses and never blocks anyone.
// Depends on: ../rules.js (tile scores) and ./common.js (take previews and column choosing).
import { tileScore } from '../rules.js';
import { bestColumnBy, chooseColumnBy, takeOf } from './common.js';

export default {
  id: 'greedy',
  name: 'Greedy',
  description: 'Takes whatever scores the most wall points straight away, and avoids the floor. No plans beyond the current round.',
  weight: 2,
  /**
   * Picks the move with the highest value by this AI's measure (see the file header), with a little noise.
   *
   * @param {object} state  the AI snapshot
   * @param {number} seat   the seat moving
   * @param {object[]} moves  the legal { source, colour, line } moves
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {{ source: 'centre' | number, colour: number, line: number | 'floor' } | null} null when there is no move
   *
   * Side effects: none, apart from drawing from `rng`.
   */
  chooseMove(state, seat, moves, rng) {
    let best = null;
    const free = state.settings.freeWall;
    for (const move of moves) {
      const { preview } = takeOf(state, seat, move);
      // Only what happens this turn matters: the floor it costs now, and the wall points if a line is finished now.
      let value = -preview.extraPenalty;
      if (move.line !== 'floor') {
        // A completed line is worth the wall score of its tile (best column) and 0.5 for finishing.  A line that is not completed
        // is worth almost nothing (0.1 per tile placed): greedy does not value progress, which is its weakness.
        if (preview.completes) {
          const target = bestColumnBy(state.walls[seat], move.line, move.colour, free, rng, (wall, col) => tileScore(wall, move.line, col));
          value += target.value + 0.5;
        } else value += 0.1 * preview.put;
      }
      // A smaller noise than the others (0.1): greedy is meant to be the most predictable of the scoring AIs.
      value += rng() * 0.1;
      if (!best || value > best.value) best = { source: move.source, colour: move.colour, line: move.line, value };
    }
    return best ? { source: best.source, colour: best.colour, line: best.line } : null;
  },
  /**
   * Picks the column where the tile scores most on the wall.
   *
   * @param {object} state  the AI snapshot
   * @param {number} seat   the seat choosing
   * @param {{ row: number, colour: number, columns: number[] }} pending  the choice to make
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {number} the chosen column
   *
   * Side effects: none, apart from drawing from `rng`.
   */
  chooseColumn: (state, seat, pending, rng) => chooseColumnBy(state, seat, pending, rng, (wall, col) => tileScore(wall, pending.row, col)),
};
