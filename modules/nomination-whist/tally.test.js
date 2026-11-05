import test from 'node:test';
import assert from 'node:assert/strict';
import { JOKERS } from '../../shared/cards.js';
import { newTally, tallyDeal, tallyRound } from './tally.js';

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

test('a circus is a two-card round dealt as both Jokers and nothing else', () => {
  const tally = newTally();
  tallyDeal(tally, [...JOKERS]);
  assert.equal(tally.circuses, 1);
  tallyDeal(tally, [JOKERS[0], '7H']);
  tallyDeal(tally, ['7H', '8H']);
  assert.equal(tally.circuses, 1, 'one Joker and a card is no circus, and nor is a plain hand');
  tallyDeal(tally, [...JOKERS, '7H']);
  assert.equal(tally.circuses, 1, 'both Jokers in a bigger round is not the whole hand');
});
