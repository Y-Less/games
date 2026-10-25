// The pure rules of Azulejo: colours, the wall, pattern lines, the floor and scoring. No rooms and no sockets, so the
// server, the computer players, the tests and the client (for highlighting and previews) can all share it.
//
// Tiles are the colour numbers 0..4. A floor line is an array of slots: a colour number, or MARKER (-1) for the
// first-player marker. A wall is 5 rows of 5 cells, each a colour number or null. Pattern line i (0..4) holds i + 1 tiles
// and is { colour: number | null, count: number }.

export const COLOURS = [0, 1, 2, 3, 4];
export const COLOUR_NAMES = ['Cobalt', 'Saffron', 'Terracotta', 'Verdigris', 'Plum'];
export const SIZE = 5;
export const PER_COLOUR = 20;
export const TILES = PER_COLOUR * COLOURS.length;
export const FACTORY_TILES = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const MARKER = -1;
export const FLOOR_PENALTIES = [1, 1, 2, 2, 2, 3, 3];
export const FLOOR_SLOTS = FLOOR_PENALTIES.length;
export const ROW_BONUS = 2;
export const COLUMN_BONUS = 7;
export const SET_BONUS = 10;

/** Factory displays for a number of players: 5, 7, 9 or 11. */
export const factoryCount = (players) => 2 * players + 1;

/** The colour at a place of the fixed wall: each row is the row above shifted one place to the right. */
export const wallColour = (row, col) => (((col - row) % SIZE) + SIZE) % SIZE;
/** The column that a colour belongs in, in a row of the fixed wall. */
export const wallColumn = (row, colour) => (colour + row) % SIZE;

export const emptyWall = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
export const emptyLines = () => Array.from({ length: SIZE }, () => ({ colour: null, count: 0 }));
export const lineCapacity = (line) => line + 1;

export const rowHas = (wall, row, colour) => wall[row].includes(colour);
export const colHas = (wall, col, colour) => wall.some((r) => r[col] === colour);

/** The columns of a wall row where a tile of this colour could go now (empty array if none). */
export function columnsFor(wall, row, colour, free) {
  if (rowHas(wall, row, colour)) return [];
  if (!free) {
    const col = wallColumn(row, colour);
    return wall[row][col] === null ? [col] : [];
  }
  return COLOURS.filter((col) => wall[row][col] === null && !colHas(wall, col, colour));
}

/**
 * Why a colour cannot go on a pattern line (a sentence for the player), or null when it can. A line that is already
 * full is not available.
 */
export function lineProblem(lines, wall, line, colour, free = false) {
  if (!Number.isInteger(line) || line < 0 || line >= SIZE) return 'There is no such pattern line.';
  const have = lines[line];
  const name = COLOUR_NAMES[colour];
  if (have.count >= lineCapacity(line)) return `Line ${line + 1} is already full.`;
  if (have.count > 0 && have.colour !== colour) return `Line ${line + 1} already holds ${COLOUR_NAMES[have.colour]}.`;
  if (rowHas(wall, line, colour)) return `Row ${line + 1} of your wall already has ${name}.`;
  if (!columnsFor(wall, line, colour, free).length) return `${name} has no free column left in row ${line + 1} of your wall.`;
  return null;
}

/** The penalty for the first `slots` floor slots (an array of any length: slots beyond the seventh cost nothing). */
export const floorPenalty = (floor) => FLOOR_PENALTIES.slice(0, floor.length).reduce((a, b) => a + b, 0);

/**
 * What happens when `count` tiles of one colour are taken: how many fit on `line` (or 'floor' for none), how many go
 * to the floor, how many of those floor tiles are past the seventh slot (to the lid), and the extra penalty the floor
 * line now shows. `marker` is true when the first-player marker comes with the take.
 */
export function previewTake({ lines, floor }, { count, line, marker = false }) {
  const space = line === 'floor' ? 0 : lineCapacity(line) - lines[line].count;
  const put = Math.min(count, space);
  const overflow = count - put;
  const roomLeft = Math.max(0, FLOOR_SLOTS - floor.length);
  const markerOnFloor = marker && roomLeft > 0;
  const tilesOnFloor = Math.min(overflow, roomLeft - (markerOnFloor ? 1 : 0));
  const slots = (markerOnFloor ? 1 : 0) + tilesOnFloor;
  const extraPenalty = floorPenalty({ length: floor.length + slots }) - floorPenalty(floor);
  return { put, overflow, onFloor: tilesOnFloor, toLid: overflow - tilesOnFloor, markerOnFloor, extraPenalty, completes: line !== 'floor' && lines[line].count + put === lineCapacity(line) };
}

/**
 * The score for a tile just placed at (row, col): 1 for a lone tile, otherwise the length of its horizontal run (if
 * longer than 1) plus the length of its vertical run (if longer than 1).
 */
export function tileScore(wall, row, col) {
  let across = 1;
  for (let c = col - 1; c >= 0 && wall[row][c] !== null; c--) across++;
  for (let c = col + 1; c < SIZE && wall[row][c] !== null; c++) across++;
  let down = 1;
  for (let r = row - 1; r >= 0 && wall[r][col] !== null; r--) down++;
  for (let r = row + 1; r < SIZE && wall[r][col] !== null; r++) down++;
  if (across === 1 && down === 1) return 1;
  return (across > 1 ? across : 0) + (down > 1 ? down : 0);
}

export const rowComplete = (wall, row) => wall[row].every((c) => c !== null);
export const columnComplete = (wall, col) => wall.every((r) => r[col] !== null);
export const completeRows = (wall) => COLOURS.filter((r) => rowComplete(wall, r)).length;
export const completeColumns = (wall) => COLOURS.filter((c) => columnComplete(wall, c)).length;
/** How many colours have all five of their tiles on the wall. */
export const completeSets = (wall) => COLOURS.filter((colour) => wall.flat().filter((c) => c === colour).length === SIZE).length;

/** End-of-game bonuses for one wall. */
export function bonuses(wall) {
  const rows = completeRows(wall);
  const columns = completeColumns(wall);
  const sets = completeSets(wall);
  return { rows, columns, sets, points: rows * ROW_BONUS + columns * COLUMN_BONUS + sets * SET_BONUS };
}

/** A position in a free wall where nothing can ever be placed: the cell is empty and every colour is blocked there. */
export function isDeadCell(wall, row, col) {
  if (wall[row][col] !== null) return false;
  return !COLOURS.some((colour) => !rowHas(wall, row, colour) && !colHas(wall, col, colour));
}

/** The text of a colour-and-count, e.g. "3 Cobalt". */
export const tilesText = (count, colour) => `${count} ${COLOUR_NAMES[colour]}`;
