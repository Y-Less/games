// Arithmetic on the standard screen's grid (src/components/GameFrame.vue): the frame gives its `main` and `others`
// slots an area of { width, height, gap, columns }, and every table that shares that grid out asks the same few
// questions of it.  All numbers are pixels, and none of them depends on the game, so nothing moves while playing.
// Depends on: nothing.

/**
 * The width of `n` of the frame's columns, with the gaps between them.
 * @param {{ width: number, gap: number, columns: number }} area  the slot's measurements, as the frame passes them
 * @param {number} n  how many columns
 * @returns {number} the width in pixels, not rounded
 * Side effects: none.
 */
export function spanWidth(area, n) {
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  return unit * n + area.gap * (n - 1);
}

/**
 * The fewest of the frame's columns, between `min` and `max`, that are at least `wanted` pixels wide: for the big
 * piece of a table (a board, a grid) that should be as large as the height allows and leave the rest to what sits
 * beside it.
 * @param {{ width: number, gap: number, columns: number }} area  the slot's measurements
 * @param {number} wanted  the width the piece would like, in pixels
 * @param {number} min  the fewest columns it may have
 * @param {number} max  the most, which is also the answer when no span is wide enough
 * @returns {number} how many columns to span
 * Side effects: none.
 */
export function fewestSpan(area, wanted, min, max) {
  for (let span = min; span <= max; span++) if (spanWidth(area, span) >= wanted) return span;
  return max;
}

/**
 * How the slim bars for the other players share the frame's 12 columns: each bar spans this many of them.
 * @param {number} count  how many bars there are
 * @returns {number} 3 columns each for up to four bars, otherwise 2
 * Side effects: none.
 */
export const barSpan = (count) => (count <= 4 ? 3 : 2);
