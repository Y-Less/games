// The strongest: expected-value discards (every starter, plus a sampled crib), pegging that looks one reply ahead,
// and an eye on the board: it grabs a winning peg, and plays safe when an opponent is close to going out.
import { pipValue, scorePlay } from '../scoring.js';
import { averageHandScore, cribEstimate, hashedRng, splits, unseenFrom } from './helpers.js';
import { peggingValues } from './pegger.js';

const SAMPLES = 60;
const CLOSE = 12;

export const sharp = {
  id: 'sharp',
  name: 'Sharp',
  description: 'Works out the expected value of every discard and looks a reply ahead when pegging, with an eye on the score.',
  weight: 1.5,
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
