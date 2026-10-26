// The strongest AI. It reads the clue like the literal AI, and also reads the table: players who saw the word play
// cards that cluster around it, so the odd one out is probably the bluffer. Ties are broken by player id rather than
// at random, so several sharp bots in one game all accuse the same person (the group needs a strict plurality to
// catch the imposter). A sharp bot that was itself the imposter does the same, which steers the vote onto a decoy.
import { best, clueStrength, fitter, oddness, pick } from './util.js';

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const sharp = {
  id: 'sharp',
  name: 'Sharp',
  description: 'Matches clues to categories, then spots the odd one out on the table. Several sharp bots agree on a suspect.',
  weight: 2,
  chooseWord: ({ hints, cards }, rng) => best(hints, (hint) => clueStrength(hint, cards), rng),
  playCard({ word, hand, cards }, rng) {
    if (word === null) {
      // Bluffing blind: stay with the category the hand holds most of, the likeliest to overlap with somebody.
      const counts = {};
      for (const id of hand) counts[cards.categoryOf[id]] = (counts[cards.categoryOf[id]] ?? 0) + 1;
      return best(hand, (id) => counts[cards.categoryOf[id]], rng);
    }
    const fit = fitter(word, cards);
    return fit ? best(hand, fit, rng) : pick(hand, rng);
  },
  vote({ word, table, targets, judging, cards }) {
    const cardOf = Object.fromEntries(table.map((row) => [row.playerId, row.cardId]));
    const fit = fitter(word, cards);
    const ordered = [...targets].sort(byId);
    if (judging === 'favourite') return best(ordered, (id) => (fit ? fit(cardOf[id]) : 0));
    const odd = oddness(table, cards);
    return best(ordered, (id) => (fit ? 2 * (1 - fit(cardOf[id])) : 0) + odd[id]);
  },
};
