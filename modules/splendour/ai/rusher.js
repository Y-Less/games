// "Rusher": goes for prestige as fast as it can. It buys any card that is worth points as soon as it can afford it,
// collects gems for the card with the best points-per-turn, and reserves a card to stop an opponent taking the points.
import { CARD_BY_ID } from '../cards.js';
import { GOLD, me, opponents, overflowOf, payment, peakNeeds, pickBest, returnByNeeds, sum, targetsOf } from './lib.js';

function plan(s) {
  const ranked = targetsOf(s)
    .map((t) => ({ ...t, aim: (t.card.points + 0.2) / (t.short + 1) ** 1.2 }))
    .sort((a, b) => b.aim - a.aim);
  const wants = [0, 0, 0, 0, 0];
  ranked.slice(0, 2).forEach((t, rank) => t.missing.forEach((m, c) => (wants[c] = Math.max(wants[c], rank === 0 ? m : Math.min(m, 1)))));
  return { ranked, wants };
}

/** How much it would hurt to let an opponent have this card: its points, and more still if it would put them on the target. */
function denial(s, card) {
  let worst = 0;
  for (const p of opponents(s)) {
    if (!payment(p, card)) continue;
    worst = Math.max(worst, card.points + (p.prestige + card.points >= s.target ? 4 : 0));
  }
  return worst;
}

function chooseMove(s, rng) {
  if (!s.moves.length) return { type: 'pass' };
  const player = me(s);
  const { ranked, wants } = plan(s);
  const score = (move) => {
    if (move.type === 'buy') {
      const card = CARD_BY_ID[move.card];
      const quote = payment(player, card);
      const paid = sum(quote.pay.slice(0, 5)) * 0.1 + quote.pay[GOLD] * 0.5;
      // A card with points is bought at once, the biggest first; a plain card only when nothing better is possible.
      return card.points > 0 ? 12 + card.points * 3 - paid : 2.5 - paid + (wants[card.bonus] === 0 ? 0 : 0.5);
    }
    if (move.type === 'take') return move.colours.reduce((total, c) => total + (wants[c] > 0 ? 1 + Math.min(wants[c], 2) * 0.5 : 0.05), 0) - overflowOf(s, move.colours.length);
    if (move.type === 'takeTwo') return (wants[move.colour] >= 2 ? 3.4 : wants[move.colour] === 1 ? 1.2 : 0.1) - overflowOf(s, 2);
    const gold = s.supply[GOLD] > 0 ? 1 : 0;
    const penalty = overflowOf(s, gold);
    if (move.card === undefined) return 0.2 + gold * 0.3 - penalty;
    const card = CARD_BY_ID[move.card];
    const target = ranked.find((t) => t.id === move.card);
    let value = 0.3 + gold * 0.4;
    const deny = denial(s, card);
    if (deny >= 3) value += 3 + deny * 1.0; // an opponent is about to buy it: take it away
    else if (target === ranked[0] && target.short <= 2 + gold && card.points >= 2) value += 2 + card.points * 0.4;
    return value - penalty;
  };
  return pickBest(s.moves, score, rng);
}

export default {
  id: 'rusher',
  name: 'Rusher',
  description: 'All about prestige: buys any card worth points the moment it can, and reserves cards to deny opponents.',
  weight: 2,
  chooseMove,
  chooseReturn(s) {
    return returnByNeeds(s, peakNeeds(plan(s).ranked.slice(0, 2)));
  },
  chooseNoble(s) {
    return s.options[0];
  },
};
