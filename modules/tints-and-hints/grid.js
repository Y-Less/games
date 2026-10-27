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

// ---------- 4 x 4 groups, for the computer players ----------
// The grid is cut into blocks of 4 columns by 4 rows (12 by 5, 16 squares each). Each block has a plain-words colour
// description, such as "vivid green" or "pale pink", which a computer hinter gives and a computer guesser looks up.
export const GROUP_SIZE = 4;
const HUES = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'sky blue', 'blue', 'indigo', 'purple', 'magenta', 'pink'];
const BANDS = ['muted dark', 'dark', 'vivid', 'light', 'pale'];

/** The block (column group, row group, both from 0) that a square is in. */
export function groupOf(cell) {
  const p = parseCell(cell);
  return p && { col: Math.floor(p.col / GROUP_SIZE), row: Math.floor(p.row / GROUP_SIZE) };
}

/** The description of a block, e.g. "dark teal". Every block has a different one. */
export function describeGroup({ col, row }) {
  const hue = HUES[col];
  if (row === 0 && hue === 'orange') return 'muted brown';
  if (row === 1 && hue === 'orange') return 'brown';
  return `${BANDS[row]} ${hue}`;
}

/** The description of the block that holds a square, or null if it is not a square. */
export const describeCell = (cell) => (parseCell(cell) ? describeGroup(groupOf(cell)) : null);

/** The 16 squares of a block. */
export function groupCells({ col, row }) {
  const out = [];
  for (let c = col * GROUP_SIZE; c < (col + 1) * GROUP_SIZE; c++) for (let r = row * GROUP_SIZE; r < (row + 1) * GROUP_SIZE; r++) out.push(cellName(c, r));
  return out;
}

/** The 16 squares described by a hint (any case, spare spaces ignored), or null if the text is not one of the descriptions. */
export function cellsDescribedBy(text) {
  const wanted = String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (let col = 0; col < HUES.length; col++) for (let row = 0; row < BANDS.length; row++) if (describeGroup({ col, row }) === wanted) return groupCells({ col, row });
  return null;
}
