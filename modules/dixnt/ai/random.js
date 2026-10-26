// Every decision is a uniform random choice among the legal ones. It behaves like the standard bot (which is also
// random) but is kept as its own AI so it can be asked for by name and weighted separately.
import { pick } from './util.js';

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Just picks a random legal move every time.',
  weight: 0.5,
  chooseWord: ({ hints }, rng) => pick(hints, rng),
  playCard: ({ hand }, rng) => pick(hand, rng),
  vote: ({ targets }, rng) => pick(targets, rng),
};
