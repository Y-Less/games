// "Greedy": only the points on offer right now. A move that completes a line is worth the wall score of its tile, less
// the floor; a move that does not is worth almost nothing. It never plans for bonuses and never blocks anyone.
import { tileScore } from '../rules.js';
import { bestColumnBy, chooseColumnBy, takeOf } from './common.js';

export default {
  id: 'greedy',
  name: 'Greedy',
  description: 'Takes whatever scores the most wall points straight away, and avoids the floor. No plans beyond the current round.',
  weight: 2,
  chooseMove(state, seat, moves, rng) {
    let best = null;
    const free = state.settings.freeWall;
    for (const move of moves) {
      const { preview } = takeOf(state, seat, move);
      let value = -preview.extraPenalty;
      if (move.line !== 'floor') {
        if (preview.completes) {
          const target = bestColumnBy(state.walls[seat], move.line, move.colour, free, rng, (wall, col) => tileScore(wall, move.line, col));
          value += target.value + 0.5;
        } else value += 0.1 * preview.put;
      }
      value += rng() * 0.1;
      if (!best || value > best.value) best = { source: move.source, colour: move.colour, line: move.line, value };
    }
    return best ? { source: best.source, colour: best.colour, line: best.line } : null;
  },
  chooseColumn: (state, seat, pending, rng) => chooseColumnBy(state, seat, pending, rng, (wall, col) => tileScore(wall, pending.row, col)),
};
