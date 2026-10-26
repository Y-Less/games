// "Engine builder": the long game. Early on it buys the cheapest cards it can to build up a discount in every colour
// (so that later cards cost almost nothing), and only once the engine is running does it go for the big point cards.
import { CARD_BY_ID } from '../cards.js';
import { GOLD, boardCards, me, overflowOf, payment, peakNeeds, pickBest, returnByNeeds, sum, targetsOf } from './lib.js';

const ENGINE_SIZE = 9; // cards bought before it switches from building to scoring

function building(s) {
  const player = me(s);
  return player.bought < ENGINE_SIZE && player.prestige < 8;
}

function chooseMove(s, rng) {
  if (!s.moves.length) return { type: 'pass' };
  const player = me(s);
  const build = building(s);
  // What to aim for: the cheapest cards while building, the best points per missing gem afterwards.
  const ranked = targetsOf(s)
    .map((t) => ({
      ...t,
      aim: build ? (t.card.level === 3 ? -9 : 3 - sum(t.need) * 0.5 - t.short * 0.9 + t.card.points * 0.3) : (t.card.points * 2 + 0.5) / (t.short + 1),
    }))
    .sort((a, b) => b.aim - a.aim);
  const wants = [0, 0, 0, 0, 0];
  ranked.slice(0, 2).forEach((t, rank) => t.missing.forEach((m, c) => (wants[c] = Math.max(wants[c], rank === 0 ? m : Math.min(m, 1)))));
  const lowest = Math.min(...player.bonuses); // the colours it has the fewest cards of are the most useful to add
  const onTable = boardCards(s);
  const score = (move) => {
    if (move.type === 'buy') {
      const card = CARD_BY_ID[move.card];
      const quote = payment(player, card);
      const paid = sum(quote.pay.slice(0, 5)) * 0.15 + quote.pay[GOLD] * 0.9;
      if (build) {
        const spread = player.bonuses[card.bonus] === lowest ? 1.2 : player.bonuses[card.bonus] >= 4 ? -1.2 : 0;
        const wanted = Math.min(1.5, onTable.filter((c) => c.cost[card.bonus] > 0).length * 0.25);
        return 10 + spread + wanted + card.points * 0.3 - (card.level === 3 ? 3 : 0) - paid - sum(quote.need) * 0.45;
      }
      return 10 + card.points * 3 + (card.level - 1) * 0.3 - paid;
    }
    if (move.type === 'take') return move.colours.reduce((total, c) => total + (wants[c] > 0 ? 1 + Math.min(wants[c], 2) * 0.4 : 0.1), 0) - overflowOf(s, move.colours.length);
    if (move.type === 'takeTwo') return (wants[move.colour] >= 2 ? 3 : wants[move.colour] === 1 ? 1.2 : 0.2) - overflowOf(s, 2);
    // Reserving only pays once the engine is running, to lock in a big card it is nearly able to afford.
    const gold = s.supply[GOLD] > 0 ? 1 : 0;
    if (move.card === undefined) return 0.2 + gold * 0.3 - overflowOf(s, gold);
    const target = ranked.find((t) => t.id === move.card);
    const lock = !build && target === ranked[0] && target.short <= 3 ? 2.4 : 0;
    return 0.3 + gold * 0.4 + lock - overflowOf(s, gold);
  };
  return pickBest(s.moves, score, rng);
}

export default {
  id: 'engine-builder',
  name: 'Engine builder',
  description: 'Plays the long game: cheap cards first to build up discounts in every colour, then big point cards.',
  weight: 2,
  chooseMove,
  chooseReturn(s) {
    const cheap = targetsOf(s).sort((a, b) => sum(a.need) - sum(b.need)).slice(0, 3);
    return returnByNeeds(s, peakNeeds(cheap));
  },
  chooseNoble(s) {
    return s.options[0];
  },
};
