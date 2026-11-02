// Sizes for the Dixnt table, worked out from the room available (never from the game's progress, so nothing moves
// while playing).  All numbers are pixels.
// Shared by Arena.vue and the components under it: pure sizing helpers for cards on the table and in the hand.
export const ASPECT = 640 / 936; // a card's width over its height
export const CAPTION = 32; // the fixed room under each card on the table: one line with the player's name and the vote button or vote count
export const CONTROLS = 38; // the fixed-height zone for the word entry, the next-round button, and the host's buttons
export const GAP = 8; // the space between the three zones of the arena (table, controls, hand)

/**
 * Finds the biggest card for `count` cards on the table, in 1 to 3 rows, inside `width` x `height` (each card also needs
 * CAPTION under it).  Every row count is tried because the best grid depends on the shape of the room.
 * @param {number} count  How many cards the table is sized for (at least 1 is assumed).
 * @param {number} width  Available width in pixels.
 * @param {number} height  Available height in pixels.
 * @param {{gap?: number, max?: number}} [options]  Space between cards (default 12) and the largest card width (default 300), in pixels.
 * @returns {{width: number, height: number, columns: number, rows: number}} Card size in pixels and the grid it implies.
 * Side effects: none.
 */
export function fitCards(count, width, height, { gap = 12, max = 300 } = {}) {
  const n = Math.max(1, count);
  let best = { width: 0, height: 0, columns: n, rows: 1 };
  for (let rows = 1; rows <= 3 && rows <= n; rows++) {
    const columns = Math.ceil(n / rows); // the last row may be part-empty
    const byWidth = (width - gap * (columns - 1)) / columns;
    const byHeight = ((height - gap * (rows - 1)) / rows - CAPTION) * ASPECT;
    const w = Math.floor(Math.min(byWidth, byHeight, max));
    if (w > best.width) best = { width: w, height: Math.round(w / ASPECT), columns, rows };
  }
  return best;
}

/**
 * Sizes a card in your hand: a share of the main area's height, and small enough for `slots` cards to fit side by side.
 * @param {number} width  Available width in pixels.
 * @param {number} height  Available height of the whole main area in pixels.
 * @param {number} slots  How many cards the hand must be able to hold at once.
 * @param {{gap?: number, share?: number, min?: number, max?: number}} [options]  Gap between cards (10), share of the height (0.42), and the smallest (90) and largest (300) height before the width limit applies.
 * @returns {{height: number, width: number}} Card size in pixels (never below 48 high).
 * Side effects: none.
 */
export function handCard(width, height, slots, { gap = 10, share = 0.42, min = 90, max = 300 } = {}) {
  const byHeight = Math.min(max, Math.max(min, Math.round(height * share)));
  const byWidth = Math.floor((width - gap * (slots - 1)) / slots / ASPECT);
  const h = Math.max(48, Math.min(byHeight, byWidth));
  return { height: h, width: Math.round(h * ASPECT) };
}

/**
 * How the slim bars share the frame's 12 columns: each bar spans this many of them.
 * @param {number} count  How many bars there are.
 * @returns {number} 3 columns each for up to four bars, otherwise 2.
 * Side effects: none.
 */
export const barSpan = (count) => (count <= 4 ? 3 : 2);
