// Counts cards: works out, from what is still unseen, how likely each card in its hand is to win a trick, and uses
// that both to nominate and to decide when to win and when to duck.
import { isJoker, rankValue, suitOf } from '../../../shared/cards.js';
import { highest, lowest, nearestAllowed, strength, unseenCards, winningCard } from './cards.js';
import { withLastChance } from './endgame.js';
import { canTakeAllSeven } from './standard.js';

/**
 * The chance that `card` wins a trick it is played to, given the cards `unseen` and `others` opponents who each hold
 * `held` cards, and `after` of whom have still to play (so only those can beat it).
 */
export function winChance(card, { trump, unseen, others, held, after = others }) {
  const suit = suitOf(card);
  const total = unseen.length || 1;
  const jokersOut = unseen.filter(isJoker).length;
  // A Joker that someone still to play holds beats the card or cancels the Joker, if they are in a position to play it.
  const jokerThreat = Math.min(1, (after * held) / total) * 0.4;
  if (isJoker(card)) return 1 - (jokersOut ? jokerThreat : 0);
  const higher = unseen.filter((c) => suitOf(c) === suit && rankValue(c) > rankValue(card)).length;
  const perCard = Math.min(1, (after * held) / total);
  let chance = (1 - perCard) ** higher;
  if (trump && suit !== trump && after > 0) {
    const inSuit = unseen.filter((c) => suitOf(c) === suit).length;
    const inTrump = unseen.filter((c) => suitOf(c) === trump).length;
    const void_ = (1 - inSuit / total) ** held;
    const hasTrump = 1 - (1 - inTrump / total) ** held;
    chance *= (1 - void_ * hasTrump) ** after;
  }
  return chance * (1 - jokerThreat) ** jokersOut;
}

/** Expected tricks for a hand: the sum of each card's chance of winning. */
export function countTricks(hand, trump, players, played = [], jokers = false, boost = 0) {
  const unseen = unseenCards(hand, played, jokers);
  const others = players - 1;
  let total = 0;
  for (const card of hand) total += Math.min(1, winChance(card, { trump, unseen, others, held: hand.length }) + boost); // each card's weight turned up by `boost`
  return Math.min(total, hand.length);
}

export const counter = {
  id: 'counter',
  name: 'Counter',
  description: 'Counts the cards that are still out to judge its chance of winning each trick, and plays the cheapest card that does the job.',
  weight: 1,
  nominate(ctx) {
    const { hand, trump, players, allowed, instantWin = false, jokers = false, rng = Math.random } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => nearestAllowed(allowed, countTricks(hand, trump, players, [], jokers, boost) + (rng() - 0.5) * 0.2));
  },
  play({ hand, legal, trick, trump, played, need, players, jokers = false }) {
    if (legal.length === 1) return legal[0];
    const unseen = unseenCards(hand, played, jokers);
    const others = players - 1;
    const held = hand.length;
    const after = players - trick.length - 1;
    const chanceOf = (card) => {
      if (trick.length && winningCard([...trick, card], trump) !== card) return 0;
      // Beating the table now only matters if the players still to come cannot beat it.
      return winChance(card, { trump, unseen, others, held: Math.max(1, held - 1), after });
    };
    const scored = legal.map((card) => ({ card, chance: chanceOf(card) }));
    if (need > 0) {
      const top = Math.max(...scored.map((s) => s.chance));
      if (top <= 0) return lowest(legal, trump);
      const good = scored.filter((s) => s.chance >= top - 0.05).map((s) => s.card);
      return lowest(good, trump);
    }
    const bottom = Math.min(...scored.map((s) => s.chance));
    const safe = scored.filter((s) => s.chance <= bottom + 0.02).map((s) => s.card);
    return highest(safe, trump);
  },
};
