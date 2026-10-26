// "Row finisher": races to complete a horizontal row, which ends the game at the end of that round. It favours the rows
// that are already fullest, and the short pattern lines that fill quickly, and it puts up with a little floor.
import { SIZE, lineCapacity, tileScore } from '../rules.js';
import { bestColumnBy, chooseColumnBy, rowFill, takeOf } from './common.js';

export default {
  id: 'row-finisher',
  name: 'Row finisher',
  description: 'Rushes to complete a row and end the game early, feeding the fullest rows first and tolerating some floor penalties.',
  weight: 1.5,
  chooseMove(state, seat, moves, rng) {
    const free = state.settings.freeWall;
    const wall = state.walls[seat];
    let best = null;
    for (const move of moves) {
      const { preview } = takeOf(state, seat, move);
      let value = -0.6 * preview.extraPenalty;
      if (move.line !== 'floor') {
        const fill = rowFill(wall, move.line);
        const after = state.lines[seat][move.line].count + preview.put;
        const cap = lineCapacity(move.line);
        const target = bestColumnBy(wall, move.line, move.colour, free, rng, (next, col) => tileScore(next, move.line, col));
        const rowValue = 0.45 * (fill + 1) ** 2 + (fill + 1 === SIZE ? 8 : 0);
        if (after === cap) value += 0.4 * target.value + rowValue + (SIZE - cap) * 0.3;
        else value += (after / cap) * (0.5 * rowValue) + 0.15 * preview.put;
      }
      value += rng() * 0.15;
      if (!best || value > best.value) best = { source: move.source, colour: move.colour, line: move.line, value };
    }
    return best ? { source: best.source, colour: best.colour, line: best.line } : null;
  },
  chooseColumn: (state, seat, pending, rng) =>
    chooseColumnBy(state, seat, pending, rng, (wall, col) => tileScore(wall, pending.row, col) + 1.5 * wall[pending.row].filter((c) => c !== null).length),
};
