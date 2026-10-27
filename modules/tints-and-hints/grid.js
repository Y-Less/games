// The colour grid, shared by the server (what counts as a close guess) and the client (drawing it).
// 48 columns by 20 rows. A square is a column name and a row number, such as "M9" or "AC14". Columns are named A to Z
// and then AA to AV, and run round the colour wheel in steps of 7.5 degrees; rows are numbered 1 to 20, from muted and
// dark (1) through vivid (about 7 to 9) to pale (20). Names are a run of letters followed by digits, so they are never
// ambiguous.
//
// The grid is the older 24 x 10 grid made twice as fine in each direction. Every second column and row is exactly an
// old square (the old square in column i, row r is now column 2i, row 2r); the squares between them are interpolated.
export const COLS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ...'ABCDEFGHIJKLMNOPQRSTUV'.split('').map((c) => 'A' + c)];
export const ROWS = Array.from({ length: 20 }, (_, i) => String(i + 1));
export const CELL_COUNT = COLS.length * ROWS.length;

// Saturation and lightness of the old rows. Between two of them the new row is the average, in HSL (the hue stays put
// along a row, so linear steps in saturation and lightness are a smooth blend). The last new row carries the old
// lightness trend on to a paler 95.
const OLD_LEVELS = [[25, 30], [50, 30], [75, 30], [100, 30], [100, 40], [100, 50], [100, 60], [100, 70], [100, 80], [100, 90]];
const LEVELS = Array.from({ length: 20 }, (_, i) => {
  const [s0, l0] = OLD_LEVELS[i >> 1];
  if (i % 2 === 0) return [s0, l0];
  const [s1, l1] = OLD_LEVELS[(i >> 1) + 1] ?? [100, 100];
  return [(s0 + s1) / 2, (l0 + l1) / 2];
});
LEVELS[19] = [100, 95];

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
  return m ? cellName(2 * (m[1].charCodeAt(0) - 65), 2 * Number(m[2])) : null;
}
