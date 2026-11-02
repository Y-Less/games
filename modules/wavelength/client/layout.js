// Sizes for the Wavelength table, worked out from the room available (never from the game, so nothing moves while
// playing).  All numbers are pixels.
import { VIEW } from './dial.js';

// The thresholds and fixed heights below drive dialSpan, dialWidth, and dialLayout.
export const NARROW = 640; // below this the dial takes the whole width and the clue panel goes under it
const BELOW_DIAL = 118; // the two ends and the slider under the dial, and the gaps between them
const PANEL = 170; // the height the clue panel needs when it goes under the dial

/**
 * How many of the 12 frame columns the dial takes: the left 8, or all 12 on a narrow screen (see NARROW).
 *
 * @param {{width: number, columns: number}} area  the frame's slot area
 * @returns {number} the column span
 *
 * Side effects: none.
 */
export const dialSpan = (area) => (area.width < NARROW ? area.columns : 8);

/**
 * The width of the dial: as wide as its column allows, unless the height of the room says it would not fit.
 *
 * @param {number} columnWidth  the width of the dial's column in px
 * @param {number} height  the height of the area in px
 * @param {boolean} [stacked]  true when the clue panel goes under the dial and so takes some of the height
 * @returns {number} the width in px, never below 180
 *
 * Side effects: none.
 */
export function dialWidth(columnWidth, height, stacked = false) {
  const room = height - BELOW_DIAL - (stacked ? PANEL : 0);
  const byHeight = Math.floor((room * VIEW.width) / VIEW.height);
  return Math.max(180, Math.min(columnWidth, byHeight));
}

/**
 * How the slim bars share the frame's 12 columns: each bar spans this many of them.
 *
 * @param {number} count  how many bars there are
 * @returns {number} 3 columns each for up to four bars, otherwise 2
 *
 * Side effects: none.
 */
export const barSpan = (count) => (count <= 4 ? 3 : 2);

/**
 * Where the dial goes in the area the frame gives the table: how many columns it spans and how wide it is drawn.
 *
 * @param {object} area  the frame's slot area ({ width, height, gap, columns })
 * @returns {{ span: number, width: number }} the dial's column span and its width in px
 *
 * Side effects: none.
 */
export function dialLayout(area) {
  const span = dialSpan(area);
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  const colWidth = Math.round(unit * span + area.gap * (span - 1));
  return { span, width: dialWidth(colWidth, area.height, span === area.columns) };
}
