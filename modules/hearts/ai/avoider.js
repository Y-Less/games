// 'Avoider': avoid points at all costs. Passes hearts, the Queen and high spades, ducks every trick it can, and when it
// cannot follow suit it dumps its penalty cards (always safe: a player who cannot follow can never win the trick).
// It also holds its high hearts back while only one player has taken points (see pointTakers): dumping them on the
// lone point-taker could hand them the moon, so it sheds other cards first.
import { rankValue, suitOf } from '../../../shared/cards.js';
import { JACK, QUEEN, avoiding, bySuit, highest, isHeart, lowest, passSize, playedSet, pointTakers, seatsIn } from './util.js';

function passAvoider(ctx) {
  const { hand, settings } = ctx;
  const spades = bySuit(hand, 'S');
  const hasQueen = hand.includes(QUEEN);
  const danger = (card) => {
    const rank = rankValue(card);
    if (card === QUEEN) return hasQueen && spades.length >= 6 ? 20 : 100;
    if (settings?.jackOfDiamonds && card === JACK) return -100;
    if (suitOf(card) === 'S') return rank >= 13 ? 80 + rank : hasQueen && spades.length >= 5 ? -10 : rank - 5;
    if (isHeart(card)) return rank >= 10 ? 50 + rank : rank / 2; // low hearts are the safest cards to hold: they duck
    // Short suits are worth emptying: a void lets this player dump penalty cards later.
    const length = hand.filter((c) => suitOf(c) === suitOf(card)).length;
    return rank + (length <= 2 ? 12 - length * 3 : 0);
  };
  return [...hand].sort((a, b) => danger(b) - danger(a)).slice(0, passSize(ctx));
}

function playAvoider(ctx) {
  const { legal, trick, hand, seat } = ctx;
  if (legal.length === 1) return legal[0];
  const jackOn = ctx.settings.jackOfDiamonds;
  const keepJack = (cards) => (jackOn ? avoiding(cards, (c) => c === JACK) : cards);
  const played = playedSet(ctx);

  if (!trick.length) {
    const safe = avoiding(keepJack(legal), isHeart);
    const noSpadeRisk = hand.includes(QUEEN) ? avoiding(safe, (c) => suitOf(c) === 'S') : safe;
    // Flush the Queen out with a low spade when it is not mine.
    const lowSpade = !hand.includes(QUEEN) && !played.has(QUEEN) ? noSpadeRisk.filter((c) => suitOf(c) === 'S' && rankValue(c) < 12) : [];
    if (lowSpade.length) return lowest(lowSpade);
    return lowest(noSpadeRisk);
  }

  const led = suitOf(trick[0].card);
  const following = legal.filter((c) => suitOf(c) === led);
  if (following.length) {
    const best = Math.max(...trick.filter((p) => suitOf(p.card) === led).map((p) => rankValue(p.card)));
    const last = trick.length === seatsIn(ctx) - 1;
    const ducking = following.filter((c) => rankValue(c) < best);
    if (ducking.length) return highest(keepJack(ducking));
    // Forced to win: take it as low as possible unless last, when nobody can overtake and the highest card is shed.
    return last ? highest(avoiding(following, (c) => c === QUEEN)) : lowest(avoiding(following, (c) => c === QUEEN));
  }

  // Cannot follow suit: dump. The Queen first, then the highest heart, then spades that could catch the Queen. While a
  // single player owns every point so far, that player is likely to be winning this trick, so feeding them hearts
  // risks a moon: shed other high cards instead (when it has nothing else to play, it dumps them anyway).
  const takers = pointTakers(ctx);
  const lone = takers.size === 1 && !takers.has(seat);
  const clean = legal.filter((c) => !isHeart(c) && c !== QUEEN);
  const holdBack = lone && clean.length > 0;
  if (!holdBack && legal.includes(QUEEN)) return QUEEN;
  const hearts = holdBack ? [] : legal.filter(isHeart);
  const nonHearts = holdBack ? clean : legal.filter((c) => !isHeart(c));
  if (hearts.length) return highest(hearts);
  const highSpades = legal.filter((c) => suitOf(c) === 'S' && rankValue(c) >= 13 && !played.has(QUEEN));
  if (highSpades.length) return highest(highSpades);
  // Otherwise shed the highest card of the shortest suit, which leads towards a void.
  const length = (card) => hand.filter((c) => suitOf(c) === suitOf(card)).length;
  const options = keepJack(nonHearts.length ? nonHearts : legal);
  return options.reduce((best, c) => (length(c) < length(best) || (length(c) === length(best) && rankValue(c) > rankValue(best)) ? c : best));
}

export default {
  id: 'avoider',
  name: 'Avoider',
  description: 'Avoids points at all costs: passes hearts, the Queen and high spades, ducks every trick and dumps penalty cards on others.',
  weight: 1,
  choosePass: passAvoider,
  choosePlay: playAvoider,
};
