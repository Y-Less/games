// "Denier": plays against the table. It values tiles an opponent needs to finish a pattern line (and so score on the
// wall): taking the last of a colour they are building leaves them to overflow on to their floor. Its own board comes
// second, but it will not drop tiles on the floor for nothing.
import { lineCapacity, tileScore } from '../rules.js';
import { bestColumnBy, chooseColumnBy, takeOf, tilesLeft } from './common.js';

/** How much taking `count` tiles of a colour from a source hurts the other players' unfinished lines. */
function denial(state, seat, move, count) {
  const left = tilesLeft(state, move.colour, move.source);
  let hurt = 0;
  state.lines.forEach((lines, other) => {
    if (other === seat) return;
    lines.forEach((l, i) => {
      if (l.colour !== move.colour || l.count >= lineCapacity(i)) return;
      const need = lineCapacity(i) - l.count;
      const progress = (l.count + 1) / lineCapacity(i);
      if (left < need) hurt += progress * (1.5 + need); // they can no longer finish this round
      else hurt += 0.3 * Math.min(need, count) * progress;
    });
  });
  return hurt;
}

export default {
  id: 'denier',
  name: 'Denier',
  description: 'Takes the tiles its opponents are waiting for, so their lines go unfinished and their leftovers fall on the floor.',
  weight: 1.5,
  chooseMove(state, seat, moves, rng) {
    const free = state.settings.freeWall;
    const wall = state.walls[seat];
    let best = null;
    for (const move of moves) {
      const { count, preview } = takeOf(state, seat, move);
      let value = -0.8 * preview.extraPenalty + 1.4 * denial(state, seat, move, count);
      if (move.line !== 'floor') {
        const after = state.lines[seat][move.line].count + preview.put;
        const cap = lineCapacity(move.line);
        const target = bestColumnBy(wall, move.line, move.colour, free, rng, (next, col) => tileScore(next, move.line, col));
        value += after === cap ? 0.6 * target.value + 0.5 : 0.25 * target.value * (after / cap) + 0.1 * preview.put;
      }
      value += rng() * 0.15;
      if (!best || value > best.value) best = { source: move.source, colour: move.colour, line: move.line, value };
    }
    return best ? { source: best.source, colour: best.colour, line: best.line } : null;
  },
  chooseColumn: (state, seat, pending, rng) => chooseColumnBy(state, seat, pending, rng, (wall, col) => tileScore(wall, pending.row, col)),
};
