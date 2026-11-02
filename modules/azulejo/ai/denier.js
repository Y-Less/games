// "Denier": plays against the table.  It values tiles an opponent needs to finish a pattern line (and so score on the
// wall): taking the last of a colour they are building leaves them to overflow on to their floor.  Its own board comes
// second, but it will not drop tiles on the floor for nothing.
// Depends on: ../rules.js (line sizes and tile scores) and ./common.js (take previews, tile counts, column choosing).
import { lineCapacity, tileScore } from '../rules.js';
import { bestColumnBy, chooseColumnBy, takeOf, tilesLeft } from './common.js';

/**
 * How much taking `count` tiles of a colour from a source hurts the other players' unfinished lines.
 *
 * @param {object} state  the AI snapshot
 * @param {number} seat   the seat taking (its own lines do not count)
 * @param {{ source: 'centre' | number, colour: number }} move
 * @param {number} count  how many tiles the move takes
 * @returns {number} higher means more harm done to the opponents
 *
 * Side effects: none.
 */
function denial(state, seat, move, count) {
  // How many of this colour will still be on the table once this move is made: opponents can only finish from those.
  const left = tilesLeft(state, move.colour, move.source);
  let hurt = 0;
  state.lines.forEach((lines, other) => {
    if (other === seat) return;
    lines.forEach((l, i) => {
      if (l.colour !== move.colour || l.count >= lineCapacity(i)) return;
      const need = lineCapacity(i) - l.count;
      const progress = (l.count + 1) / lineCapacity(i);
      // Taking so much that `left` cannot cover what they need strands their line for the round (its tiles go to the floor
      // or sit idle), which is the real damage, so it is priced high and more so for lines that are nearly built.
      if (left < need) hurt += progress * (1.5 + need); // they can no longer finish this round
      // Otherwise the harm is only that they have fewer tiles to choose from: a small share of what they could have used.
      else hurt += 0.3 * Math.min(need, count) * progress;
    });
  });
  return hurt;
}

export default {
  id: 'denier',
  name: 'Denier',
  description: 'Takes the tiles its opponents are waiting for, so their lines go unfinished and their leftovers fall on the floor.',
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
      const { count, preview } = takeOf(state, seat, move);
      // Its own floor is discounted to 0.8 (it will take a little floor to hurt somebody) while denial is boosted by 1.4,
      // so a strong block can beat a tidy move for itself.
      let value = -0.8 * preview.extraPenalty + 1.4 * denial(state, seat, move, count);
      if (move.line !== 'floor') {
        const after = state.lines[seat][move.line].count + preview.put;
        const cap = lineCapacity(move.line);
        const target = bestColumnBy(wall, move.line, move.colour, free, rng, (next, col) => tileScore(next, move.line, col));
        // Its own board still counts, but at a lower weight than for a self-interested AI: 0.6 of the wall score when a line
        // is finished, only 0.25 (scaled by progress) when it is not.
        value += after === cap ? 0.6 * target.value + 0.5 : 0.25 * target.value * (after / cap) + 0.1 * preview.put;
      }
      // Noise so equal moves are not always resolved the same way.
      value += rng() * 0.15;
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
