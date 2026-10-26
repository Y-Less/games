// "Random": any legal placement of any pool die, chosen uniformly; never uses a tool; any window.
import { pickOne, placementsOf } from './common.js';

export default {
  id: 'random',
  name: 'Random',
  description: 'Places a random die on a random legal space, never uses a tool and picks its window at random.',
  weight: 0.5,
  chooseWindow: (options, rng) => pickOne(options, rng),
  chooseStep(state, seat, rng) {
    if (state.turn.placements >= (state.turn.extra ? 2 : 1)) return { type: 'end' };
    const options = placementsOf(state, seat);
    if (!options.length) return { type: 'end' };
    const { die, cell } = pickOne(options, rng);
    return { type: 'place', die, cell };
  },
};
