// "Standard": the original Splendour computer player. A sensible all-rounder that scores every legal move from the
// value of the cards on the table (points, discounts, progress towards a noble) and how close it is to affording them.
import { CARD_BY_ID, NOBLE_BY_ID } from '../cards.js';
import { GOLD, boardCards, me, opponents, overflowOf, payment, peakNeeds, pickBest, returnByNeeds, sum, targetsOf } from './lib.js';

/** How much a card is worth having: points, a discount, and progress towards a noble. */
function cardValue(s, card) {
  const bonuses = me(s).bonuses;
  let value = card.points * 3 + 1;
  for (const id of s.nobles) {
    const required = NOBLE_BY_ID[id].requires[card.bonus];
    if (required && bonuses[card.bonus] < required) value += 0.8;
  }
  if (bonuses[card.bonus] >= 5) value -= 0.7; // another discount in a colour we hold plenty of is worth less
  // A discount is worth more when cards on the table cost that colour.
  value += Math.min(1.5, boardCards(s).filter((c) => c.cost[card.bonus] > 0).length * 0.25);
  return value;
}

const threatened = (s, card) => opponents(s).some((p) => payment(p, card));

function plan(s) {
  const list = targetsOf(s)
    .map((t) => ({ ...t, score: cardValue(s, t.card) / (t.short + 1) ** 1.3 }))
    .sort((a, b) => b.score - a.score);
  const wants = [0, 0, 0, 0, 0];
  list.slice(0, 2).forEach((t, rank) => t.missing.forEach((m, c) => (wants[c] = Math.max(wants[c], rank === 0 ? m : Math.min(m, 1)))));
  return { list, best: list[0], wants };
}

function scoreMove(s, move, p) {
  const player = me(s);
  const overflow = (gain) => overflowOf(s, gain);
  const wants = p.wants;
  if (move.type === 'buy') {
    const card = CARD_BY_ID[move.card];
    const quote = payment(player, card);
    return 10 + cardValue(s, card) - sum(quote.pay.slice(0, 5)) * 0.15 - quote.pay[GOLD] * 0.9;
  }
  if (move.type === 'take') {
    const gain = move.colours.reduce((total, c) => total + (wants[c] > 0 ? 1 + Math.min(wants[c], 2) * 0.4 : 0.1), 0);
    return gain - overflow(move.colours.length);
  }
  if (move.type === 'takeTwo') return (wants[move.colour] >= 2 ? 3.2 : wants[move.colour] === 1 ? 1.3 : 0.2) - overflow(2);
  if (move.type === 'reserve') {
    const gold = s.supply[GOLD] > 0 ? 1 : 0;
    const penalty = overflow(gold);
    if (move.card === undefined) return 0.3 + gold * 0.3 - penalty;
    const card = CARD_BY_ID[move.card];
    const target = p.list.find((t) => t.id === move.card);
    let value = 0.4 + gold * 0.4;
    if (target === p.best && target.short <= 2 + gold) value += 2.2 + target.card.points * 0.3;
    else if (card.points >= 3 && threatened(s, card)) value += 1.6 + card.points * 0.25;
    return value - penalty;
  }
  return -100;
}

/** Every legal move with its score (no randomness), for the AIs that build on this one. */
export function scoreMoves(s) {
  const p = plan(s);
  return s.moves.map((move) => ({ move, score: scoreMove(s, move, p) }));
}

export default {
  id: 'standard',
  name: 'Standard',
  description: 'A sensible all-rounder: buys good cards, collects the gems it needs and reserves what it is about to afford.',
  weight: 3,
  chooseMove(s, rng) {
    if (!s.moves.length) return { type: 'pass' };
    const p = plan(s);
    return pickBest(s.moves, (move) => scoreMove(s, move, p), rng);
  },
  /** Which tokens to give back: surplus colours first, the colours the best cards need next, Gold last. */
  chooseReturn(s) {
    return returnByNeeds(s, peakNeeds(plan(s).list.slice(0, 3)));
  },
  chooseNoble(s) {
    return s.options[0];
  },
};
