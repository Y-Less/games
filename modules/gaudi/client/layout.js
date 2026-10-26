// Sizes for the Gaudi table, worked out from the room the frame gives it (never from the game, so nothing moves while
// playing). All numbers are pixels. The constants are the parts of a window that do not scale with its space size.
const WINDOW_FIXED = 26; // padding, border and the gaps between five spaces
const WINDOW_FIXED_H = 23; // the same, down four rows
const HEAD = 24; // the line above your window
const clamp = (low, value, high) => Math.max(low, Math.min(high, value));

/** The pixel width of `n` of the frame's 12 columns. */
export const spanWidth = (area, n) => {
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  return Math.round(unit * n + area.gap * (n - 1));
};

/** The window size (px) for a window that must fit `width` x `height`. */
export const windowCell = (width, height, { min = 24, max = 140 } = {}) =>
  clamp(min, Math.floor(Math.min((width - WINDOW_FIXED) / 5, (height - WINDOW_FIXED_H) / 4)), max);

/**
 * Everything the table needs, from the main area ({ width, height, left, columns, gap, mainSpan }):
 *   cell       a space of your own window
 *   die        a die in the pool, perRow the dice in a row, poolHeight the room kept for the rows the biggest pool needs
 *   trackDie   a die on the round track
 *   option     a space in the windows offered at the start
 *   popup      a space in another player's window, shown over the table
 */
export function tableSizes(area, { poolMax = 11, finished = false, options = 4 } = {}) {
  const mineWidth = finished ? spanWidth(area, 4) : area.left;
  const cell = windowCell(Math.min(mineWidth - 24, area.left * 0.54), area.height - HEAD - 16);
  const die = clamp(32, Math.round(cell * 0.72), 80);
  const poolWidth = area.left - 24 - (cell * 5 + WINDOW_FIXED) - 12;
  const perRow = Math.max(3, Math.floor((poolWidth + 6) / (die + 10 + 6)));
  const poolHeight = Math.ceil(poolMax / perRow) * (die + 10) + (Math.ceil(poolMax / perRow) - 1) * 4;
  const optionWidth = (area.width - 16 * (options - 1)) / options - 26;
  const option = clamp(24, Math.floor(Math.min((area.height - 120 - WINDOW_FIXED_H) / 4, (optionWidth - WINDOW_FIXED) / 5)), 56);
  const popup = clamp(22, Math.floor((area.height * 0.93 - 96 - WINDOW_FIXED_H) / 4), 60);
  return { cell, die, perRow, poolHeight, trackDie: 20, option, popup };
}
