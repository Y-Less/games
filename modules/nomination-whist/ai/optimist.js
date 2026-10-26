// Over-nominates: it assumes the cards will fall its way, and fights for every trick it has promised.
import { nearestAllowed } from './cards.js';
import { canTakeAllSeven, chooseCard, estimateTricks } from './standard.js';

export const optimist = {
  id: 'optimist',
  name: 'Optimist',
  description: 'Nominates more tricks than its hand is probably worth, and goes all out to win them.',
  weight: 1,
  nominate({ hand, trump, players, allowed, instantWin = false, rng = Math.random }) {
    if (instantWin && allowed.includes(7) && canTakeAllSeven(hand, trump)) return 7;
    const estimate = estimateTricks(hand, trump, players) * 1.1 + 0.45 + (rng() - 0.5) * 0.3;
    return nearestAllowed(allowed, Math.min(hand.length, estimate));
  },
  play: (ctx) => chooseCard(ctx),
};
