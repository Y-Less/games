import test from 'node:test';
import assert from 'node:assert/strict';
import { newTally, tallyRound } from './tally.js';

test('a round missed by one is counted, and so is the biggest nomination made', () => {
  const tally = newTally();
  tallyRound(tally, { bid: 3, taken: 2, onlyOneMadeIt: false });
  tallyRound(tally, { bid: 3, taken: 4, onlyOneMadeIt: false });
  tallyRound(tally, { bid: 3, taken: 0, onlyOneMadeIt: false });
  assert.equal(tally.missedByOne, 2);
  assert.equal(tally.biggestBidMade, 0, 'nothing made yet');
  tallyRound(tally, { bid: 4, taken: 4, onlyOneMadeIt: false });
  tallyRound(tally, { bid: 2, taken: 2, onlyOneMadeIt: false });
  assert.equal(tally.biggestBidMade, 4);
  assert.equal(tally.missedByOne, 2);
});
