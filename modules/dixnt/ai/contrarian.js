// Deliberately hard to read. It gives vague clues, plays cards that only half fit the word (so nobody can tell
// a bluff from a real play), and suspects whoever played the card that fits the clue a little too well.
import { best, clueStrength, fitter, pick } from './util.js';

export const contrarian = {
  id: 'contrarian',
  name: 'Contrarian',
  description: 'Gives vague clues, plays ambiguous cards and suspects whoever fits the clue too neatly.',
  weight: 1,
  chooseWord: ({ hints, cards }, rng) => best(hints, (hint) => -clueStrength(hint, cards), rng),
  playCard({ word, hand, cards }, rng) {
    const fit = fitter(word, cards);
    return fit ? best(hand, (cardId) => -Math.abs(fit(cardId) - 0.5), rng) : pick(hand, rng);
  },
  vote({ word, table, targets, judging, cards }, rng) {
    const fit = fitter(word, cards);
    if (!fit) return pick(targets, rng);
    const cardOf = Object.fromEntries(table.map((row) => [row.playerId, row.cardId]));
    // In the favourite style the chooser picks the most interesting card: the one that is neither obvious nor off.
    if (judging === 'favourite') return best(targets, (id) => -Math.abs(fit(cardOf[id]) - 0.5), rng);
    return best(targets, (id) => fit(cardOf[id]), rng);
  },
};
