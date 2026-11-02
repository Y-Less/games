// Sizes for the Scribblers table, worked out from the room available (never from the game, so nothing moves while
// playing).  All numbers are pixels unless they are said to be board units.
// Depends on: nothing.

/** The drawing board's own coordinate space, which every instruction speaks (the same figures as drawing.js). */
export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;
/** How tall the word and the clock are above the board, and the toolbox below it (the board gets what is left). */
const WORD_BAR = 44;
const TOOLBOX = 96;

/**
 * How big to show the board so that it, the word above it, and the toolbox below it all fit the room available, keeping
 * the board's shape.
 *
 * @param {{ width: number, height: number }} area  the room the table has (GameFrame gives the main slot its size)
 * @param {number} across  how much of the width the board may use (the guess panel takes the rest)
 * @param {boolean} [withToolbox]  whether the toolbox is shown under it (only the drawer has one)
 * @returns {{ width: number, height: number }} the size to show the canvas at, in whole pixels
 * Side effects: none.
 */
export function boardSize(area, across, withToolbox = false) {
  const room = Math.max(120, Math.floor(area.height - WORD_BAR - (withToolbox ? TOOLBOX : 0)));
  const width = Math.max(120, Math.floor(across));
  const byWidth = Math.floor((width * BOARD_HEIGHT) / BOARD_WIDTH);
  if (byWidth <= room) return { width, height: byWidth };
  return { width: Math.floor((room * BOARD_WIDTH) / BOARD_HEIGHT), height: room };
}

/**
 * How many of the frame's 12 columns the board takes, leaving the rest for the guess panel: as many as it can use, so
 * that a wide window gives the board the space and a narrow one still leaves the panel something.
 *
 * @param {{ width: number, height: number, gap: number, columns: number }} area  the main slot's measurements
 * @param {boolean} [withToolbox]  whether the toolbox is shown under the board
 * @returns {number} the number of frame columns the board's side should span
 * Side effects: none.
 */
export function boardSpan(area, withToolbox = false) {
  const room = Math.max(120, area.height - WORD_BAR - (withToolbox ? TOOLBOX : 0));
  const wanted = (room * BOARD_WIDTH) / BOARD_HEIGHT; // the width the board would like, to be as tall as it may be
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  for (let span = 6; span <= 9; span++) if (unit * span + area.gap * (span - 1) >= wanted) return span;
  return 9;
}
