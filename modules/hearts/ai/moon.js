// 'Moon': always tries to shoot the moon. It passes its weakest cards and keeps long, strong suits, wins tricks (above all
// those that carry hearts or the Queen of Spades), never gives a heart away and, once the attempt is clearly dead
// (somebody else has taken a point card, or too many tricks are out of reach), plays like the standard AI.
import { rankValue, suitOf } from '../../../shared/cards.js';
import { QUEEN, SEATS, SUIT_LIST, TRICKS, avoiding, bySuit, highest, isHeart, isPointCard, lowest, observe, preferring } from './util.js';
import standard from './standard.js';

/** How many tricks this hand can count on: cards that outrank everything still unseen in their suit. */
export function sureTricks(ctx, know = observe(ctx)) {
  let sure = 0;
  for (const suit of SUIT_LIST) {
    const mine = bySuit(ctx.hand, suit).sort((a, b) => rankValue(b) - rankValue(a));
    const others = [...know.unseen].filter((c) => suitOf(c) === suit).map(rankValue);
    for (const card of mine) {
      if (others.some((r) => r > rankValue(card))) break;
      sure++;
    }
  }
  return sure;
}

/** Is the attempt still alive? Only while nobody else has taken a point card, and the tricks to come look winnable. */
export function moonAlive(ctx, know = observe(ctx)) {
  const { seat, taken, trick } = ctx;
  if (taken.some((cards, s) => s !== seat && cards.some(isPointCard))) return false;
  if (trick.length) {
    const led = suitOf(trick[0].card);
    const best = Math.max(...trick.filter((p) => suitOf(p.card) === led).map((p) => rankValue(p.card)));
    const rival = trick.find((p) => p.seat !== seat && suitOf(p.card) === led && rankValue(p.card) === best);
    // A point card already under another player's winning card, which this hand cannot beat, is the end of the attempt.
    if (rival && trick.some((p) => isPointCard(p.card))) {
      const canBeat = ctx.legal.some((c) => suitOf(c) === led && rankValue(c) > best);
      if (!canBeat) return false;
    }
  }
  const left = TRICKS - ctx.tricksPlayed;
  if (ctx.tricksPlayed >= 3 && left - sureTricks(ctx, know) >= 5) return false;
  return true;
}

function passMoon({ hand }) {
  const length = (suit) => hand.filter((c) => suitOf(c) === suit).length;
  // Keep strong, long suits and hearts; the cards worth least to a moon attempt are passed.
  const keep = (card) => rankValue(card) * 1.5 + length(suitOf(card)) * 2.5 + (isHeart(card) ? 4 : 0) + (card === QUEEN ? 8 : 0);
  return [...hand].sort((a, b) => keep(a) - keep(b)).slice(0, 3);
}

function playMoon(ctx) {
  const { legal, trick, hand } = ctx;
  if (legal.length === 1) return legal[0];
  const know = observe(ctx);
  if (!moonAlive(ctx, know)) return standard.choosePlay({ ...ctx, moonBid: null });

  const suitLength = (suit) => hand.filter((c) => suitOf(c) === suit).length;
  const isMaster = (card) => !know.unseen.has(card) && ![...know.unseen].some((o) => suitOf(o) === suitOf(card) && rankValue(o) > rankValue(card));

  if (!trick.length) {
    const masters = legal.filter(isMaster);
    // Cash winners from the side suits first (drawing out the high cards), hearts afterwards.
    const sideMasters = masters.filter((c) => !isHeart(c));
    const pool = sideMasters.length ? sideMasters : masters;
    if (pool.length) return pool.reduce((best, c) => (suitLength(suitOf(c)) > suitLength(suitOf(best)) || (suitLength(suitOf(c)) === suitLength(suitOf(best)) && rankValue(c) > rankValue(best)) ? c : best));
    const options = avoiding(legal, isHeart);
    return highest(preferring(options, (c) => suitLength(suitOf(c)) === Math.max(...options.map((o) => suitLength(suitOf(o))))));
  }

  const led = suitOf(trick[0].card);
  const following = legal.filter((c) => suitOf(c) === led);
  if (following.length) {
    const best = Math.max(...trick.filter((p) => suitOf(p.card) === led).map((p) => rankValue(p.card)));
    const winning = following.filter((c) => rankValue(c) > best);
    if (!winning.length) return lowest(following);
    const last = trick.length === SEATS - 1;
    if (last) return lowest(winning);
    // Not last: the cheapest card that nobody left can beat, otherwise the highest.
    const safe = winning.filter(isMaster);
    return safe.length ? lowest(safe) : highest(winning);
  }
  // Cannot follow: shed the least useful non-point card; hearts and the Queen are only played onto a trick this seat wins.
  const junk = legal.filter((c) => !isPointCard(c));
  const options = junk.length ? junk : legal;
  const value = (c) => rankValue(c) + suitLength(suitOf(c)) * 3;
  return options.reduce((best, c) => (value(c) < value(best) ? c : best));
}

export default {
  id: 'moon',
  name: 'Moon shooter',
  description: 'Always tries to shoot the moon: keeps long strong suits, wins tricks, and gives up only when the attempt is clearly dead.',
  weight: 1,
  choosePass: passMoon,
  choosePlay: playMoon,
};
