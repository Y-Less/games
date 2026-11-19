// The everyday computer player, and the fallback for a room saved before an AI existed or with one since removed.
// It keeps a strong hand, throws the weakest card away, duels once the hand is worth duelling, and places its best
// cards nearest the stacks so that the fights it is likeliest to win come first.
// Depends on ./util.js.
import { anyOf, fullestOf, handValue, nearlyHome, strongest, weakest } from './util.js';

/** A hand worth this much is worth a duel. */
const WORTH_DUELLING = 32;
/** A hand worth less than this is not worth keeping at all. */
const WORTH_THROWING = 17;
/** A hand worth this much is worth accepting a challenge with. */
const WORTH_ACCEPTING = 26;

export const standard = {
  id: 'standard',
  name: 'Standard',
  description: 'Keeps a strong hand, throws its weakest card away, and duels once its hand is worth it.',
  weight: 2,

  /**
   * The turn: duel on a strong hand, throw the whole hand away on a hopeless one, and otherwise change the worst card.
   * @param {object} ctx  @param {() => number} rng
   * @returns {object} the move
   */
  turn(ctx, rng) {
    const value = handValue(ctx.hand);
    // Somebody one good duel from home has to be challenged rather than waited out.
    if (value >= WORTH_DUELLING || (nearlyHome(ctx.theirScore, ctx.target) && value >= WORTH_ACCEPTING)) return { kind: 'challenge' };
    if (value <= WORTH_THROWING) return { kind: 'swapAll', stacks: Array(5).fill(fullestOf(ctx.stacks)) };
    return { kind: 'swapOne', card: weakest(ctx.hand), stack: anyOf([0, 1, 2], rng) };
  },

  /** Accepts a challenge on a hand worth fighting with, and always when five points would take the other player home. */
  accepts(ctx) {
    if (ctx.theirScore + 5 >= ctx.target) return true;
    return handValue(ctx.hand) >= WORTH_ACCEPTING;
  },

  /** Starting is the advantage, so it takes it. */
  startsWith(ctx) {
    return ctx.seat;
  },

  /** Puts its best cards down first, where the fights begin. */
  place(ctx) {
    return strongest(ctx.hand);
  },

  /** Sends its strongest card into the sudden death. */
  suddenPick(ctx) {
    const best = ctx.suddenChoices.reduce((a, b) => (valueAt(ctx, b) > valueAt(ctx, a) ? b : a), ctx.suddenChoices[0]);
    return best;
  },
};

/** What the card standing at one of this player's positions is worth. */
const valueAt = (ctx, position) => handValue([ctx.duel?.mine?.[position]].filter(Boolean));
