// The strongest: expected-value discards (every starter, plus a sampled crib), pegging that looks one reply ahead,
// and an eye on the board: it grabs a winning peg, and plays safe when an opponent is close to going out.
// Depends on ../scoring.js, ./helpers.js, and the pegging evaluation in ./pegger.js.
import { pipValue, scorePlay } from '../scoring.js';
import { averageHandScore, cribEstimate, hashedRng, splits, unseenFrom } from './helpers.js';
import { peggingValues } from './pegger.js';

/** Random cribs scored per candidate discard: more than balanced uses, as this player is meant to be the most accurate. */
const SAMPLES = 60;
/** Within this many points of the target, the board position starts to change the strategy. */
const CLOSE = 12;

export const sharp = {
  id: 'sharp',
  name: 'Sharp',
  description: 'Works out the expected value of every discard and looks a reply ahead when pegging, with an eye on the score.',
  weight: 1.5,
  /**
   * Chooses the discard by expected hand score plus or minus a crib estimate, with the crib's weight adjusted for the score.
   *
   * @param {object} ctx  the discard context from the game
   * @param {string[]} ctx.hand  the dealt cards
   * @param {number} ctx.discardCount  how many cards to discard
   * @param {boolean} ctx.isDealer  whether the crib is this player's
   * @param {number} [ctx.players=2]  table size
   * @param {number[]} [ctx.scores=[]]  every seat's current score
   * @param {number} [ctx.me=0]  this player's seat
   * @param {number} [ctx.target=121]  the winning score
   * @returns {string[]} the cards to discard
   * Side effects: none (crib sampling is seeded from the hand).
   */
  discard({ hand, discardCount, isDealer, players = 2, scores = [], me = 0, target = 121 }) {
    const unseen = unseenFrom(hand);
    const rng = hashedRng(hand.join(','));
    const mine = scores[me] ?? 0;
    const rivals = scores.filter((_, seat) => seat !== me);
    const bestRival = rivals.length ? Math.max(...rivals) : 0;
    let cribWeight = isDealer ? 1 : 1 / Math.max(1, players - 1);
    // The player who counts first wins a close finish: a non-dealer near home counts its hand before any crib is scored.
    if (!isDealer && target - mine <= CLOSE) cribWeight *= 0.4;
    // A dealer whose opponent is close to going out needs its own hand and crib to land, but cannot hope to out-count the pone.
    if (isDealer && target - bestRival <= CLOSE) cribWeight *= 0.8;
    const sign = isDealer ? 1 : -1;
    let best = null;
    for (const { keep, discards } of splits(hand, discardCount)) {
      const value = averageHandScore(keep, unseen) + sign * cribWeight * cribEstimate(discards, unseen, SAMPLES, rng);
      if (!best || value > best.value) best = { value, discards };
    }
    return best.discards;
  },
  /**
   * Plays a card that wins the game outright if there is one, otherwise the best pegging value with weights tilted by the score:
   * points matter more when this player is near home, and a reply matters more when a rival is near home.
   *
   * @param {object} ctx  the play context (see peggingValues), plus scores, me, and target
   * @returns {string | null} the card, or null when none can be played
   * Side effects: none.
   */
  play(ctx) {
    const { hand, count, sequence, scores = [], me = 0, target = 121 } = ctx;
    const legal = hand.filter((card) => count + pipValue(card) <= 31);
    if (!legal.length) return null;
    const mine = scores[me] ?? 0;
    const winning = legal.find((card) => mine + scorePlay([...sequence, card]).total >= target);
    if (winning) return winning;
    const rivals = scores.filter((_, seat) => seat !== me);
    const bestRival = rivals.length ? Math.max(...rivals) : 0;
    const values = peggingValues({
      ...ctx,
      pointsWeight: target - mine <= CLOSE ? 1.3 : 1,
      dangerWeight: target - bestRival <= CLOSE ? 1.5 : 1,
    });
    return values.reduce((a, b) => (b.value > a.value ? b : a)).card;
  },
};
