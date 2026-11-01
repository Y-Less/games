// Sizes for the Gaudi table, worked out from the room the frame gives it (never from the game, so nothing moves while
// playing). All numbers are pixels. The constants are the parts of a window that do not scale with its space size.
import { COLS, ROWS } from '../rules.js';

const WINDOW_FIXED = 26; // padding, border and the gaps between the spaces of a row
const WINDOW_FIXED_H = 23; // the same, down the rows
const HEAD = 24; // the line above your window
/**
 * Keeps a number between a lowest and a highest value (the lowest wins if they cross, because max is applied last).
 * @param {number} low  the smallest result
 * @param {number} value  the number to limit
 * @param {number} high  the largest result
 * @returns {number} value limited to the range
 * Side effects: none.
 */
const clamp = (low, value, high) => Math.max(low, Math.min(high, value));

/**
 * The pixel width of `n` of the frame's 12 columns, including the gaps between them (used to size the finished-game column).
 * @param {{ width: number, gap: number, columns: number }} area  the main area given by the frame
 * @param {number} n  how many columns to span
 * @returns {number} the width in pixels, rounded
 * Side effects: none.
 */
export const spanWidth = (area, n) => {
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  return Math.round(unit * n + area.gap * (n - 1));
};

/**
 * The window size (px per space) for a window that must fit `width` x `height`: whichever of the two limits is tighter wins,
 * so the whole window always fits.
 * @param {number} width  the room across, in pixels
 * @param {number} height  the room down, in pixels
 * @param {{ min?: number, max?: number }} [limits]  the smallest and largest space size allowed
 * @returns {number} the size of one space in pixels, a whole number
 * Side effects: none.
 */
export const windowCell = (width, height, { min = 24, max = 140 } = {}) =>
  clamp(min, Math.floor(Math.min((width - WINDOW_FIXED) / COLS, (height - WINDOW_FIXED_H) / ROWS)), max);

/**
 * Everything the table needs, from the main area ({ width, height, left, columns, gap, mainSpan }):
 *   cell       a space of your own window
 *   die        a die in the pool, perRow the dice in a row, poolHeight the room kept for the rows the biggest pool needs
 *   trackDie   a die on the round track
 *   option     a space in the windows offered at the start
 *   popup      a space in another player's window, shown over the table
 *
 * @param {object} area  the main area given by the frame ({ width, height, left, columns, gap, mainSpan })
 * @param {{ poolMax?: number, finished?: boolean, options?: number }} [opts]  the biggest pool there can be (so its room is
 *   fixed), whether the game is over (your window then gets a narrower column) and how many windows are offered at the start
 * @returns {{ cell: number, die: number, perRow: number, poolHeight: number, trackDie: number, option: number, popup: number }} sizes in pixels
 * Side effects: none.
 */
export function tableSizes(area, { poolMax = 11, finished = false, options = 4 } = {}) {
  const mineWidth = finished ? spanWidth(area, 4) : area.left;
  const cell = windowCell(Math.min(mineWidth - 24, area.left * 0.54), area.height - HEAD - 16);
  const die = clamp(32, Math.round(cell * 0.72), 80);
  const poolWidth = area.left - 24 - (cell * 5 + WINDOW_FIXED) - 12;
  const perRow = Math.max(3, Math.floor((poolWidth + 6) / (die + 10 + 6)));
  const poolHeight = Math.ceil(poolMax / perRow) * (die + 10) + (Math.ceil(poolMax / perRow) - 1) * 4;
  const optionWidth = (area.width - 16 * (options - 1)) / options - 26;
  const option = clamp(24, Math.floor(Math.min((area.height - 235 - WINDOW_FIXED_H) / ROWS, (optionWidth - WINDOW_FIXED) / COLS)), 56);
  const popup = clamp(22, Math.floor((area.height * 0.93 - 96 - WINDOW_FIXED_H) / ROWS), 60);
  return { cell, die, perRow, poolHeight, trackDie: 20, option, popup };
}
