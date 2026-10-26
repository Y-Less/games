// The original bot: a random hint, a random card from the hand, a random vote.
import { pick } from './util.js';

export const standard = {
  id: 'standard',
  name: 'Standard',
  description: 'Picks a hint word, plays a card and votes at random. The bot as it always was.',
  weight: 3,
  chooseWord: ({ hints }, rng) => pick(hints, rng),
  playCard: ({ hand }, rng) => pick(hand, rng),
  vote: ({ targets }, rng) => pick(targets, rng),
};
