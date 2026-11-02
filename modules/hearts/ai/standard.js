// 'Standard': the original Hearts computer player.  Leads low, ducks tricks that carry points, flushes out the Queen of
// Spades with low spades, dumps the Queen and high hearts when it cannot follow suit, and (rarely) chases every point
// when its hand is overwhelming.
import { rankValue, suitOf } from '../../../shared/cards.js';
import { JACK, QUEEN, avoiding, highest, isHeart, isPointCard, lowest, passSize, playedSet, seatsIn } from './util.js';

/**
 * Strong enough to try for all the points?  Very rare: this is a gamble that only an overwhelming hand justifies.  The
 * bar (written for 13 cards: five hearts, six kings or aces) scales with the number of cards in the hand.
 * @param {string[]} hand  the cards held (before passing).
 * @returns {boolean} true if the hand is overwhelming enough to go for the moon.
 * Side effects: none.
 */
export function wantsMoon(hand) {
  const hearts = hand.filter(isHeart);
  const top = hand.filter((c) => rankValue(c) >= 13).length;
  const share = hand.length / 13;
  return hearts.length >= Math.max(3, Math.ceil(5 * share)) && hearts.includes('AH') && hearts.includes('KH') && top >= Math.max(4, Math.ceil(6 * share)) && hand.includes(QUEEN);
}

/**
 * The cards to pass (3, or 2 with 6 or 7 players): the dangerous ones (Queen of Spades, high spades, high hearts), then
 * the highest others.  A moon-worthy hand passes its lowest cards instead, keeping the strength.
 * @param {object} ctx  AI context (see index.js); uses hand, settings, and passCount.
 * @returns {string[]} the cards to pass.
 * Side effects: none.
 */
export function passStandard(ctx) {
  const { hand, settings } = ctx;
  const count = passSize(ctx);
  if (wantsMoon(hand)) return [...hand].sort((a, b) => rankValue(a) - rankValue(b)).slice(0, count);
  const spades = hand.filter((c) => suitOf(c) === 'S');
  // How much this card wants to be passed (higher = worse to keep).  A long spade suit makes the Queen's spades safe to keep.
  const danger = (card) => {
    if (card === QUEEN) return 100;
    if (settings?.jackOfDiamonds && card === JACK) return -100;
    const rank = rankValue(card);
    if (suitOf(card) === 'S') return !hand.includes(QUEEN) || spades.length < 5 ? (rank >= 13 ? 60 + rank : rank) : -20;
    if (isHeart(card)) return rank >= 10 ? 40 + rank : rank / 2;
    return rank;
  };
  return [...hand].sort((a, b) => danger(b) - danger(a)).slice(0, count);
}

/**
 * Standard play: lead low and safe, duck point tricks, and when void dump the most dangerous card.  When this seat has
 * bid the moon (ctx.chasingMoon) it does the reverse and wins tricks.
 * @param {object} ctx  AI context (see index.js); uses legal, trick, seat, hand, settings, chasingMoon, taken, and rng.
 * @returns {string} one card from ctx.legal.
 * Side effects: advances ctx.rng (random choice between equally low leads).
 */
export function playStandard(ctx) {
  const { legal, trick, seat, hand } = ctx;
  if (legal.length === 1) return legal[0];
  const rng = ctx.rng;
  const jackOfDiamonds = ctx.settings.jackOfDiamonds;
  const chasing = ctx.chasingMoon === true;
  // Removes the Jack of Diamonds from the options (it is worth -5, so it is kept to win with) when that option is on.
  const notJack = (cards) => (jackOfDiamonds ? avoiding(cards, (c) => c === JACK) : cards);
  // Picks uniformly at random from a list, so equal-value leads vary from game to game.
  const pick = (cards) => cards[Math.floor(rng() * cards.length)];

  if (trick.length === 0) {
    if (chasing) return highest(avoiding(legal, isHeart));
    const played = playedSet(ctx);
    const lowSpades = legal.filter((c) => suitOf(c) === 'S' && rankValue(c) < 12);
    if (lowSpades.length && !hand.includes(QUEEN) && !played.has(QUEEN)) return lowest(lowSpades);
    let options = notJack(legal);
    if (hand.includes(QUEEN)) options = avoiding(options, (c) => suitOf(c) === 'S');
    options = avoiding(options, isHeart);
    const floor = rankValue(lowest(options));
    return pick(options.filter((c) => rankValue(c) === floor));
  }

  const led = suitOf(trick[0].card);
  const following = legal.filter((c) => suitOf(c) === led);
  if (following.length) {
    const best = Math.max(...trick.filter((p) => suitOf(p.card) === led).map((p) => rankValue(p.card)));
    const last = trick.length === seatsIn(ctx) - 1;
    const winning = following.filter((c) => rankValue(c) > best);
    const ducking = following.filter((c) => rankValue(c) < best);
    if (chasing) return winning.length ? highest(winning) : lowest(following);
    if (jackOfDiamonds && led === 'D' && trick.some((p) => p.card === JACK) && !trick.some((p) => isPointCard(p.card)) && winning.length) {
      return last ? lowest(winning) : highest(winning);
    }
    if (ducking.length) return highest(notJack(ducking));
    return last ? highest(avoiding(following, (c) => c === QUEEN)) : lowest(avoiding(following, (c) => c === QUEEN));
  }

  const queenGone = playedSet(ctx).has(QUEEN) || hand.includes(QUEEN);
  // How much this seat wants to shed the card when void: Queen first, then high spades while the Queen is out, then hearts by rank.
  const worry = (card) => {
    if (chasing) return -rankValue(card) - (isPointCard(card) ? 100 : 0);
    if (card === QUEEN) return 1000;
    if (jackOfDiamonds && card === JACK) return -1000;
    if (suitOf(card) === 'S' && rankValue(card) >= 13 && !queenGone) return 700 + rankValue(card);
    if (isHeart(card)) return 500 + rankValue(card) * 10;
    return rankValue(card) * 10;
  };
  return legal.reduce((best, card) => (worry(card) > worry(best) ? card : best));
}

export default {
  id: 'standard',
  name: 'Standard',
  description: 'Plays safe: leads low, ducks tricks with points, flushes out the Queen of Spades and dumps danger cards when it cannot follow suit.',
  weight: 3,
  // The standard AI only bids for the moon with an overwhelming hand.
  bidsMoon: (ctx) => wantsMoon(ctx.hand),
  choosePass: passStandard,
  choosePlay: playStandard,
};
