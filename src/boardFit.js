// How big to show a drawing board (src/components/DrawingBoard.vue) in the room a table has for it.  The board's own
// space is fixed (shared/drawing.js), so every game that draws fits the same shape into a different box.
// Depends on: shared/drawing.js (the board's own size).
import { BOARD } from '../shared/drawing.js';

/**
 * The largest board of the right shape that fits in a box.
 * @param {number} width  the room across, in pixels
 * @param {number} height  the room down, in pixels
 * @returns {{ width: number, height: number }} the size to show the canvas at, in whole pixels (never negative)
 * Side effects: none.
 */
export function fitBoard(width, height) {
  const byWidth = Math.floor((width * BOARD.height) / BOARD.width);
  if (byWidth <= height) return { width: Math.max(0, Math.floor(width)), height: Math.max(0, byWidth) };
  return { width: Math.max(0, Math.floor((height * BOARD.width) / BOARD.height)), height: Math.max(0, Math.floor(height)) };
}
