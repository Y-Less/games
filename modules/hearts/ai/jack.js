// 'Jack hunter': goes after the Jack of Diamonds (-5) whenever that option is on, and otherwise plays like the standard
// AI. It keeps its diamonds when passing, and whenever the Jack is still out and it holds a diamond it looks ahead (as
// Sharp does) valuing the Jack far above its real -5, which makes it lead diamonds to flush the Jack out, play its own
// Jack only when it will win the trick, and take a trick that holds the Jack even at the cost of a few hearts. When
// the option is off it is exactly the standard AI.
import { rankValue, suitOf } from '../../../shared/cards.js';
import { JACK, bySuit } from './util.js';
import standard, { passStandard } from './standard.js';
import { lookAhead } from './sharp.js';

const HUNGER = 16; // what the Jack is worth to this AI when choosing a card

function passJack(ctx) {
  if (!ctx.settings.jackOfDiamonds) return passStandard(ctx);
  // Pass like the standard AI but never give away diamonds worth hunting with.
  const diamonds = new Set(bySuit(ctx.hand, 'D'));
  const pass = passStandard(ctx);
  if (!pass.some((c) => diamonds.has(c))) return pass;
  const keep = pass.filter((c) => !diamonds.has(c));
  const rest = ctx.hand.filter((c) => !diamonds.has(c) && !keep.includes(c)).sort((a, b) => rankValue(b) - rankValue(a));
  const filler = ctx.hand.filter((c) => diamonds.has(c) && !keep.includes(c)).sort((a, b) => rankValue(a) - rankValue(b));
  return [...keep, ...rest, ...filler].slice(0, 3);
}

function playJack(ctx) {
  const { legal, settings, taken } = ctx;
  if (!settings.jackOfDiamonds || legal.length === 1) return standard.choosePlay(ctx);
  const jackGone = taken.some((cards) => cards.includes(JACK));
  const hasDiamond = legal.some((c) => suitOf(c) === 'D');
  if (!jackGone && hasDiamond) return lookAhead(ctx, { jackValue: HUNGER });
  return standard.choosePlay(ctx);
}

export default {
  id: 'jack',
  name: 'Jack hunter',
  description: 'Hunts the Jack of Diamonds when that option is on (otherwise plays like Standard): keeps and leads diamonds to catch it.',
  weight: 1,
  bidsMoon: (ctx) => standard.bidsMoon(ctx),
  choosePass: passJack,
  choosePlay: playJack,
};
