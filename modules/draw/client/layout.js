// Sizes for the Draw! table, worked out from the room available and never from the game, so nothing moves while
// playing.  There are always two boards: a guesser sees them the same size side by side, and a drawer sees their own
// as big as it will go with the other one small beside it.
// All numbers are pixels unless they are said to be board units.
// Depends on: src/boardFit.js (the board's shape fitted into a box).
import { fitBoard as fit } from '../../../src/boardFit.js';

/** The gap between the two boards. */
export const GAP = 12;
/** How tall the line above the boards is (the word, or who is drawing what). */
const CAPTION = 26;
/** How tall the drawer's tools are, below their own board (the shared toolbox, which may wrap onto a second line). */
const TOOLBOX = 96;
/** The share of the width a drawer's own board takes; the other drawing gets the rest. */
const YOURS = 0.68;

/**
 * Where the two boards go, for whoever is looking.
 *
 * A guesser is choosing between the two drawings, so they are shown the same size: one of them being bigger would be
 * a thumb on the scale.  A drawer is working on one of them, so theirs is as large as the room allows and the other
 * is small beside it - they still want to see how the race is going.
 *
 * @param {{ width: number, height: number }} area  the room the frame gives the main part
 * @param {boolean} youDraw  whether this viewer is one of the two drawing
 * @returns {{ mine: { width: number, height: number }, theirs: { width: number, height: number } }} the two sizes
 *   (`mine` is the left-hand one for a guesser, who owns neither)
 * Side effects: none.
 */
export function boards(area, youDraw) {
  const width = Math.max(0, area.width);
  const height = Math.max(0, area.height - CAPTION - (youDraw ? TOOLBOX : 0));
  if (!youDraw) {
    const each = fit((width - GAP) / 2, height);
    return { mine: each, theirs: each };
  }
  const mine = fit((width - GAP) * YOURS, height);
  // The small one is never taller than the big one, so the two sit on the same line.
  const theirs = fit((width - GAP) * (1 - YOURS), Math.min(height, mine.height));
  return { mine, theirs };
}
