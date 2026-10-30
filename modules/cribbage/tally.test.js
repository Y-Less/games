import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreHand } from './scoring.js';
import { newTally, tallyDeal, tallyDiscard, tallyShown } from './tally.js';

const show = (tally, kind, hand, starter) => tallyShown(tally, kind, scoreHand(hand, starter, { crib: kind === 'crib' }));

test('only fives given to somebody else count, and not by the dealer', () => {
  const tally = newTally();
  tallyDiscard(tally, ['5H', 'KS'], false);
  tallyDiscard(tally, ['5C', '5D'], true);
  tallyDiscard(tally, ['10H', 'JS'], false);
  assert.equal(tally.fivesGiven, 1);
});

test('a hand scoring nothing, a perfect hand, a flush of five and his nobs are counted', () => {
  const tally = newTally();
  show(tally, 'hand', ['2C', '4D', '8H', 'KS'], 'QD'); // 19 hand
  show(tally, 'crib', ['2C', '4D', '8H', 'KS'], 'QD');
  assert.equal(tally.zeroHands, 2);
  show(tally, 'hand', ['5C', '5D', '5S', 'JH'], '5H'); // the perfect 29, with his nobs
  assert.equal(tally.perfectHands, 1);
  assert.equal(tally.nobs, 1);
  assert.equal(tally.bestHand, 29);
  show(tally, 'hand', ['2H', '4H', '8H', 'KH'], '9H');
  show(tally, 'crib', ['2H', '4H', '8H', 'KH'], '9D'); // no flush of four in the box
  assert.equal(tally.fiveFlushes, 1);
});

test('a deal with no points at all is a nineteen', () => {
  const tally = newTally();
  tallyDeal(tally, 0);
  tallyDeal(tally, 3);
  assert.equal(tally.nineteens, 1);
});
