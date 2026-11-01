// "Standard": the original Splendour computer player. A sensible all-rounder that scores every legal move from the
// value of the cards on the table (points, discounts, progress towards a noble) and how close it is to affording them.
// Other AIs (noble-hunter, blocker) build on its scoreMoves export, and bot.js falls back on it when an AI misbehaves.
//
// Depends on: ../cards.js (card and noble data) and ./lib.js (situation helpers).
import { CARD_BY_ID, NOBLE_BY_ID } from '../cards.js';
import { GOLD, boardCards, me, opponents, overflowOf, payment, peakNeeds, pickBest, returnByNeeds, sum, targetsOf } from './lib.js';

/**
 * How much a card is worth having: points, a discount, and progress towards a noble.
 *
 * Side effects: none.
 *
 * @param {object} s     the situation
 * @param {object} card  a card object
 * @returns {number}
 */
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

/**
 * Could any opponent buy this card right now? (If so, reserving it may be worth the turn.)
 *
 * Side effects: none.
 *
 * @param {object} s     the situation
 * @param {object} card  a card object
 * @returns {boolean}
 */
const threatened = (s, card) => opponents(s).some((p) => payment(p, card));

/**
 * Ranks every card the player could aim for and works out which gems they should collect.
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @returns {{ list: object[], best: object, wants: number[] }} the targets best first, the top one, and how many gems of
 *   each colour are wanted
 */
function plan(s) {
  const list = targetsOf(s)
    // Value divided by (tokens still short + 1) to the power 1.3: a card one gem away is worth far more than the same card
    // three gems away, and an exponent above 1 makes nearly-affordable cards win without ignoring big prizes.
    .map((t) => ({ ...t, score: cardValue(s, t.card) / (t.short + 1) ** 1.3 }))
    .sort((a, b) => b.score - a.score);
  const wants = [0, 0, 0, 0, 0];
  list.slice(0, 2).forEach((t, rank) => t.missing.forEach((m, c) => (wants[c] = Math.max(wants[c], rank === 0 ? m : Math.min(m, 1)))));
  return { list, best: list[0], wants };
}

/**
 * Scores one legal move (higher is better); no randomness.
 *
 * Side effects: none.
 *
 * @param {object} s     the situation
 * @param {object} move  one of s.moves
 * @param {object} p     from plan()
 * @returns {number}
 */
function scoreMove(s, move, p) {
  const player = me(s);
  /** The penalty for ending the turn over the token limit after gaining this many tokens. */
  const overflow = (gain) => overflowOf(s, gain);
  const wants = p.wants;
  if (move.type === 'buy') {
    const card = CARD_BY_ID[move.card];
    const quote = payment(player, card);
    // The base of 10 puts every purchase above any gem-taking move (which scores a few points at most); the payment terms then
    // prefer cheaper buys and, above all, avoid spending Gold (0.9 per Gold against 0.15 per ordinary token).
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
    // Reserve the card it is working towards when it is nearly affordable (so nobody can take it), or a valuable card an
    // opponent could buy this very turn (denial).
    if (target === p.best && target.short <= 2 + gold) value += 2.2 + target.card.points * 0.3;
    else if (card.points >= 3 && threatened(s, card)) value += 1.6 + card.points * 0.25;
    return value - penalty;
  }
  return -100;
}

/**
 * Every legal move with its score (no randomness), for the AIs that build on this one.
 *
 * Side effects: none.
 *
 * @param {object} s  the situation
 * @returns {{ move: object, score: number }[]}
 */
export function scoreMoves(s) {
  const p = plan(s);
  return s.moves.map((move) => ({ move, score: scoreMove(s, move, p) }));
}

export default {
  id: 'standard',
  name: 'Standard',
  description: 'A sensible all-rounder: buys good cards, collects the gems it needs and reserves what it is about to afford.',
  weight: 3,
  /**
   * Chooses the best-scoring move, with a little randomness to break ties.
   *
   * Side effects: advances `rng` (one draw per move scored); changes nothing else.
   *
   * @param {object} s  the situation (see lib.js)
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {object} one of s.moves, or { type: 'pass' } when there are none
   */
  chooseMove(s, rng) {
    if (!s.moves.length) return { type: 'pass' };
    const p = plan(s);
    return pickBest(s.moves, (move) => scoreMove(s, move, p), rng);
  },
  /**
   * Which tokens to give back: surplus colours first, the colours the best cards need next, Gold last.
   *
   * Side effects: none.
   *
   * @param {object} s  the situation (uses returnCount)
   * @returns {number[]} six counts summing to s.returnCount
   */
  chooseReturn(s) {
    return returnByNeeds(s, peakNeeds(plan(s).list.slice(0, 3)));
  },
  /**
   * Which noble to take when several visit at once: simply the first offered.
   *
   * Side effects: none.
   *
   * @param {object} s  the situation (uses options)
   * @returns {string} a noble id from s.options
   */
  chooseNoble(s) {
    return s.options[0];
  },
};
