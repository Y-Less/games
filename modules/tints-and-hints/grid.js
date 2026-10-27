// The colour grid, shared by the server (what counts as a close guess) and the client (drawing it).
// 52 columns by 24 rows. A square is a column name and a row number, such as "M9" or "AC14". Columns are named A to Z
// and then AA to AZ, and run round the colour wheel in equal steps; rows are numbered 1 to 24, from very dark and muted
// (1) through vivid (about 13 to 15) to pale (24). Names are a run of letters followed by digits, so they are never
// ambiguous.
//
// The columns are spread evenly round the colour wheel (360 / 52 degrees apart). The rows run through the old 10-step
// scale (and the darker steps above it) and are spread evenly over 24 rows: the old grid's levels are no longer
// exactly on rows, they are blended between neighbours.
export const COLS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => 'A' + c)];
export const ROWS = Array.from({ length: 24 }, (_, i) => String(i + 1));
export const CELL_COUNT = COLS.length * ROWS.length;

// Saturation and lightness of the old rows. Between two of them the step is the average, in HSL (the hue stays put along
// a row, so linear steps in saturation and lightness are a smooth blend). Three steps of 5 in lightness at a low
// saturation come before them (the darkest, 15, is left out), and the last step is 95. The 23 steps are then spread
// evenly over the 24 rows.
const OLD_LEVELS = [[25, 30], [50, 30], [75, 30], [100, 30], [100, 40], [100, 50], [100, 60], [100, 70], [100, 80], [100, 90], [100, 100]];
const STEPS = [
  [12.5, 20], [12.5, 25], [12.5, 30],
  ...Array.from({ length: 20 }, (_, j) => {
    const [s0, l0] = OLD_LEVELS[j >> 1];
    if (j % 2 === 0) return [s0, l0];
    const [s1, l1] = OLD_LEVELS[(j >> 1) + 1];
    return [(s0 + s1) / 2, (l0 + l1) / 2];
  }),
];
const LEVELS = Array.from({ length: 24 }, (_, i) => {
  const at = (i * (STEPS.length - 1)) / (ROWS.length - 1);
  const lo = Math.min(STEPS.length - 2, Math.floor(at));
  const f = at - lo;
  return [0, 1].map((k) => Math.round((STEPS[lo][k] + (STEPS[lo + 1][k] - STEPS[lo][k]) * f) * 100) / 100);
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
  return `hsl(${Math.round((col * 36000) / COLS.length) / 100}deg ${saturation}% ${lightness}%)`;
}

/** Within one square of the target, diagonals included. The hue does not wrap round from the last column to the first. */
export function isClose(cell, target) {
  const a = parseCell(cell);
  const b = parseCell(target);
  return Boolean(a && b) && Math.abs(a.col - b.col) <= 1 && Math.abs(a.row - b.row) <= 1;
}

/** The name, in the 48 x 24 grid, of a square from the old 24 x 10 grid ("M4": columns A to X, rows 0 to 9), or null. */
export function fromOldCell(cell) {
  const m = typeof cell === 'string' ? /^([A-X])([0-9])$/.exec(cell) : null;
  return m ? cellName(2 * (m[1].charCodeAt(0) - 65), 2 * Number(m[2]) + 4) : null;
}

/** The name, in the 48 x 24 grid, of a square from the 48 x 20 grid before the new rows (version 2: shifted by 4 rows) or the one with a top row (version 3: by 3). */
export function fromEarlierCell(cell, shift) {
  const p = parseCell(cell);
  return p && p.row + shift < ROWS.length ? cellName(p.col, p.row + shift) : null;
}

/** The name in this grid of a square from the 48 x 24 grid (version 4): the same hue and level, to the nearest square. */
export function fromV4Cell(cell) {
  const p = parseCell(cell);
  if (!p) return null;
  const col = Math.min(COLS.length - 1, Math.round((p.col * COLS.length) / 48));
  return cellName(col, p.row === 0 ? 0 : Math.round(((p.row - 1) * (ROWS.length - 1)) / (ROWS.length - 2)));
}

// ---------- 4 x 4 groups, for the computer players ----------
// The grid is cut into blocks of 4 columns by 4 rows (13 by 6, 16 squares each). Each block has a plain-words colour
// description, such as "fir tree" or "ballet shoes", which a computer hinter gives and a computer guesser looks up.
export const GROUP_SIZE = 4;
// By object, not by colour name: one row per 27.7 degrees of the colour wheel from red, each with its five bands from
// very dark to pale (the bands are the grid's rows 1-4, 5-8, 9-12, 13-16, 17-20 and 21-24).
const DESCRIPTIONS = [
  ['dried blood', 'brick dust', 'claret', 'fire engine', 'coral', 'blush'],
  ['dark chocolate', 'coffee', 'rust', 'pumpkin', 'apricot', 'peach'],
  ['tobacco', 'khaki', 'old brass', 'sunflower', 'butter', 'custard'],
  ['swamp mud', 'bog moss', 'avocado skin', 'tennis ball', 'pistachio', 'mint ice cream'],
  ['forest floor', 'pond weed', 'fir tree', 'fresh grass', 'spring leaf', 'celery'],
  ['cave pool', 'lichen', 'holly', 'jade ring', 'cucumber', 'honeydew'],
  ['ocean trench', 'bottle glass', 'deep sea', 'peacock', 'seafoam', 'sea mist'],
  ['wet slate', 'stormy harbour', 'deep pool', 'tropical lagoon', 'ice pop', 'ice cube'],
  ['submarine', 'denim', 'midnight', 'sapphire', 'cornflower', 'baby blanket'],
  ['storm cloud', 'ink stain', 'twilight', 'harebell', 'wisteria', 'periwinkle'],
  ['black grape', 'old velvet', 'aubergine', 'grape', 'orchid', 'lavender'],
  ['plum skin', 'dusty heather', 'beetroot', 'dragon fruit', 'raspberry sorbet', 'sweet pea'],
  ['black cherry', 'raisin', 'pomegranate', 'hot lipstick', 'flamingo', 'ballet shoes'],
];

/** The block (column group, row group, both from 0) that a square is in. */
export function groupOf(cell) {
  const p = parseCell(cell);
  return p && { col: Math.floor(p.col / GROUP_SIZE), row: Math.floor(p.row / GROUP_SIZE) };
}

/** The description of a block, an object of a similar colour, e.g. "fir tree". Every block has a different one. */
export const describeGroup = ({ col, row }) => DESCRIPTIONS[col][row];

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
  for (let col = 0; col < DESCRIPTIONS.length; col++) for (let row = 0; row < DESCRIPTIONS[col].length; row++) if (describeGroup({ col, row }) === wanted) return groupCells({ col, row });
  return null;
}
