// Over-nominates: it assumes the cards will fall its way, and fights for every trick it has promised.
import { nearestAllowed } from './cards.js';
import { withLastChance } from './endgame.js';
import { canTakeAllSeven, chooseCard, estimateTricks } from './standard.js';

/** The optimist AI: reads the hand generously (x1.1 plus nearly half a trick) and then plays the standard way to win what it promised. */
export const optimist = {
  id: 'optimist',
  name: 'Optimist',
  description: 'Nominates more tricks than its hand is probably worth, and goes all out to win them.',
  weight: 1,
  /**
   * Nominates above the hand's estimated worth, or 7 when it can take every trick and the instant win is on.
   *
   * @param {object} ctx  nomination context: hand, trump, players, allowed, instantWin, rng, plus the endgame fields
   * @returns {number} the nomination, always one of ctx.allowed
   * Side effects: advances ctx.rng.
   */
  nominate(ctx) {
    const { hand, trump, players, allowed, instantWin = false, rng } = ctx;
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    return withLastChance(ctx, (boost) => nearestAllowed(allowed, Math.min(hand.length, estimateTricks(hand, trump, players, boost) * 1.1 + 0.45 + (rng() - 0.5) * 0.3)));
  },
  /**
   * Plays as the standard AI does (it wins whenever it still needs tricks).
   *
   * @param {object} ctx  play context (see chooseCard in standard.js)
   * @returns {string} the card to play
   * Side effects: none.
   */
  play: (ctx) => chooseCard(ctx),
};
