// Sizes for the Wavelength table, worked out from the room available (never from the game, so nothing moves while
// playing). All numbers are pixels.
import { VIEW } from './dial.js';

export const NARROW = 640; // below this the dial takes the whole width and the clue panel goes under it
export const BELOW_DIAL = 96; // the two ends and the slider under the dial, and the gaps between them
export const PANEL = 170; // the height the clue panel needs when it goes under the dial

/** How many of the 12 frame columns the dial takes: the left 8, or all 12 on a narrow screen (see NARROW). */
export const dialSpan = (area) => (area.width < NARROW ? area.columns : 8);

/** The width of the dial: as wide as its column allows, unless the height of the room says it would not fit. */
export function dialWidth(columnWidth, height, stacked = false) {
  const room = height - BELOW_DIAL - (stacked ? PANEL : 0);
  const byHeight = Math.floor((room * VIEW.width) / VIEW.height);
  return Math.max(180, Math.min(columnWidth, byHeight));
}

/** How the slim bars share the frame's 12 columns: each bar spans this many of them. */
export const barSpan = (count) => (count <= 4 ? 3 : 2);
