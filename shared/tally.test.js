import test from 'node:test';
import assert from 'node:assert/strict';
import { bump, extrasOf, freshTally, peak } from './tally.js';

test('a fresh tally has every key at zero, and bump and peak treat a missing key as zero', () => {
  assert.deepEqual(freshTally(['a', 'b']), { a: 0, b: 0 });
  const tally = {};
  bump(tally, 'a');
  bump(tally, 'a', 4);
  peak(tally, 'big', 3);
  peak(tally, 'big', 2);
  assert.deepEqual(tally, { a: 5, big: 3 });
});

test('extras report every key as a number', () => {
  assert.deepEqual(extrasOf({ a: 2, extra: 9 }, ['a', 'b']), { a: 2, b: 0 });
});
