// The risk-taker the rulebook names: throws the whole hand away often, duels early and often, and places its cards
// where nobody can read them.  It loses more duels than it wins and is thoroughly unpleasant to plan against, which
// is the point of it.
// Depends on ./util.js.
import { anyOf, fullestOf, handValue } from './util.js';

/** How often it simply duels, whatever it is holding. */
const DUEL_CHANCE = 0.35;
/** How often it throws the whole hand away, which costs a point and tells the other player nothing. */
const DUMP_CHANCE = 0.25;

export const hasardeur = {
  id: 'hasardeur',
  name: 'Hasardeur',
  description: 'Trusts its luck: duels early, throws whole hands away to stay unreadable, and places its cards at random.',
  weight: 1,

  /** The turn, mostly on a roll of the dice, though it will not pass up a hand that is already very strong. */
  turn(ctx, rng) {
    if (handValue(ctx.hand) >= 38) return { kind: 'challenge' };
    const roll = rng();
    if (roll < DUEL_CHANCE) return { kind: 'challenge' };
    if (roll < DUEL_CHANCE + DUMP_CHANCE) return { kind: 'swapAll', stacks: Array(5).fill(fullestOf(ctx.stacks)) };
    return { kind: 'swapOne', card: anyOf(ctx.hand, rng), stack: anyOf([0, 1, 2], rng) };
  },

  /** Never turns a duel down: five points to the other player is a certainty, and a duel is not. */
  accepts() {
    return true;
  },

  /** Gives the first card away as often as not, because being read is worse than being second. */
  startsWith(ctx, rng) {
    return rng() < 0.5 ? ctx.seat : (ctx.seat === 0 ? 1 : 0);
  },

  /** Places at random, which is the one order nobody can plan against. */
  place(ctx, rng) {
    return anyOf(ctx.hand, rng);
  },

  /** Picks a card out of the air, which is what a sudden death is for. */
  suddenPick(ctx, rng) {
    return anyOf(ctx.suddenChoices, rng);
  },
};
