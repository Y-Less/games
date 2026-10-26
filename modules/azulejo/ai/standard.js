// "Standard": the original computer player. Each legal move is given a value: points a completed line will score on the
// wall (with a share of it for a partly built line that can still be finished), minus what the floor will cost, a small
// credit for the first-player marker, and a little for keeping tiles away from opponents who need them.
import { SIZE, columnsFor, isDeadCell, lineCapacity, rowComplete, tileScore } from '../rules.js';
import { copyWall, takeOf, tilesLeft } from './common.js';

/** How good it is to put a tile of this colour at (row, col) of this wall. Higher is better. */
export function columnValue(wall, row, col, colour, free) {
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

/** The value of one legal move for a seat. */
export function moveValue(state, seat, move, rng = Math.random) {
  const { source, colour, line } = move;
  const free = state.settings.freeWall;
  const { count, marker, preview } = takeOf(state, seat, move);
  let value = -preview.extraPenalty;
  if (line !== 'floor') {
    const target = bestColumn(state.walls[seat], line, colour, free, rng);
    const have = state.lines[seat][line].count;
    const after = have + preview.put;
    const capacity = lineCapacity(line);
    if (after === capacity) value += target.value + 0.5;
    else {
      const remaining = capacity - after;
      const available = tilesLeft(state, colour, source);
      const chance = available >= remaining ? 0.75 : available > 0 ? 0.4 : 0.1;
      value += target.value * (after / capacity) * chance + 0.2 * preview.put;
    }
  }
  if (marker) value += 0.4;
  // Keep tiles away from an opponent who is close to finishing a line of that colour.
  state.lines.forEach((lines, other) => {
    if (other === seat) return;
    lines.forEach((l, i) => {
      if (l.colour === colour && l.count < lineCapacity(i)) value += 0.25 * Math.min(lineCapacity(i) - l.count, count);
    });
  });
  return value + rng() * 0.25;
}

export default {
  id: 'standard',
  name: 'Standard',
  description: 'The classic computer player: scores each move by the wall points it will earn, the floor it risks and the tiles it keeps from opponents.',
  weight: 4,
  chooseMove(state, seat, moves, rng) {
    let best = null;
    for (const move of moves) {
      const value = moveValue(state, seat, move, rng);
      if (!best || value > best.value) best = { ...move, value };
    }
    return best ? { source: best.source, colour: best.colour, line: best.line } : null;
  },
  chooseColumn(state, seat, pending, rng) {
    const options = pending.columns.map((col) => ({ col, value: columnValue(state.walls[seat], pending.row, col, pending.colour, true) + rng() * 0.2 }));
    return options.reduce((best, o) => (o.value > best.value ? o : best)).col;
  },
};
