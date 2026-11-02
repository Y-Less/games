// Under-nominates (so it is rarely forced to win tricks it does not want), then plays carefully to hit exactly.
import { nearestAllowed } from './cards.js';
import { withLastChance } from './endgame.js';
import { chooseCard, estimateTricks } from './standard.js';

/**
 * The cautious AI.  Under-reading the hand keeps it from being forced into tricks it did not promise; play reuses the
 * standard card choice, which ducks as soon as the nomination is met.
 */
export const cautious = {
  id: 'cautious',
  name: 'Cautious',
  description: 'Nominates fewer tricks than its hand is probably worth, and ducks the moment it has enough.',
  weight: 1,
  /**
   * Nominates below the hand's estimated worth (x0.7, minus a quarter, plus a little noise), unless the last-chance boost applies.
   *
   * @param {object} ctx  nomination context: hand, trump, players, allowed, rng, plus the endgame fields
   * @returns {number} the nomination, always one of ctx.allowed
   * Side effects: advances ctx.rng.
   */
  nominate(ctx) {
    const { hand, trump, players, allowed, rng } = ctx;
    return withLastChance(ctx, (boost) => {
      // with nothing to lose there is no point in being cautious: the hand is simply read at its boosted weight
      const estimate = boost ? estimateTricks(hand, trump, players, boost) : estimateTricks(hand, trump, players) * 0.7 - 0.25 + (rng() - 0.5) * 0.3;
      return nearestAllowed(allowed, Math.max(0, estimate));
    });
  },
  /**
   * Plays as the standard AI does.
   *
   * @param {object} ctx  play context (see chooseCard in standard.js)
   * @returns {string} the card to play
   * Side effects: none.
   */
  play: (ctx) => chooseCard(ctx),
};
