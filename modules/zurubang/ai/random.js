// Picks a legal move and nothing more.  It is here as the floor every other computer player is measured against, and
// as the one that proves the rules never need an AI to be clever to reach the end of a game.
// Depends on ./util.js.
import { anyOf, fullestOf } from './util.js';

/** How often it duels.  Low, but never nothing: a game of two players who never duel is a game that never ends. */
const DUEL_CHANCE = 0.25;

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Plays whatever is legal, with no thought at all.',
  weight: 0.5,

  turn(ctx, rng) {
    const roll = rng();
    if (roll < DUEL_CHANCE) return { kind: 'challenge' };
    if (roll < DUEL_CHANCE + 0.1) return { kind: 'swapAll', stacks: Array(5).fill(fullestOf(ctx.stacks)) };
    return { kind: 'swapOne', card: anyOf(ctx.hand, rng), stack: anyOf([0, 1, 2], rng) };
  },

  accepts(ctx, rng) {
    return rng() < 0.7;
  },

  startsWith(ctx, rng) {
    return rng() < 0.5 ? 0 : 1;
  },

  place(ctx, rng) {
    return anyOf(ctx.hand, rng);
  },

  suddenPick(ctx, rng) {
    return anyOf(ctx.suddenChoices, rng);
  },
};
