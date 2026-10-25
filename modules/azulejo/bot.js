// The computer players of Azulejo. They only ever make moves the rules allow (game.legalMoves lists them and the
// same game functions check them). Each legal move is given a value: points a completed line will score on the wall
// (with a share of it for a partly built line that can still be finished), minus what the floor will cost, a small
// credit for the first-player marker, and a little for keeping tiles away from opponents who need them.
import * as game from './game.js';
import { SIZE, columnsFor, isDeadCell, lineCapacity, previewTake, rowComplete, tileScore } from './rules.js';

const isBot = game.isBot;

/** The next thing a computer has to do, or null when the game waits for a person. */
export function pendingAction(room) {
  if (room.phase === 'tiling') {
    const seat = room.seats.findIndex((s, i) => isBot(s) && room.pending[i]);
    return seat === -1 ? null : { type: 'column', seat };
  }
  if (room.phase !== 'playing' || room.turn === null || room.turn === undefined) return null;
  return isBot(room.seats[room.turn]) ? { type: 'move', seat: room.turn } : null;
}

const copyWall = (wall) => wall.map((r) => r.slice());

/** How good it is to put a tile of this colour at (row, col) of this wall. Higher is better. */
function columnValue(wall, row, col, colour, free) {
  const next = copyWall(wall);
  next[row][col] = colour;
  let value = tileScore(next, row, col);
  const rowFill = next[row].filter((c) => c !== null).length;
  const colFill = next.filter((r) => r[col] !== null).length;
  const setFill = next.flat().filter((c) => c === colour).length;
  value += 0.35 * rowFill + 0.25 * colFill + 0.2 * setFill;
  if (rowComplete(next, row)) value += 1.5;
  if (colFill === SIZE) value += 4;
  if (setFill === SIZE) value += 6;
  if (free) {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isDeadCell(next, r, c) && !isDeadCell(wall, r, c)) value -= 4;
  }
  return value;
}

/** The best column for a tile of this colour in this row, or null when there is none. */
export function bestColumn(wall, row, colour, free, rng = Math.random) {
  let best = null;
  for (const col of columnsFor(wall, row, colour, free)) {
    const value = columnValue(wall, row, col, colour, free) + rng() * 0.2;
    if (!best || value > best.value) best = { col, value };
  }
  return best;
}

const tilesLeft = (room, colour, except) =>
  room.factories.reduce((n, f, i) => (i === except ? n : n + f.filter((c) => c === colour).length), 0) + (except === 'centre' ? 0 : room.centre.filter((c) => c === colour).length);

/** The value of one legal move for a seat. */
export function moveValue(room, seat, move, rng = Math.random) {
  const { source, colour, line } = move;
  const tiles = source === 'centre' ? room.centre : room.factories[source];
  const count = tiles.filter((c) => c === colour).length;
  const marker = game.takesMarker(room, source);
  const free = room.settings.freeWall;
  const preview = previewTake({ lines: room.lines[seat], floor: room.floors[seat] }, { count, line, marker });
  let value = -preview.extraPenalty;
  if (line !== 'floor') {
    const target = bestColumn(room.walls[seat], line, colour, free, rng);
    const have = room.lines[seat][line].count;
    const after = have + preview.put;
    const capacity = lineCapacity(line);
    if (after === capacity) value += target.value + 0.5;
    else {
      const remaining = capacity - after;
      const available = tilesLeft(room, colour, source);
      const chance = available >= remaining ? 0.75 : available > 0 ? 0.4 : 0.1;
      value += target.value * (after / capacity) * chance + 0.2 * preview.put;
    }
  }
  if (marker) value += 0.4;
  // Keep tiles away from an opponent who is close to finishing a line of that colour.
  room.lines.forEach((lines, other) => {
    if (other === seat) return;
    lines.forEach((l, i) => {
      if (l.colour === colour && l.count < lineCapacity(i)) value += 0.25 * Math.min(lineCapacity(i) - l.count, count);
    });
  });
  return value + rng() * 0.25;
}

/** The best legal move for the seat whose turn it is. */
export function chooseMove(room, seat, rng = Math.random) {
  let best = null;
  for (const move of game.legalMoves(room, seat)) {
    const value = moveValue(room, seat, move, rng);
    if (!best || value > best.value) best = { ...move, value };
  }
  return best ? { source: best.source, colour: best.colour, line: best.line } : null;
}

/** The column a computer picks for the tile its line has just completed (free wall). */
export function chooseColumnFor(room, seat, rng = Math.random) {
  const pending = room.pending[seat];
  const options = pending.columns.map((col) => ({ col, value: columnValue(room.walls[seat], pending.row, col, pending.colour, true) + rng() * 0.2 }));
  return options.reduce((best, o) => (o.value > best.value ? o : best)).col;
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'column') result = game.chooseColumn(room, action.seat, { col: chooseColumnFor(room, action.seat, rng) }, rng);
  else {
    const move = chooseMove(room, action.seat, rng);
    action.move = move;
    result = move ? game.takeTiles(room, action.seat, move, rng) : { ok: false, error: 'no legal move' };
  }
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}

