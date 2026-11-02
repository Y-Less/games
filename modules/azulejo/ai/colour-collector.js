// "Colour collector": chases the end-of-game bonuses rather than the quick points: all five tiles of a colour (10), and
// full columns (7).  It feeds the colours it already has most of and prefers the columns that are fullest.
// Depends on: ../rules.js (scoring and line sizes) and ./common.js (take previews and column choosing).
import { SIZE, lineCapacity, tileScore } from '../rules.js';
import { bestColumnBy, chooseColumnBy, colFill, setFill, takeOf } from './common.js';

/**
 * How much a tile at (row, col) of this wall is worth to a colour collector: a little for its score, more for each tile
 * of the colour and of the column already there, with the big bonuses when a set or column is completed.
 *
 * @param {(number | null)[][]} wall  the wall with the tile already placed
 * @param {number} row
 * @param {number} col
 * @param {number} colour
 * @returns {number}
 *
 * Side effects: none.
 */
const bonusValue = (wall, row, col, colour) => {
  const sets = setFill(wall, colour);
  const cols = colFill(wall, col);
  // Weights: the tile score counts for only 0.4 so it never outweighs the bonuses; each tile already in the colour set (1.3)
  // or column (1.0) is a step towards a prize, and completing one adds the full 10 or 7, so the last tile of a set is
  // worth far more than the first.
  return 0.4 * tileScore(wall, row, col) + 1.3 * sets + (sets === SIZE ? 10 : 0) + 1.0 * cols + (cols === SIZE ? 7 : 0);
};

export default {
  id: 'colour-collector',
  name: 'Colour collector',
  description: 'Builds towards colour sets and full columns for the end-of-game bonuses, even at the cost of slower points.',
  weight: 1.5,
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
    const free = state.settings.freeWall;
    const wall = state.walls[seat];
    let best = null;
    for (const move of moves) {
      const { preview } = takeOf(state, seat, move);
      // The floor is charged at full price: a long-game plan cannot afford to bleed points.
      let value = -preview.extraPenalty;
      if (move.line !== 'floor') {
        const after = state.lines[seat][move.line].count + preview.put;
        const cap = lineCapacity(move.line);
        const target = bestColumnBy(wall, move.line, move.colour, free, rng, (next, col) => bonusValue(next, move.line, col, move.colour));
        // A finished line banks the whole bonus value of its tile (plus 0.4 for finishing); a part-built line gets 60% of it,
        // scaled by progress, because it may not be finished this round, plus a little credit for each tile that fits.
        value += after === cap ? target.value + 0.4 : target.value * (after / cap) * 0.6 + 0.1 * preview.put;
      }
      // Noise so equal moves are not always resolved the same way.
      value += rng() * 0.15;
      if (!best || value > best.value) best = { source: move.source, colour: move.colour, line: move.line, value };
    }
    return best ? { source: best.source, colour: best.colour, line: best.line } : null;
  },
  /**
   * Picks the column that does most for the colour-set and column bonuses.
   *
   * @param {object} state  the AI snapshot
   * @param {number} seat   the seat choosing
   * @param {{ row: number, colour: number, columns: number[] }} pending  the choice to make
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {number} the chosen column
   *
   * Side effects: none, apart from drawing from `rng`.
   */
  chooseColumn: (state, seat, pending, rng) => chooseColumnBy(state, seat, pending, rng, (wall, col) => bonusValue(wall, pending.row, col, pending.colour)),
};
