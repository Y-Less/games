// "Blocker": plays like the standard player, but watches the other seats. It reserves the cards an opponent is about to
// buy (especially point cards that would put them on the target), buys those cards itself when it can, and keeps nobles
// out of reach by taking the cards an opponent needs to complete one.
//
// Depends on: ../cards.js (card and noble data), ../rules.js (NOBLE_POINTS), ./lib.js (situation helpers) and ./standard.js
// (scoreMoves, whose scores it adjusts rather than replacing).
import { CARD_BY_ID } from '../cards.js';
import { NOBLE_POINTS } from '../rules.js';
import { me, nobleGap, nobleList, opponents, payment, peakNeeds, returnByNeeds, targetsOf } from './lib.js';
import { scoreMoves } from './standard.js';

/**
 * How much an opponent would gain from this card: 0 if they cannot get it soon.
 *
 * Side effects: none.
 *
 * @param {object} s     the situation
 * @param {object} card  a card object
 * @returns {number} the worst case over all opponents
 */
function threat(s, card) {
  let worst = 0;
  for (const p of opponents(s)) {
    let soon = 0;
    if (payment(p, card)) soon = 1;
    else if (targetsOf(s, p).find((t) => t.card === card)?.short <= 1) soon = 0.4;
    if (!soon) continue;
    // The card's points to them, a little over face value because points also bring a player closer to ending the game...
    let value = card.points * 1.1;
    // ...and a big extra when the card would put them on the target score, since that could lose us the game.
    if (p.prestige + card.points >= s.target) value += 4;
    // Finishing a noble for them is worth the noble's points too.
    for (const noble of nobleList(s)) {
      if (nobleGap(p.bonuses, noble) === 1 && noble.requires[card.bonus] && p.bonuses[card.bonus] < noble.requires[card.bonus]) value += NOBLE_POINTS;
    }
    // Only the most dangerous opponent matters (we can only take one card per turn); "soon" discounts cards they cannot buy
    // yet (1 = they can buy it now, 0.4 = one token short).
    worst = Math.max(worst, value * soon);
  }
  return worst;
}

export default {
  id: 'blocker',
  name: 'Blocker',
  description: 'Watches the other players: reserves the cards they are about to buy and keeps nobles out of their reach.',
  weight: 2,
  /**
   * Plays like the standard player, with a bonus for buying or reserving the cards an opponent is about to get.
   *
   * Side effects: advances `rng` (one draw per move scored); changes nothing else.
   *
   * @param {object} s  the situation (see lib.js)
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {object} one of s.moves, or { type: 'pass' } when there are none
   */
  chooseMove(s, rng) {
    if (!s.moves.length) return { type: 'pass' };
    let best = null;
    let bestScore = -Infinity;
    for (const { move, score } of scoreMoves(s)) {
      let value = score;
      // Buying a card an opponent wants is a bonus (0.7), but reserving it denies them without paying, so it counts more (1.1).
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
  /**
   * Which tokens to give back: keeps the colours the best three cards need.
   *
   * Side effects: none.
   *
   * @param {object} s  the situation (uses returnCount)
   * @returns {number[]} six counts summing to s.returnCount
   */
  chooseReturn(s) {
    return returnByNeeds(s, peakNeeds(targetsOf(s).slice(0, 3)));
  },
  /**
   * Of several nobles, the one an opponent is closest to getting.
   *
   * Side effects: none.
   *
   * @param {object} s  the situation (uses options)
   * @returns {string} a noble id from s.options
   */
  chooseNoble(s) {
    const rivals = opponents(s);
    /** How close the nearest opponent is to this noble (higher is closer). */
    const closeness = (id) => Math.max(0, ...rivals.map((p) => 6 - nobleGap(p.bonuses, nobleList({ nobles: [id] })[0])));
    return [...s.options].sort((a, b) => closeness(b) - closeness(a))[0];
  },
};
