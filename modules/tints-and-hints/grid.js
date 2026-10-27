// The colour grid, shared by the server (what counts as a close guess) and the client (drawing it).
// 52 columns by 24 rows. A square is a column name and a row number, such as "M9" or "AC14". Columns are named A to Z
// and then AA to AZ, and run round the colour wheel in equal steps; rows are numbered 1 to 24, from very dark and muted
// (1) through vivid (about 13 to 15) to pale (24). Names are a run of letters followed by digits, so they are never
// ambiguous.
//
// Colours are worked out in OKLCH, a space built so that equal steps look equal to the eye (its lightness is already
// the cube root of linear light, so it is spread by how bright things look, not by the sRGB gamma of about 2.2).
//   - Columns go round the hue in equal steps (360 / 52 degrees), starting at a red.
//   - Rows rise in lightness in equal steps, from dark (0.28) to pale (0.93). The chroma is a fraction of the most that
//     sRGB can show at that lightness and hue (eased along the row, see below): greyish at the top, rising to the fullest colour by about row 13,
//     and then limited only by the gamut, which is what makes the paler rows pastel.
// Every colour is a plain sRGB hex string, so it is the same in every browser.
export const COLS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => 'A' + c)];
export const ROWS = Array.from({ length: 24 }, (_, i) => String(i + 1));
export const CELL_COUNT = COLS.length * ROWS.length;

const HUE_START = 15; // degrees of OKLCH hue for column A (a red), so each 4-column block is centred on a named hue
const L_DARK = 0.28;
const L_PALE = 0.93;
const CHROMA_FIRST = 0.25; // the top row's share of the full chroma
const CHROMA_RISE = 1.5; // how fast it grows down the rows (in shares per whole grid)

const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
/** The linear sRGB of an OKLCH colour (components outside 0 to 1 are out of gamut). */
function oklchToLinear(L, C, hue) {
  const a = C * Math.cos((hue * Math.PI) / 180);
  const b = C * Math.sin((hue * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);
/** The most chroma sRGB can show at this lightness and hue. */
function maxChroma(L, hue) {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(L, mid, hue))) lo = mid;
    else hi = mid;
  }
  return lo;
}
function hexOf(L, chroma, hue) {
  const rgb = oklchToLinear(L, chroma, hue);
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, encode(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('');
}
// The most chroma sRGB can show peaks sharply at the corners of its gamut (the primaries and secondaries), which would
// show up as creases across the rows. So along each row the limit is eased: the lowest limit within SMOOTH columns either
// way, then averaged over the same width. That can only come out at or under the real limit, so every colour stays
// inside sRGB, and it changes smoothly from one hue to the next.
const SMOOTH = 2;
const ringAt = (list, i) => list[((i % list.length) + list.length) % list.length];
function easedLimits(limits) {
  const low = limits.map((_, i) => Math.min(...Array.from({ length: 2 * SMOOTH + 1 }, (__, k) => ringAt(limits, i + k - SMOOTH))));
  return low.map((_, i) => Array.from({ length: 2 * SMOOTH + 1 }, (__, k) => ringAt(low, i + k - SMOOTH)).reduce((x, y) => x + y, 0) / (2 * SMOOTH + 1));
}
const hueOf = (col) => (HUE_START + (col * 360) / COLS.length) % 360;
const COLOURS = ROWS.map((_, row) => {
  const t = row / (ROWS.length - 1);
  const L = L_DARK + (L_PALE - L_DARK) * t;
  const share = Math.min(1, CHROMA_FIRST + CHROMA_RISE * t);
  const limits = easedLimits(COLS.map((__, col) => maxChroma(L, hueOf(col))));
  return COLS.map((__, col) => hexOf(L, share * limits[col], hueOf(col)));
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
  return COLOURS[row][col];
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
