// The original computer player: a discard that balances hand against crib, and a pegging rule of thumb.
// Depends on shared/cards.js, ../scoring.js, and ./helpers.js.  Its functions are also re-exported by ./index.js and ../bot.js.
import { fullDeck } from '../../../shared/cards.js';
import { pipValue, runOrder, scoreHand, scorePlay } from '../scoring.js';
import { splits } from './helpers.js';

/** How much a guess at the crib's worth counts against the hand's average score: below 1, because the guess is rough. */
const CRIB_WEIGHT = 0.8;

/**
 * A rough guide to what a crib containing these discards is worth to whoever owns it.  Pairs, fifteens, fives, neighbouring ranks
 * (run material), and a shared suit all add value, the bonuses being roughly their share of a typical crib's score.
 *
 * @param {string[]} discards  one or two cards this player is putting in the crib
 * @returns {number} the estimated points the cards add to the crib
 * Side effects: none.
 */
export function cribPotential(discards) {
  // With a single discard (three or four players) only a five is really useful to the crib.
  if (discards.length === 1) return pipValue(discards[0]) === 5 ? 1.3 : 0.4;
  const [a, b] = discards;
  let value = 0;
  if (a.slice(0, -1) === b.slice(0, -1)) value += 2;
  if (pipValue(a) + pipValue(b) === 15) value += 2;
  for (const card of discards) if (pipValue(card) === 5) value += 0.7;
  const gap = Math.abs(runOrder(a) - runOrder(b));
  if (gap === 1) value += 0.8;
  else if (gap === 2) value += 0.4;
  if (a.slice(-1) === b.slice(-1)) value += 0.3;
  return value;
}

/**
 * Picks the cards to put in the crib: the choice whose kept hand is worth most on average over every starter that
 * could turn up, nudged by how much the crib is likely to be worth (good for the dealer, bad for everyone else).
 *
 * @param {string[]} hand  the dealt cards
 * @param {object} opts  the discard context
 * @param {number} opts.discardCount  how many cards to discard
 * @param {boolean} opts.isDealer  whether the crib is this player's
 * @returns {string[]} the cards to discard
 * Side effects: none.
 */
export function chooseDiscard(hand, { discardCount, isDealer }) {
  const unseen = fullDeck().filter((card) => !hand.includes(card));
  let best = null;
  for (const { keep, discards } of splits(hand, discardCount)) {
    let sum = 0;
    for (const starter of unseen) sum += scoreHand(keep, starter).total;
    const value = sum / unseen.length + (isDealer ? 1 : -1) * CRIB_WEIGHT * cribPotential(discards);
    if (!best || value > best.value) best = { value, discards };
  }
  return best.discards;
}

/**
 * Picks the card to play, or null when none is legal.  Prefers points, avoids leaving a count of 5, 10 or 21 (an easy
 * fifteen or thirty-one for the next player), and otherwise plays low when leading and high when following.
 * Leading low keeps big cards back; following high gets them out when they are least dangerous.
 *
 * @param {string[]} hand  the cards still held
 * @param {object} state  the play context
 * @param {number} state.count  the running count
 * @param {string[]} state.sequence  the cards played since the count last reset
 * @returns {string | null} the card, or null when none can be played
 * Side effects: none.
 */
export function choosePlay(hand, { count, sequence }) {
  let best = null;
  for (const card of hand) {
    if (count + pipValue(card) > 31) continue;
    const { count: newCount, total } = scorePlay([...sequence, card]);
    let value = total;
    // At 5 or 10 a ten-card or a five gives the next player a fifteen, and at 21 a ten gives them thirty-one, so the position costs about a point.
    if (newCount === 5 || newCount === 10 || newCount === 21) value -= 0.9;
    value += sequence.length === 0 ? -pipValue(card) * 0.03 : pipValue(card) * 0.01;
    if (!best || value > best.value) best = { value, card };
  }
  return best?.card ?? null;
}

export const standard = {
  id: 'standard',
  name: 'Standard',
  description: 'Keeps the best hand with a nod to the crib, and pegs for points while avoiding easy fifteens.',
  weight: 3,
  // The AI interface passes one context object; the rules above take the hand separately.
  discard: (ctx) => chooseDiscard(ctx.hand, ctx),
  play: (ctx) => choosePlay(ctx.hand, ctx),
};
