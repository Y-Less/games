// "Blocker": plays like the standard player, but watches the other seats. It reserves the cards an opponent is about to
// buy (especially point cards that would put them on the target), buys those cards itself when it can, and keeps nobles
// out of reach by taking the cards an opponent needs to complete one.
import { CARD_BY_ID } from '../cards.js';
import { me, nobleGap, nobleList, opponents, payment, peakNeeds, returnByNeeds, targetsOf } from './lib.js';
import { scoreMoves } from './standard.js';

/** How much an opponent would gain from this card: 0 if they cannot get it soon. */
function threat(s, card) {
  let worst = 0;
  for (const p of opponents(s)) {
    let soon = 0;
    if (payment(p, card)) soon = 1;
    else if (targetsOf(s, p).find((t) => t.card === card)?.short <= 1) soon = 0.4;
    if (!soon) continue;
    let value = card.points * 1.1;
    if (p.prestige + card.points >= s.target) value += 4;
    // Finishing a noble for them is worth three points too.
    for (const noble of nobleList(s)) {
      if (nobleGap(p.bonuses, noble) === 1 && noble.requires[card.bonus] && p.bonuses[card.bonus] < noble.requires[card.bonus]) value += 3;
    }
    worst = Math.max(worst, value * soon);
  }
  return worst;
}

export default {
  id: 'blocker',
  name: 'Blocker',
  description: 'Watches the other players: reserves the cards they are about to buy and keeps nobles out of their reach.',
  weight: 2,
  chooseMove(s, rng) {
    if (!s.moves.length) return { type: 'pass' };
    let best = null;
    let bestScore = -Infinity;
    for (const { move, score } of scoreMoves(s)) {
      let value = score;
      if (move.type === 'buy') value += threat(s, CARD_BY_ID[move.card]) * 0.7;
      else if (move.type === 'reserve' && move.card !== undefined) value += threat(s, CARD_BY_ID[move.card]) * 1.1;
      value += rng() * 0.35;
      if (value > bestScore) {
        best = move;
        bestScore = value;
      }
    }
    return best;
  },
  chooseReturn(s) {
    return returnByNeeds(s, peakNeeds(targetsOf(s).slice(0, 3)));
  },
  /** Of several nobles, the one an opponent is closest to getting. */
  chooseNoble(s) {
    const rivals = opponents(s);
    const closeness = (id) => Math.max(0, ...rivals.map((p) => 6 - nobleGap(p.bonuses, nobleList({ nobles: [id] })[0])));
    return [...s.options].sort((a, b) => closeness(b) - closeness(a))[0];
  },
};
