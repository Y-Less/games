// Under-nominates (so it is rarely forced to win tricks it does not want), then plays carefully to hit exactly.
import { nearestAllowed } from './cards.js';
import { lastChanceBoost } from './endgame.js';
import { chooseCard, estimateTricks } from './standard.js';

export const cautious = {
  id: 'cautious',
  name: 'Cautious',
  description: 'Nominates fewer tricks than its hand is probably worth, and ducks the moment it has enough.',
  weight: 1,
  nominate(ctx) {
    const { hand, trump, players, allowed, rng = Math.random } = ctx;
    const boost = lastChanceBoost(ctx);
    // with nothing to lose there is no point in being cautious: the hand is simply read at its boosted weight
    const estimate = boost ? estimateTricks(hand, trump, players, boost) : estimateTricks(hand, trump, players) * 0.7 - 0.25 + (rng() - 0.5) * 0.3;
    return nearestAllowed(allowed, Math.max(0, estimate));
  },
  play: (ctx) => chooseCard(ctx),
};
