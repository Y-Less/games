// "Random": any legal move, chosen uniformly (including the floor), and any legal column.
import { pickOne } from './common.js';

export default {
  id: 'random',
  name: 'Random',
  description: 'Picks any legal move at random. Never plans, never blocks, often fills its own floor.',
  weight: 0.5,
  chooseMove(state, seat, moves, rng) {
    if (!moves.length) return null;
    const { source, colour, line } = pickOne(moves, rng);
    return { source, colour, line };
  },
  chooseColumn: (state, seat, pending, rng) => pickOne(pending.columns, rng),
};
