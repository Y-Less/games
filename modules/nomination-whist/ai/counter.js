// Counts cards: works out, from what is still unseen, how likely each card in its hand is to win a trick, and uses
// that both to nominate and to decide when to win and when to duck.
import { isJoker, rankValue, suitOf } from '../../../shared/cards.js';
import { highest, lowest, nearestAllowed, strength, unseenCards, winningCard } from './cards.js';
import { withLastChance } from './endgame.js';
import { canTakeAllSeven } from './standard.js';

/**
 * The chance that `card` wins a trick it is played to, given the cards `unseen` and `others` opponents who each hold
 * `held` cards, and `after` of whom have still to play (so only those can beat it).
 *
 * @param {string} card  the card being played
 * @param {object} situation  what is known about the table
 * @param {string | null} situation.trump  the trump suit, or null
 * @param {string[]} situation.unseen  cards the player cannot see (any opponent may hold them)
 * @param {number} situation.others  the number of opponents
 * @param {number} situation.held  how many cards each opponent holds
 * @param {number} [situation.after]  how many opponents have still to play to this trick (default all of them)
 * @returns {number} a probability from 0 to 1
 * Side effects: none.
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

/**
 * Expected tricks for a hand: the sum of each card's chance of winning.
 *
 * @param {string[]} hand  the player's cards
 * @param {string | null} trump  the trump suit, or null
 * @param {number} players  the number of players at the table
 * @param {string[]} [played=[]]  cards already played this round
 * @param {boolean} [jokers=false]  whether the Jokers are in the pack
 * @param {number} [boost=0]  added to every card's chance (capped at 1), used by the last-chance logic
 * @returns {number} the expected number of tricks, at most the hand size
 * Side effects: none.
 */
export function countTricks(hand, trump, players, played = [], jokers = false, boost = 0) {
  const unseen = unseenCards(hand, played, jokers);
  const others = players - 1;
  let total = 0;
  for (const card of hand) total += Math.min(1, winChance(card, { trump, unseen, others, held: hand.length }) + boost); // each card's weight turned up by `boost`
  return Math.min(total, hand.length);
}

/** The counting AI: card-counting probabilities drive both the nomination and the choice between winning and ducking. */
export const counter = {
  id: 'counter',
  name: 'Counter',
  description: 'Counts the cards that are still out to judge its chance of winning each trick, and plays the cheapest card that does the job.',
  weight: 1,
  /**
   * Nominates the counted expectation (with a little noise), or 7 when it can take every trick and the instant win is on.
   *
   * @param {object} ctx  nomination context: hand, trump, players, allowed, instantWin, jokers, rng, plus the endgame fields
   * @returns {number} the nomination, always one of ctx.allowed
   * Side effects: advances ctx.rng.
   */
  nominate(ctx) {
    const { hand, trump, players, allowed, instantWin = false, jokers = false, rng } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => nearestAllowed(allowed, countTricks(hand, trump, players, [], jokers, boost) + (rng() - 0.5) * 0.2));
  },
  /**
   * Plays the cheapest card that does the job: while it still needs tricks, the weakest card among those near the best win
   * chance; once it has enough, the strongest card among those least likely to win (so it sheds danger and keeps its low cards).
   *
   * @param {object} ctx  play context: hand, legal, trick, trump, played, need (tricks still wanted), players, jokers
   * @returns {string} the card to play
   * Side effects: none.
   */
  play({ hand, legal, trick, trump, played, need, players, jokers = false }) {
    if (legal.length === 1) return legal[0];
    const unseen = unseenCards(hand, played, jokers);
    const others = players - 1;
    const held = hand.length;
    const after = players - trick.length - 1;
    // The chance this card wins the trick: zero if it cannot beat the table so far, else its win chance against those yet to play.
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
