// The pure rules of Azulejo: colours, the wall, pattern lines, the floor and scoring. No rooms and no sockets, so the
// server, the computer players, the tests and the client (for highlighting and previews) can all share it.
//
// Tiles are the colour numbers 0..4. A floor line is an array of slots: a colour number, or MARKER (-1) for the
// first-player marker. A wall is 5 rows of 5 cells, each a colour number or null. Pattern line i (0..4) holds i + 1 tiles
// and is { colour: number | null, count: number }.

// Depends on nothing: this file is the base the game, the AIs, the tests and the client all build on.

// The five colours (as numbers), their display names, and the size of the wall and of every pattern-line set.
export const COLOURS = [0, 1, 2, 3, 4];
export const COLOUR_NAMES = ['Cobalt', 'Saffron', 'Terracotta', 'Verdigris', 'Plum'];
export const SIZE = 5;
// 20 tiles of each colour make the 100 in the bag; a factory display holds four.
export const PER_COLOUR = 20;
export const TILES = PER_COLOUR * COLOURS.length;
export const FACTORY_TILES = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
// The first-player marker sits in a floor line as this value, so it can never be mistaken for a colour.
export const MARKER = -1;
// The points lost for each floor slot, in order (tiles past the seventh cost nothing: they go to the lid).
// Then the end-of-game bonuses: per complete row, per complete column and per complete colour set.
export const FLOOR_PENALTIES = [1, 1, 2, 2, 2, 3, 3];
export const FLOOR_SLOTS = FLOOR_PENALTIES.length;
export const ROW_BONUS = 2;
export const COLUMN_BONUS = 7;
export const SET_BONUS = 10;

/**
 * Factory displays for a number of players: 5, 7, 9 or 11.
 *
 * @param {number} players  the seats at the table, 2..5
 * @returns {number} the displays to deal
 *
 * Side effects: none.
 */
export const factoryCount = (players) => 2 * players + 1;

/**
 * The colour at a place of the fixed wall: each row is the row above shifted one place to the right.
 *
 * @param {number} row  the wall row, 0..4
 * @param {number} col  the wall column, 0..4
 * @returns {number} the colour that belongs there
 *
 * Side effects: none.
 */
export const wallColour = (row, col) => (((col - row) % SIZE) + SIZE) % SIZE;
/**
 * The column that a colour belongs in, in a row of the fixed wall (the inverse of wallColour).
 *
 * @param {number} row  the wall row, 0..4
 * @param {number} colour  the colour
 * @returns {number} the column, 0..4
 *
 * Side effects: none.
 */
export const wallColumn = (row, colour) => (colour + row) % SIZE;

/**
 * A new, empty wall: 5 rows of 5 cells, all null.
 *
 * @returns {(number | null)[][]} a wall with new row arrays
 *
 * Side effects: none.
 */
export const emptyWall = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
/**
 * Five empty pattern lines.
 *
 * @returns {{ colour: number | null, count: number }[]} new line objects, one per row
 *
 * Side effects: none.
 */
export const emptyLines = () => Array.from({ length: SIZE }, () => ({ colour: null, count: 0 }));
/**
 * How many tiles pattern line `line` holds (line 0 holds one, line 4 holds five).
 *
 * @param {number} line  the pattern line, 0..4
 * @returns {number} the capacity, 1..5
 *
 * Side effects: none.
 */
export const lineCapacity = (line) => line + 1;

/**
 * Does a wall row already hold a tile of this colour?
 *
 * @param {(number | null)[][]} wall  the wall
 * @param {number} row  the wall row
 * @param {number} colour  the colour to look for
 * @returns {boolean} true when it is there
 *
 * Side effects: none.
 */
export const rowHas = (wall, row, colour) => wall[row].includes(colour);
/**
 * Does a wall column already hold a tile of this colour? (Only a free wall has to check this.)
 *
 * @param {(number | null)[][]} wall  the wall
 * @param {number} col  the wall column
 * @param {number} colour  the colour to look for
 * @returns {boolean} true when it is there
 *
 * Side effects: none.
 */
export const colHas = (wall, col, colour) => wall.some((r) => r[col] === colour);

/**
 * The columns of a wall row where a tile of this colour could go now. On the fixed wall there is at most one;
 * on a free wall it is any empty place whose column does not already hold the colour.
 *
 * @param {(number | null)[][]} wall  the wall (not changed)
 * @param {number} row  the wall row
 * @param {number} colour  the colour
 * @param {boolean} free  true on a free wall
 * @returns {number[]} the columns, empty if none
 *
 * Side effects: none.
 */
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
 *
 * @param {{ colour: number | null, count: number }[]} lines  the player's pattern lines
 * @param {(number | null)[][]} wall  the player's wall
 * @param {number} line  the pattern line asked about (checked to be an integer 0..4)
 * @param {number} colour  the colour to put there
 * @param {boolean} free  true on a free wall (default false)
 * @returns {string | null} the reason, or null when the move is allowed
 *
 * Side effects: none.
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

/**
 * The penalty for a floor line. Pure: reads only `floor.length`, so a `{ length }` stand-in works too.
 *
 * @param {{ length: number }} floor  the floor slots (slots beyond the seventh cost nothing)
 * @returns {number} the points lost, never negative
 *
 * Side effects: none.
 */
export const floorPenalty = (floor) => FLOOR_PENALTIES.slice(0, floor.length).reduce((a, b) => a + b, 0);

/**
 * The whole floor penalty once the overflow of a previewed take has landed on a floor that already holds
 * `floorLength` slots. The slot count is capped at FLOOR_SLOTS (tiles past the seventh go to the lid, not the floor).
 * Used by the computer players and by the client's hint text so both price the floor the same way.
 *
 * @param {number} floorLength  how many slots of the floor are filled before the take
 * @param {{ onFloor: number, markerOnFloor: boolean }} preview  the result of previewTake
 * @returns {number} the total penalty the floor would then show
 *
 * Side effects: none.
 */
export const floorPenaltyAfter = (floorLength, preview) =>
  floorPenalty({ length: Math.min(FLOOR_SLOTS, floorLength + preview.onFloor + (preview.markerOnFloor ? 1 : 0)) });

/**
 * How many tiles of one colour are in a list of tiles.
 *
 * @param {number[]} tiles   colour numbers
 * @param {number} colour    the colour to count
 * @returns {number}
 *
 * Side effects: none.
 */
export const countOf = (tiles, colour) => tiles.reduce((n, c) => n + (c === colour ? 1 : 0), 0);

/**
 * The tiles in a source on the table: the centre, or one factory display. Works on a room or on an AI's snapshot (both
 * have `centre` and `factories`).
 *
 * @param {{ centre: number[], factories: number[][] }} table
 * @param {'centre' | number} source  'centre' or a factory index
 * @returns {number[]} the live array (do not mutate it unless you own the table)
 *
 * Side effects: none.
 */
export const sourceTiles = (table, source) => (source === 'centre' ? table.centre : table.factories[source]);

/**
 * True when taking from this source would also take the first-player marker (it is still in the centre).
 *
 * @param {{ markerInCentre: boolean }} table  a room or an AI's snapshot
 * @param {'centre' | number} source
 * @returns {boolean}
 *
 * Side effects: none.
 */
export const takesMarker = (table, source) => source === 'centre' && table.markerInCentre;

/**
 * What happens when `count` tiles of one colour are taken: how many fit on `line` (or 'floor' for none), how many go
 * to the floor, how many of those floor tiles are past the seventh slot (to the lid), and the extra penalty the floor
 * line now shows. The marker, if it comes, takes a floor slot before any tiles do.
 *
 * @param {{ lines: object[], floor: number[] }} board  the taker's pattern lines and floor (not changed)
 * @param {{ count: number, line: number | 'floor', marker?: boolean }} take  the take to preview; `marker` is true when the first-player marker comes with it
 * @returns {{ put: number, overflow: number, onFloor: number, toLid: number, markerOnFloor: boolean, extraPenalty: number, completes: boolean }} tiles placed on the line, tiles that did not fit, how many of those reach the floor or the lid, whether the marker lands on the floor, the extra penalty, and whether the line is full afterwards
 *
 * Side effects: none.
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
 * longer than 1) plus the length of its vertical run (if longer than 1). The tile is counted in both runs.
 *
 * @param {(number | null)[][]} wall  the wall with the tile already placed
 * @param {number} row  the tile's row
 * @param {number} col  the tile's column
 * @returns {number} the points
 *
 * Side effects: none.
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

/**
 * Is every cell of a wall row filled?
 *
 * @param {(number | null)[][]} wall  the wall
 * @param {number} row  the wall row
 * @returns {boolean} true when the row is full
 *
 * Side effects: none.
 */
export const rowComplete = (wall, row) => wall[row].every((c) => c !== null);
/**
 * Is every cell of a wall column filled?
 *
 * @param {(number | null)[][]} wall  the wall
 * @param {number} col  the wall column
 * @returns {boolean} true when the column is full
 *
 * Side effects: none.
 */
export const columnComplete = (wall, col) => wall.every((r) => r[col] !== null);
/**
 * How many rows of a wall are full. (COLOURS is only used here as the list 0..4 of row numbers.)
 *
 * @param {(number | null)[][]} wall  the wall
 * @returns {number} the full rows
 *
 * Side effects: none.
 */
export const completeRows = (wall) => COLOURS.filter((r) => rowComplete(wall, r)).length;
/**
 * How many columns of a wall are full. (COLOURS is only used here as the list 0..4 of column numbers.)
 *
 * @param {(number | null)[][]} wall  the wall
 * @returns {number} the full columns
 *
 * Side effects: none.
 */
export const completeColumns = (wall) => COLOURS.filter((c) => columnComplete(wall, c)).length;
/**
 * How many colours have all five of their tiles on the wall.
 *
 * @param {(number | null)[][]} wall  the wall
 * @returns {number} the complete sets
 *
 * Side effects: none.
 */
export const completeSets = (wall) => COLOURS.filter((colour) => wall.flat().filter((c) => c === colour).length === SIZE).length;

/**
 * End-of-game bonuses for one wall: ROW_BONUS per full row, COLUMN_BONUS per full column and SET_BONUS per full colour set.
 *
 * @param {(number | null)[][]} wall  the wall
 * @returns {{ rows: number, columns: number, sets: number, points: number }} how many of each, and the points they are worth
 *
 * Side effects: none.
 */
export function bonuses(wall) {
  const rows = completeRows(wall);
  const columns = completeColumns(wall);
  const sets = completeSets(wall);
  return { rows, columns, sets, points: rows * ROW_BONUS + columns * COLUMN_BONUS + sets * SET_BONUS };
}

/**
 * Is this a position in a free wall where nothing can ever be placed: the cell is empty and every colour is blocked there
 * (by its row or by its column)? Such a cell can never be filled, so it caps the rows, columns and sets through it.
 *
 * @param {(number | null)[][]} wall  the wall
 * @param {number} row  the cell row
 * @param {number} col  the cell column
 * @returns {boolean} true for an empty cell that no colour can fill
 *
 * Side effects: none.
 */
export function isDeadCell(wall, row, col) {
  if (wall[row][col] !== null) return false;
  return !COLOURS.some((colour) => !rowHas(wall, row, colour) && !colHas(wall, col, colour));
}

/**
 * The text of a colour-and-count, e.g. "3 Cobalt" (for the log).
 *
 * @param {number} count  how many tiles
 * @param {number} colour  their colour
 * @returns {string} the text
 *
 * Side effects: none.
 */
export const tilesText = (count, colour) => `${count} ${COLOUR_NAMES[colour]}`;
