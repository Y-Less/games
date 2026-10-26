// Takes the clue at face value: plays the card whose category suits the word best, and suspects the card that
// suits it least. Knows nothing about the other players, and bluffs at random when it cannot see the word.
import { best, clueStrength, fitter, pick } from './util.js';

export const literal = {
  id: 'literal',
  name: 'Literal',
  description: 'Matches the clue word to each card\'s category. Plays the best fit and distrusts the worst.',
  weight: 2,
  chooseWord: ({ hints, cards }, rng) => best(hints, (hint) => clueStrength(hint, cards), rng),
  playCard({ word, hand, cards }, rng) {
    const fit = fitter(word, cards);
    return fit ? best(hand, fit, rng) : pick(hand, rng);
  },
  vote({ word, table, targets, judging, cards }, rng) {
    const fit = fitter(word, cards);
    if (!fit) return pick(targets, rng);
    const cardOf = Object.fromEntries(table.map((row) => [row.playerId, row.cardId]));
    const sign = judging === 'favourite' ? 1 : -1; // favourite: the best fit; otherwise the worst fit is the bluffer
    return best(targets, (id) => sign * fit(cardOf[id]), rng);
  },
};
