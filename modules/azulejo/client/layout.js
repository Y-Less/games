// Sizes for the Azulejo table, worked out from the room available (never from the game, so nothing moves while
// playing). All numbers are pixels. The constants are the parts of a board that do not scale with its tile size.
const BOARD_FIXED_W = 52; // padding, borders and the gaps between slots
const BOARD_FIXED_H = 112; // header, floor line, padding and gaps
const BOARD_W_PER_CELL = 10.4; // five pattern slots, a gap, and five wall spots
const BOARD_H_PER_CELL = 5.7;

/**
 * Works out the tile cell size for a player board that must fit inside a given box. Sizing from the room (not the game)
 * keeps the table from jumping about while playing.
 * @param {number} width  Available width in pixels.
 * @param {number} height  Available height in pixels.
 * @param {{min?: number, max?: number}} [limits]  Smallest and largest cell allowed, in pixels (default 22 and 80).
 * @returns {number} Whole-pixel cell size, clamped to `min`..`max`; the limiting axis (width or height) decides.
 * Side effects: none.
 */
export function boardCell(width, height, { min = 22, max = 80 } = {}) {
  const fit = Math.floor(Math.min((width - BOARD_FIXED_W) / BOARD_W_PER_CELL, (height - BOARD_FIXED_H) / BOARD_H_PER_CELL));
  return Math.max(min, Math.min(max, fit));
}

/**
 * Inverse of `boardCell`: the box a board takes at a given cell size (rounded up so it never clips).
 * @param {number} cell  Tile cell size in pixels.
 * @returns {{width: number, height: number}} Board size in pixels.
 * Side effects: none.
 */
export const boardSize = (cell) => ({ width: Math.ceil(cell * BOARD_W_PER_CELL + BOARD_FIXED_W), height: Math.ceil(cell * BOARD_H_PER_CELL + BOARD_FIXED_H) });

/**
 * Finds the biggest plate diameter such that `count` round plates, `gap` apart, fit in `width` x `height` in rows and
 * columns of the best shape. Every column count is tried because the best grid depends on the aspect ratio of the box.
 * @param {number} count  Number of display plates to fit.
 * @param {number} width  Available width in pixels.
 * @param {number} height  Available height in pixels.
 * @param {{gap?: number, max?: number}} [options]  Space between plates (default 10) and largest diameter (default 150), in pixels.
 * @returns {{diameter: number, columns: number}} Whole-pixel plate diameter and the number of columns to lay them out in.
 * Side effects: none.
 */
export function plateLayout(count, width, height, { gap = 10, max = 150 } = {}) {
  let best = { diameter: 0, columns: 1 };
  for (let columns = 1; columns <= Math.max(1, count); columns++) {
    const rows = Math.ceil(count / columns); // the last row may be part-empty
    const diameter = Math.min((width - gap * (columns - 1)) / columns, (height - gap * (rows - 1)) / rows, max);
    if (diameter > best.diameter) best = { diameter: Math.floor(diameter), columns };
  }
  return best;
}
