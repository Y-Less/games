// The colour grid, shared by the server (what counts as a close guess) and the client (drawing it).
// 48 columns by 20 rows. A square is a column name and a row number, such as "M9" or "AC14". Columns are named A to Z
// and then AA to AV, and run round the colour wheel in steps of 7.5 degrees; rows are numbered 1 to 20, from muted and
// dark (1) through vivid (about 7 to 9) to pale (20). Names are a run of letters followed by digits, so they are never
// ambiguous.
//
// The grid is the older 24 x 10 grid made twice as fine in each direction, then moved down one row: the old square in
// column i, row r is now column 2i, row 2r + 1; the squares between them are interpolated, and row 1 is a new, even more
// muted top row. The old near-white bottom row was hard to tell apart, so it is gone.
export const COLS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ...'ABCDEFGHIJKLMNOPQRSTUV'.split('').map((c) => 'A' + c)];
export const ROWS = Array.from({ length: 20 }, (_, i) => String(i + 1));
export const CELL_COUNT = COLS.length * ROWS.length;

// Saturation and lightness of the old rows. Between two of them the new row is the average, in HSL (the hue stays put
// along a row, so linear steps in saturation and lightness are a smooth blend). Row 1 carries the trend up to a greyer 12.5.
const OLD_LEVELS = [[25, 30], [50, 30], [75, 30], [100, 30], [100, 40], [100, 50], [100, 60], [100, 70], [100, 80], [100, 90]];
const LEVELS = Array.from({ length: 20 }, (_, i) => {
  if (i === 0) return [12.5, 30];
  const j = i - 1;
  const [s0, l0] = OLD_LEVELS[j >> 1];
  if (j % 2 === 0) return [s0, l0];
  const [s1, l1] = OLD_LEVELS[(j >> 1) + 1];
  return [(s0 + s1) / 2, (l0 + l1) / 2];
});

const NAME = /^([A-Z]{1,2})([1-9]\d?)$/;
const COL_INDEX = new Map(COLS.map((c, i) => [c, i]));

/** The column and row indexes (both from 0) of a square name, or null if it is not a square. */
export function parseCell(cell) {
  const m = typeof cell === 'string' ? NAME.exec(cell) : null;
  if (!m || !COL_INDEX.has(m[1]) || Number(m[2]) > ROWS.length) return null;
  return { col: COL_INDEX.get(m[1]), row: Number(m[2]) - 1 };
}

export const cellName = (col, row) => COLS[col] + ROWS[row];

export const isCell = (cell) => parseCell(cell) !== null;

export function cellColour(cell) {
  const { col, row } = parseCell(cell);
  const [saturation, lightness] = LEVELS[row];
  return `hsl(${col * 7.5}deg ${saturation}% ${lightness}%)`;
}

/** Within one square of the target, diagonals included. The hue does not wrap round from the last column to the first. */
export function isClose(cell, target) {
  const a = parseCell(cell);
  const b = parseCell(target);
  return Boolean(a && b) && Math.abs(a.col - b.col) <= 1 && Math.abs(a.row - b.row) <= 1;
}

/** The name in this grid of a square from the old 24 x 10 grid ("M4": columns A to X, rows 0 to 9), or null. */
export function fromOldCell(cell) {
  const m = typeof cell === 'string' ? /^([A-X])([0-9])$/.exec(cell) : null;
  return m ? cellName(2 * (m[1].charCodeAt(0) - 65), 2 * Number(m[2]) + 1) : null;
}

/** The name in this grid of a square from the 48 x 20 grid before it was moved down a row, or null at its old bottom row. */
export function fromV2Cell(cell) {
  const p = parseCell(cell);
  return p && p.row < ROWS.length - 1 ? cellName(p.col, p.row + 1) : null;
}
