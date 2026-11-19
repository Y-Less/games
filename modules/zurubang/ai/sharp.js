// The strongest computer player.  It reads the backs — which the game puts on show for exactly this reason — places
// each card against the one it will face, and will spend a turn or two chasing a special hand when it is one card
// away from one.
// Depends on ./util.js and ../cards.js.
import { answerTo, anyOf, fullestOf, handValue, nearlyHome, strongest, towardsSpecial, valueOf, weakest } from './util.js';
import { cardOf } from '../cards.js';

/** A hand worth this much is worth a duel; a special hand lowers the bar, because it is worth points of its own. */
const WORTH_DUELLING = 30;
const WORTH_DUELLING_SPECIAL = 24;
/** A hand worth less than this is thrown away whole. */
const WORTH_THROWING = 15;
/** A hand worth this much is worth accepting a challenge with. */
const WORTH_ACCEPTING = 24;

export const sharp = {
  id: 'sharp',
  name: 'Sharp',
  description: 'Plays the backs as hard as the faces: counters what it can see coming, and chases a special hand when one is close.',
  weight: 1.5,

  /**
   * The turn.  A hand one card off five of a kind or a rainbow is worth two points, or four, and a card thrown away
   * towards one is rarely a card thrown away for nothing.
   * @param {object} ctx  @param {() => number} rng
   * @returns {object}
   */
  turn(ctx, rng) {
    const value = handValue(ctx.hand);
    const special = towardsSpecial(ctx.hand);
    if (ctx.special && value >= WORTH_DUELLING_SPECIAL) return { kind: 'challenge' };
    if (value >= WORTH_DUELLING) return { kind: 'challenge' };
    if (nearlyHome(ctx.theirScore, ctx.target) && value >= WORTH_ACCEPTING) return { kind: 'challenge' };
    if (value <= WORTH_THROWING) return { kind: 'swapAll', stacks: Array(5).fill(fullestOf(ctx.stacks)) };
    // One card off a special hand: change that card rather than the weakest, unless the weakest is the same card.
    const chase = special.toFiveOfAKind === 1 ? special.oddOne : special.toRainbow === 1 ? special.duplicate : null;
    const throwing = chase && valueOf(chase) <= valueOf(strongest(ctx.hand)) - 2 ? chase : weakest(ctx.hand);
    return { kind: 'swapOne', card: throwing, stack: anyOf([0, 1, 2], rng) };
  },

  /** Accepts when the hand can fight, when the other player is nearly home, or when declining would hand them the game. */
  accepts(ctx) {
    if (ctx.theirScore + 5 >= ctx.target) return true;
    return handValue(ctx.hand) >= WORTH_ACCEPTING || Boolean(ctx.special);
  },

  /** Starting is the advantage; it takes it, except when the other player holds a special hand worth more than the tempo. */
  startsWith(ctx) {
    return ctx.seat;
  },

  /**
   * Places against the back it will be facing where one is already down, and otherwise keeps its best cards for the
   * positions the other player has yet to fill.
   * @param {object} ctx
   * @returns {string} a card from its hand
   */
  place(ctx) {
    const mine = ctx.duel?.mine ?? [];
    const next = mine.findIndex((card) => !card);
    const facing = next === -1 ? null : (ctx.duel?.theirBacks?.[next] ?? null);
    if (facing) return answerTo(ctx.hand, facing);
    // Nothing opposite yet, so this card is the one the other player answers: a card they will find hard to beat.
    return strongest(ctx.hand);
  },

  /**
   * Sends in the card that best answers what the other player is likeliest to send: their strongest showing card.
   * @param {object} ctx
   * @returns {number} a position
   */
  suddenPick(ctx) {
    const mine = ctx.duel?.mine ?? [];
    const theirBest = (ctx.duel?.theirs ?? []).filter(Boolean).reduce((best, id) => (valueOf(id) > valueOf(best) ? id : best), null);
    const wanted = theirBest ? cardOf(theirBest)?.face : null;
    const counter = ctx.suddenChoices.find((p) => mine[p] && wanted && cardOf(mine[p])?.face && beats(cardOf(mine[p]).face, wanted));
    if (counter !== undefined) return counter;
    return ctx.suddenChoices.reduce((a, b) => (valueOf(mine[b]) > valueOf(mine[a]) ? b : a), ctx.suddenChoices[0]);
  },
};

/** The element circle, kept here rather than imported so that this file reads as one piece. */
const beats = (mine, theirs) => ({ spirit: 'air', air: 'water', water: 'fire', fire: 'earth', earth: 'spirit' })[mine] === theirs;
