// Sizes for the Dixnt table, worked out from the room available (never from the game's progress, so nothing moves
// while playing). All numbers are pixels.
export const ASPECT = 640 / 936; // a card's width over its height
export const CAPTION = 32; // the fixed room under each card on the table: one line with the player's name and the vote button or vote count
export const CONTROLS = 38; // the fixed-height zone for the word entry, the next-round button and the host's buttons
export const GAP = 8;

/**
 * The biggest card for `count` cards on the table, in 1 to 3 rows, inside `width` x `height` (each card also needs
 * CAPTION under it). Returns { width, height, columns, rows }.
 */
export function fitCards(count, width, height, { gap = 12, max = 300 } = {}) {
  const n = Math.max(1, count);
  let best = { width: 0, height: 0, columns: n, rows: 1 };
  for (let rows = 1; rows <= 3 && rows <= n; rows++) {
    const columns = Math.ceil(n / rows);
    const byWidth = (width - gap * (columns - 1)) / columns;
    const byHeight = ((height - gap * (rows - 1)) / rows - CAPTION) * ASPECT;
    const w = Math.floor(Math.min(byWidth, byHeight, max));
    if (w > best.width) best = { width: w, height: Math.round(w / ASPECT), columns, rows };
  }
  return best;
}

/** The height of a card in your hand: a share of the main area, and small enough for `slots` cards to fit side by side. */
export function handCard(width, height, slots, { gap = 10, share = 0.42, min = 90, max = 300 } = {}) {
  const byHeight = Math.min(max, Math.max(min, Math.round(height * share)));
  const byWidth = Math.floor((width - gap * (slots - 1)) / slots / ASPECT);
  const h = Math.max(48, Math.min(byHeight, byWidth));
  return { height: h, width: Math.round(h * ASPECT) };
}

/** How the slim bars share the frame's 12 columns: each bar spans this many of them. */
export const barSpan = (count) => (count <= 4 ? 3 : 2);
