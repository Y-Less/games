// Helpers shared by the Azulejo AIs. Plain data in, plain data out: nothing here touches a room, a socket or Math.random.
// (Randomness always arrives as an `rng` argument, so a seeded test gets the same game every time.)
//
// The `state` an AI is given is a read-only snapshot of the table that a player could see (never the bag's contents):
//   { size, settings: { freeWall }, round, first, scores, factories, centre, markerInCentre, lines, walls, floors, lid, bagCount }
// `seat` is the seat deciding, `moves` the list of legal { source, colour, line } moves, and a pending column choice is
// { row, colour, columns }.
//
// countOf, sourceTiles, takesMarker and floorPenaltyAfter live in ../rules.js (the game and the client use them too).
import { SIZE, columnsFor, countOf, floorPenaltyAfter, isDeadCell, previewTake, sourceTiles, takesMarker } from '../rules.js';

/**
 * A copy of a wall that can be changed without touching the original.
 *
 * @param {(number | null)[][]} wall  5 rows of 5 cells
 * @returns {(number | null)[][]} a new wall with new row arrays
 */
export const copyWall = (wall) => wall.map((r) => r.slice());

/**
 * Picks one item uniformly.
 *
 * @param {any[]} items  a non-empty list
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {any} one of the items
 */
export const pickOne = (items, rng) => items[Math.floor(rng() * items.length)];

/** How many cells of a wall row are filled. */
export const rowFill = (wall, row) => wall[row].filter((c) => c !== null).length;
/** How many cells of a wall column are filled. */
export const colFill = (wall, col) => wall.filter((r) => r[col] !== null).length;
/** How many tiles of one colour are on the wall. */
export const setFill = (wall, colour) => wall.flat().filter((c) => c === colour).length;

/**
 * Tiles of a colour on the table (factories and centre), not counting the source `except`.
 *
 * @param {object} state  the AI snapshot
 * @param {number} colour  the colour to count
 * @param {'centre' | number} except  a factory index or 'centre': the source being taken from, so it is not counted
 * @returns {number}
 */
export const tilesLeft = (state, colour, except) =>
  state.factories.reduce((n, f, i) => (i === except ? n : n + countOf(f, colour)), 0) + (except === 'centre' ? 0 : countOf(state.centre, colour));

/**
 * What a move takes and what it does to the taker's pattern lines and floor.
 *
 * @param {object} state  the AI snapshot
 * @param {number} seat   the seat making the move
 * @param {{ source: 'centre' | number, colour: number, line: number | 'floor' }} move
 * @returns {{ count: number, marker: boolean, preview: object }} tiles taken, whether the first-player marker comes too,
 *   and the previewTake result (see rules.js)
 */
export function takeOf(state, seat, move) {
  const count = countOf(sourceTiles(state, move.source), move.colour);
  const marker = takesMarker(state, move.source);
  const preview = previewTake({ lines: state.lines[seat], floor: state.floors[seat] }, { count, line: move.line, marker });
  return { count, marker, preview };
}

/**
 * The table after a move: the taken tiles are gone and the rest of a factory has slid into the centre.
 *
 * @param {object} state  the AI snapshot (not changed)
 * @param {{ source: 'centre' | number, colour: number }} move
 * @returns {object} a shallow copy: boards are shared with `state`, so only read them
 */
export function tableAfter(state, move) {
  const next = { ...state };
  if (move.source === 'centre') {
    next.centre = state.centre.filter((c) => c !== move.colour);
    next.markerInCentre = false;
  } else {
    next.centre = [...state.centre, ...state.factories[move.source].filter((c) => c !== move.colour)];
    next.factories = state.factories.map((f, i) => (i === move.source ? [] : f));
  }
  return next;
}

/**
 * The column in `row` that scores best by `value(nextWall, col)`, with a small random tie-break.
 *
 * @param {(number | null)[][]} wall  the wall (not changed)
 * @param {number} row     the wall row the tile goes in
 * @param {number} colour  the tile's colour
 * @param {boolean} free   true on a free wall
 * @param {() => number} rng  random numbers in [0, 1)
 * @param {(wall: (number | null)[][], col: number) => number} value  how good the wall is with the tile at `col`
 * @returns {{ col: number, value: number } | null} null when there is no column
 */
export function bestColumnBy(wall, row, colour, free, rng, value) {
  let best = null;
  for (const col of columnsFor(wall, row, colour, free)) {
    const next = copyWall(wall);
    next[row][col] = colour;
    const v = value(next, col) + rng() * 0.2;
    if (!best || v > best.value) best = { col, value: v };
  }
  return best;
}

/**
 * How many places on a free wall this tile would leave with nothing that could ever go there.
 *
 * @param {(number | null)[][]} before  the wall before the tile
 * @param {(number | null)[][]} after   the wall with the tile placed
 * @returns {number}
 */
export function newDeadCells(before, after) {
  let dead = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isDeadCell(after, r, c) && !isDeadCell(before, r, c)) dead++;
  return dead;
}

/**
 * The generic column chooser: highest `value(nextWall, col)`, less a penalty for each free-wall place the tile would kill.
 *
 * @param {object} state    the AI snapshot
 * @param {number} seat     the seat choosing
 * @param {{ row: number, colour: number, columns: number[] }} pending  the choice to make
 * @param {() => number} rng  random numbers in [0, 1)
 * @param {(wall: (number | null)[][], col: number) => number} value  how good the wall is with the tile at `col`
 * @returns {number} the chosen column
 */
export function chooseColumnBy(state, seat, pending, rng, value) {
  const wall = state.walls[seat];
  const options = pending.columns.map((col) => {
    const next = copyWall(wall);
    next[pending.row][col] = pending.colour;
    return { col, value: value(next, col) - 4 * newDeadCells(wall, next) + rng() * 0.2 };
  });
  return options.reduce((best, o) => (o.value > best.value ? o : best)).col;
}

/**
 * The floor penalty once a move's overflow has landed on the floor.
 *
 * @param {object} state    the AI snapshot
 * @param {number} seat     the seat taking
 * @param {{ onFloor: number, markerOnFloor: boolean }} preview  from takeOf
 * @returns {number} the total penalty the floor would show
 */
export const floorAfter = (state, seat, preview) => floorPenaltyAfter(state.floors[seat].length, preview);
