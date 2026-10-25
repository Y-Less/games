import test from 'node:test';
import assert from 'node:assert/strict';
import { placements, totalsFromRounds, winnersOf } from './scores.js';

test('totals add up every round, including players missing from some rounds', () => {
  const rounds = [{ deltas: { a: 5, b: 0 } }, { deltas: { a: 3, b: 7, c: 1 } }, {}];
  assert.deepEqual(totalsFromRounds(rounds, ['a', 'b']), { a: 8, b: 7, c: 1 });
  assert.deepEqual(totalsFromRounds([], ['a']), { a: 0 });
});

test('placements share a position for ties and skip the next one', () => {
  assert.deepEqual(placements({ a: 10, b: 30, c: 30, d: 5 }), { a: 3, b: 1, c: 1, d: 4 });
  assert.deepEqual(placements({ a: 10, b: 30, c: 30, d: 5 }, { lowIsBetter: true }), { a: 2, b: 3, c: 3, d: 1 });
});

test('winners are everyone on the best score', () => {
  assert.deepEqual(winnersOf({ a: 3, b: 9, c: 9 }), ['b', 'c']);
  assert.deepEqual(winnersOf({ a: 3, b: 9, c: 3 }, { lowIsBetter: true }), ['a', 'c']);
  assert.deepEqual(winnersOf({}), []);
});
