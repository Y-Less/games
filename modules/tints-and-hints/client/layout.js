// Sizes for the Tints and Hints table, worked out from the room available (never from the game, so nothing moves while
// playing).  All numbers are pixels.
import { COLS, ROWS } from '../grid.js';

// Pixel measurements shared by the grid (Board.vue) and the table's fitting code.
export const HEAD = 18; // the width of the row labels and the height of the column labels
export const GAP = 1; // between squares

/**
 * The side of one square so that the whole grid (labels included) fits in `width` x `height`.
 * @param {number} width  room available across, in pixels (may be Infinity to fit by height alone)
 * @param {number} height  room available down, in pixels
 * @param {{min?: number, max?: number}} [limits]  smallest and largest allowed square side, in pixels
 * @returns {number} whole-pixel side of one square, clamped to the limits
 * Side effects: none.
 */
export function gridCell(width, height, { min = 6, max = 45 } = {}) {
  const across = (width - HEAD - GAP * COLS.length) / COLS.length;
  const down = (height - HEAD - GAP * ROWS.length) / ROWS.length;
  return Math.max(min, Math.min(max, Math.floor(Math.min(across, down))));
}

/**
 * The pixel size the grid takes with this square.
 * @param {number} cell  side of one square in pixels
 * @returns {{width: number, height: number}} total grid size including the labels and gaps
 * Side effects: none.
 */
export const gridSize = (cell) => ({ width: HEAD + COLS.length * (cell + GAP), height: HEAD + ROWS.length * (cell + GAP) });

/**
 * How many of the 12 frame columns the grid should take: the fewest (from `min` to `max`) that let it be as big as the
 * height allows, so the controls beside it get the rest. `area` is what GameFrame gives the main slot.
 * @param {{width: number, height: number, gap: number, columns: number}} area  the main slot's measurements
 * @param {{min?: number, max?: number}} [limits]  fewest and most columns the grid may span
 * @returns {number} the number of frame columns to span
 * Side effects: none.
 */
export function gridSpan(area, { min = 7, max = 10 } = {}) {
  const wanted = gridSize(gridCell(Infinity, area.height, { max: 200 })).width;
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  for (let span = min; span <= max; span++) if (unit * span + area.gap * (span - 1) >= wanted) return span;
  return max;
}

/**
 * How the slim bars share the frame's 12 columns: each bar spans this many of them.
 * @param {number} count  number of bars (other players)
 * @returns {number} columns each bar spans (3 for up to four bars, otherwise 2)
 * Side effects: none.
 */
export const barSpan = (count) => (count <= 4 ? 3 : 2);
