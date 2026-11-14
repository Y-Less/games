// Sizes for the Wavelength table, worked out from the room available (never from the game, so nothing moves while
// playing).  All numbers are pixels.
import { barSpan, spanWidth } from '../../../src/frameLayout.js';
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

// How the slim bars share the frame's columns is the same in every game that has them (src/frameLayout.js).
export { barSpan };

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
  const colWidth = Math.round(spanWidth(area, span));
  return { span, width: dialWidth(colWidth, area.height, span === area.columns) };
}
