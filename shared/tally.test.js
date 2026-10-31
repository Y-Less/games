import test from 'node:test';
import assert from 'node:assert/strict';
import { bump, extrasOf, freshTally, peak, statsRows } from './tally.js';

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

test('stats rows cover people only, each starting with the account id', () => {
  const seats = [{ kind: 'human', id: 7, name: 'Ann' }, null, { kind: 'bot', id: 'bot:1', name: 'Hazel' }, { kind: 'human', id: 9, name: 'Bo' }, { kind: 'gone', name: 'Cy' }];
  const rows = statsRows(seats, (seat, i) => ({ outcome: i === 0 ? 'win' : 'loss', placement: i + 1, score: seat.name.length, extras: { seat: i } }));
  assert.deepEqual(rows, [
    { userId: 7, outcome: 'win', placement: 1, score: 3, extras: { seat: 0 } },
    { userId: 9, outcome: 'loss', placement: 4, score: 2, extras: { seat: 3 } },
  ]);
  assert.deepEqual(Object.keys(rows[0]), ['userId', 'outcome', 'placement', 'score', 'extras']);
  assert.deepEqual(statsRows([], () => ({})), []);
});
