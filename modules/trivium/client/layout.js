// Where everything on the Trivium board goes, worked out from the room the frame gives the table and from nothing
// else, so that nothing moves while the game is played.  All numbers are pixels.
//
// The table measures itself rather than letting the browser lay it out because the markers have to travel: a marker
// starts on its player's name and ends on the exact spot of the exact button that player tapped, and both ends have
// to be a number the table can animate between.  Once the board knows where every button is, it knows where every
// finger landed.

/** The strip along the bottom that the players' names and their markers sit in. */
export const NAME_ROW = 76;
/** The gap between the parts of the board. */
export const GAP = 14;
/** How wide across a marker is drawn. */
export const MARKER = 16;
/** How tall the question's words may be, as a share of the board and within these bounds. */
const QUESTION = { share: 0.32, min: 64, max: 210 };
/** The smallest a button is allowed to get before the board simply overflows its slot. */
const MIN_BUTTON = { width: 90, height: 44 };

/**
 * Clamps a number into a range.
 *
 * @param {number} value  the number
 * @param {number} least  the smallest it may be
 * @param {number} most  the largest it may be
 * @returns {number}
 * Side effects: none.
 */
const within = (value, least, most) => Math.max(least, Math.min(most, value));

/**
 * How the answer buttons are arranged: two columns unless there are only two answers, which read better one above
 * the other than side by side.
 *
 * @param {number} count  how many answers the question has
 * @returns {{ columns: number, rows: number }}
 * Side effects: none.
 */
export const grid = (count) => {
  const columns = count <= 2 ? 1 : 2;
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
};

/**
 * Every rectangle of the board.
 *
 * @param {{ width: number, height: number }} area  the room the frame gives the table
 * @param {number} count  how many answers the question has (0 while the wheel is turning)
 * @param {number} players  how many players there are
 * @returns {{ width: number, height: number, stage: object, wheel: { x: number, y: number, size: number },
 *   question: object, buttons: object[], names: object, slot: number }} the board, in pixels
 * Side effects: none.
 */
export function boardLayout(area, count = 0, players = 1) {
  const width = Math.max(240, Math.floor(area?.width ?? 0) || 240);
  const height = Math.max(240, Math.floor(area?.height ?? 0) || 240);
  const stage = { x: 0, y: 0, width, height: Math.max(120, height - NAME_ROW - GAP) };
  const names = { x: 0, y: stage.height + GAP, width, height: NAME_ROW };

  const size = Math.max(140, Math.min(stage.width, stage.height) - GAP);
  const wheel = { x: (stage.width - size) / 2, y: (stage.height - size) / 2, size };

  const questionHeight = within(stage.height * QUESTION.share, QUESTION.min, QUESTION.max);
  const question = { x: 0, y: 0, width: stage.width, height: questionHeight };
  const { columns, rows } = grid(Math.max(1, count));
  const top = questionHeight + GAP;
  const cellWidth = Math.max(MIN_BUTTON.width, (stage.width - GAP * (columns - 1)) / columns);
  const cellHeight = Math.max(MIN_BUTTON.height, (stage.height - top - GAP * (rows - 1)) / rows);
  const buttons = Array.from({ length: count }, (unused, index) => ({
    x: (index % columns) * (cellWidth + GAP),
    y: top + Math.floor(index / columns) * (cellHeight + GAP),
    width: cellWidth,
    height: cellHeight,
  }));

  return { width, height, stage, wheel, question, buttons, names, slot: width / Math.max(1, players) };
}

/**
 * Where a player's marker waits before it has anywhere to go: over their own name.
 *
 * @param {object} board  from boardLayout
 * @param {number} index  the player's place in the name row
 * @returns {{ x: number, y: number }} the middle of the marker, in pixels from the board's top left
 * Side effects: none.
 */
export const homeOf = (board, index) => ({ x: board.names.x + (index + 0.5) * board.slot, y: board.names.y + MARKER });

/**
 * Where a player's marker ends up: the spot on the button their finger actually landed on.
 *
 * @param {object} board  from boardLayout
 * @param {{ choice: number, x: number, y: number }} given  the answer, with the tap as fractions of the button
 * @returns {{ x: number, y: number } | null} the middle of the marker, or null when that button is not on the board
 * Side effects: none.
 */
export function spotOf(board, given) {
  const button = board.buttons[given?.choice];
  if (!button) return null;
  return { x: button.x + button.width * given.x, y: button.y + button.height * given.y };
}
