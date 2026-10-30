import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from './rules.js';
import { newTally, tallyDraw, tallyPlay } from './tally.js';

test('drawing turns and the longest set left on the table are counted', () => {
  const tally = newTally();
  tallyDraw(tally);
  tallyDraw(tally);
  assert.equal(tally.turnsDrawn, 2);
  const play = (after) => tallyPlay(tally, DEFAULT_SETTINGS, { added: [0], before: [], after, firstMeld: false, wentOut: false });
  play([[0, 1, 2, 3, 4], [5, 6, 7]]);
  assert.equal(tally.longestSet, 5);
  play([[0, 1, 2]]);
  assert.equal(tally.longestSet, 5, 'the most there has been');
});
