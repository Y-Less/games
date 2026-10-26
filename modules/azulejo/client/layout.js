// Sizes for the Azulejo table, worked out from the room available (never from the game, so nothing moves while
// playing). All numbers are pixels. The constants are the parts of a board that do not scale with its tile size.
const BOARD_FIXED_W = 52; // padding, borders and the gaps between slots
const BOARD_FIXED_H = 112; // header, floor line, padding and gaps
const BOARD_W_PER_CELL = 10.4; // five pattern slots, a gap, and five wall spots
const BOARD_H_PER_CELL = 5.7;

/** The tile cell for a board that must fit inside `width` x `height`, between `min` and `max`. */
export function boardCell(width, height, { min = 22, max = 80 } = {}) {
  const fit = Math.floor(Math.min((width - BOARD_FIXED_W) / BOARD_W_PER_CELL, (height - BOARD_FIXED_H) / BOARD_H_PER_CELL));
  return Math.max(min, Math.min(max, fit));
}

/** The pixel size a board with this cell takes. */
export const boardSize = (cell) => ({ width: Math.ceil(cell * BOARD_W_PER_CELL + BOARD_FIXED_W), height: Math.ceil(cell * BOARD_H_PER_CELL + BOARD_FIXED_H) });

/**
 * The biggest plate diameter such that `count` round plates, `gap` apart, fit in `width` x `height` in rows and columns
 * of the best shape. Returns { diameter, columns }.
 */
export function plateLayout(count, width, height, { gap = 10, max = 150 } = {}) {
  let best = { diameter: 0, columns: 1 };
  for (let columns = 1; columns <= Math.max(1, count); columns++) {
    const rows = Math.ceil(count / columns);
    const diameter = Math.min((width - gap * (columns - 1)) / columns, (height - gap * (rows - 1)) / rows, max);
    if (diameter > best.diameter) best = { diameter: Math.floor(diameter), columns };
  }
  return best;
}
