// Helpers shared by the Azulejo AIs. Plain data in, plain data out: nothing here touches a room, a socket or Math.random.
//
// The `state` an AI is given is a read-only snapshot of the table that a player could see (never the bag's contents):
//   { size, settings: { freeWall }, round, first, scores, factories, centre, markerInCentre, lines, walls, floors, lid, bagCount }
// `seat` is the seat deciding, `moves` the list of legal { source, colour, line } moves, and a pending column choice is
// { row, colour, columns }.
import { FLOOR_SLOTS, SIZE, columnsFor, floorPenalty, isDeadCell, previewTake } from '../rules.js';

export const copyWall = (wall) => wall.map((r) => r.slice());
export const sourceTiles = (state, source) => (source === 'centre' ? state.centre : state.factories[source]);
export const takesMarker = (state, source) => source === 'centre' && state.markerInCentre;
export const countOf = (tiles, colour) => tiles.reduce((n, c) => n + (c === colour ? 1 : 0), 0);
export const pickOne = (items, rng) => items[Math.floor(rng() * items.length)];
export const rowFill = (wall, row) => wall[row].filter((c) => c !== null).length;
export const colFill = (wall, col) => wall.filter((r) => r[col] !== null).length;
export const setFill = (wall, colour) => wall.flat().filter((c) => c === colour).length;

/** Tiles of a colour on the table (factories and centre), not counting the source `except` (a factory index or 'centre'). */
export const tilesLeft = (state, colour, except) =>
  state.factories.reduce((n, f, i) => (i === except ? n : n + countOf(f, colour)), 0) + (except === 'centre' ? 0 : countOf(state.centre, colour));

/** What a move takes and what it does to the taker's pattern lines and floor. */
export function takeOf(state, seat, move) {
  const count = countOf(sourceTiles(state, move.source), move.colour);
  const marker = takesMarker(state, move.source);
  const preview = previewTake({ lines: state.lines[seat], floor: state.floors[seat] }, { count, line: move.line, marker });
  return { count, marker, preview };
}

/** The table after a move (a shallow copy: boards are shared, so only read them). */
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

/** The column in `row` that scores best by `value(nextWall, col)` (random tie-break). Null when there is none. */
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

/** How many places on a free wall this tile would leave with nothing that could ever go there. */
export function newDeadCells(before, after) {
  let dead = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isDeadCell(after, r, c) && !isDeadCell(before, r, c)) dead++;
  return dead;
}

/** The generic column chooser: highest `value(nextWall, col)`, with the free-wall dead-place check. */
export function chooseColumnBy(state, seat, pending, rng, value) {
  const wall = state.walls[seat];
  const options = pending.columns.map((col) => {
    const next = copyWall(wall);
    next[pending.row][col] = pending.colour;
    return { col, value: value(next, col) - 4 * newDeadCells(wall, next) + rng() * 0.2 };
  });
  return options.reduce((best, o) => (o.value > best.value ? o : best)).col;
}

/** The floor penalty once a move's overflow has landed on the floor. */
export const floorAfter = (state, seat, preview) =>
  floorPenalty({ length: Math.min(FLOOR_SLOTS, state.floors[seat].length + preview.onFloor + (preview.markerOnFloor ? 1 : 0)) });
