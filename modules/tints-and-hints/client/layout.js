// Sizes for the Tints and Hints table, worked out from the room available (never from the game, so nothing moves while
// playing). All numbers are pixels.
import { COLS, ROWS } from '../grid.js';

export const HEAD = 18; // the width of the row labels and the height of the column labels
export const GAP = 1; // between squares

/** The side of one square so that the whole grid (labels included) fits in `width` x `height`. */
export function gridCell(width, height, { min = 14, max = 90 } = {}) {
  const across = (width - HEAD - GAP * COLS.length) / COLS.length;
  const down = (height - HEAD - GAP * ROWS.length) / ROWS.length;
  return Math.max(min, Math.min(max, Math.floor(Math.min(across, down))));
}

/** The pixel size the grid takes with this square. */
export const gridSize = (cell) => ({ width: HEAD + COLS.length * (cell + GAP), height: HEAD + ROWS.length * (cell + GAP) });

/**
 * How many of the 12 frame columns the grid should take: the fewest (from `min` to `max`) that let it be as big as the
 * height allows, so the controls beside it get the rest. `area` is what GameFrame gives the main slot.
 */
export function gridSpan(area, { min = 7, max = 9 } = {}) {
  const wanted = gridSize(gridCell(Infinity, area.height, { max: 200 })).width;
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  for (let span = min; span <= max; span++) if (unit * span + area.gap * (span - 1) >= wanted) return span;
  return max;
}

/** How the slim bars share the frame's 12 columns: each bar spans this many of them. */
export const barSpan = (count) => (count <= 4 ? 3 : 2);
