// Knows whose crib it is: keeps what helps its own crib, and starves an opponent's crib of fives, pairs, and runs.
// Depends on ./helpers.js (hand and crib estimates) and ./standard.js (it pegs exactly as the standard player does).
import { averageHandScore, cribEstimate, hashedRng, splits, unseenFrom } from './helpers.js';
import { standard } from './standard.js';

/** How many random cribs are dealt per candidate discard: enough to rank the options, cheap enough to run for every split. */
const SAMPLES = 24;

export const balanced = {
  id: 'balanced',
  name: 'Balanced',
  description: 'Weighs its hand against the crib: feeds its own crib, and avoids giving fives and pairs to an opponent\'s.',
  weight: 1,
  /**
   * Chooses the cards to put in the crib by expected hand score plus (dealer) or minus (not dealer) the estimated crib.
   *
   * @param {object} ctx  the discard context from the game
   * @param {string[]} ctx.hand  the dealt cards
   * @param {number} ctx.discardCount  how many cards to discard
   * @param {boolean} ctx.isDealer  whether the crib is this player's
   * @param {number} [ctx.players=2]  table size; the crib hurts each non-dealer only a share as much with more players
   * @returns {string[]} the cards to discard
   * Side effects: none (the crib sampling uses a generator seeded from the hand, so it answers the same way each time).
   */
  discard({ hand, discardCount, isDealer, players = 2 }) {
    const unseen = unseenFrom(hand);
    const rng = hashedRng(hand.join(','));
    // With more players the crib belongs to one dealer but hurts every other player only a little.
    const sign = isDealer ? 1 : -1 / Math.max(1, players - 1);
    let best = null;
    for (const { keep, discards } of splits(hand, discardCount)) {
      const value = averageHandScore(keep, unseen) + sign * cribEstimate(discards, unseen, SAMPLES, rng);
      if (!best || value > best.value) best = { value, discards };
    }
    return best.discards;
  },
  // Pegging is not this player's speciality, so it borrows the standard rule of thumb.
  play: (ctx) => standard.play(ctx),
};
