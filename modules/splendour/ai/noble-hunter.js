// "Noble hunter": picks the noble that is closest to visiting and buys the cards of the colours it still needs, since
// a noble is worth three points for no gems at all. Once no noble is left to chase it plays like the standard player.
import { CARD_BY_ID } from '../cards.js';
import { GOLD, me, nobleGap, nobleList, opponents, overflowOf, payment, pickBest, returnByNeeds, sum, targetsOf } from './lib.js';
import standard, { scoreMoves } from './standard.js';

/** The nearest noble and how many more cards of each colour it needs, or null if none is left. */
function goal(s) {
  const bonuses = me(s).bonuses;
  const best = nobleList(s)
    .map((noble) => ({ noble, gap: nobleGap(bonuses, noble) }))
    .sort((a, b) => a.gap - b.gap)[0];
  if (!best) return null;
  const missing = [0, 0, 0, 0, 0];
  for (const [c, n] of Object.entries(best.noble.requires)) missing[c] = Math.max(0, n - bonuses[c]);
  return { ...best, missing };
}

function chooseMove(s, rng) {
  if (!s.moves.length) return { type: 'pass' };
  const aim = goal(s);
  if (!aim || aim.gap === 0) return standard.chooseMove(s, rng);
  const player = me(s);
  // Gems that would help buy cards of the colours the noble needs.
  const wants = [0, 0, 0, 0, 0];
  for (const t of targetsOf(s)) {
    if (aim.missing[t.card.bonus] > 0) t.missing.forEach((m, c) => (wants[c] = Math.max(wants[c], Math.min(m, 2))));
  }
  const fallback = new Map(scoreMoves(s).map(({ move, score }) => [move, score]));
  const score = (move) => {
    if (move.type === 'buy') {
      const card = CARD_BY_ID[move.card];
      const quote = payment(player, card);
      const useful = aim.missing[card.bonus] > 0;
      return (useful ? 15 + aim.missing[card.bonus] * 0.5 : 6) + card.points * 0.8 - sum(quote.pay.slice(0, 5)) * 0.1 - quote.pay[GOLD] * 0.8;
    }
    if (move.type === 'take') return move.colours.reduce((total, c) => total + (wants[c] > 0 ? 1 + wants[c] * 0.3 : 0.1), 0) - overflowOf(s, move.colours.length);
    if (move.type === 'takeTwo') return (wants[move.colour] >= 2 ? 2.6 : 0.2) - overflowOf(s, 2);
    // Reserving: hold on to an expensive card of a colour the noble needs, and take the Gold.
    if (move.card !== undefined && aim.missing[CARD_BY_ID[move.card].bonus] > 0 && player.reservedCount < 2) return 1.8 - overflowOf(s, 1);
    return Math.min(fallback.get(move) ?? 0, 1) - 0.2;
  };
  return pickBest(s.moves, score, rng);
}

export default {
  id: 'noble-hunter',
  name: 'Noble hunter',
  description: 'Chases the nearest noble: buys the cards of the colours it needs and gets the three bonus points for free.',
  weight: 2,
  chooseMove,
  chooseReturn(s) {
    const aim = goal(s);
    const needs = [0, 0, 0, 0, 0];
    for (const t of targetsOf(s)) if (aim && aim.missing[t.card.bonus] > 0) t.need.forEach((n, c) => (needs[c] = Math.max(needs[c], n)));
    return returnByNeeds(s, needs);
  },
  /** When several nobles visit at once: the one an opponent is closest to (so they cannot have it next). */
  chooseNoble(s) {
    const rivals = opponents(s);
    const closeness = (id) => Math.max(0, ...rivals.map((p) => 6 - nobleGap(p.bonuses, nobleList({ nobles: [id] })[0])));
    return [...s.options].sort((a, b) => closeness(b) - closeness(a))[0];
  },
};
