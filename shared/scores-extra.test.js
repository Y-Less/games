// More score helper edge cases (see scores.test.js for the basics).
import test from 'node:test';
import assert from 'node:assert/strict';
import { placements, totalsFromRounds, winnersOf } from './scores.js';

test('placements: everyone on the same score shares first place', () => {
  assert.deepEqual(placements({ a: 5, b: 5, c: 5 }), { a: 1, b: 1, c: 1 });
  assert.deepEqual(placements({ a: 5, b: 5, c: 5 }, { lowIsBetter: true }), { a: 1, b: 1, c: 1 });
  assert.deepEqual(placements({ a: 0, b: 0 }), { a: 1, b: 1 });
});

test('placements: negative scores order correctly, in both directions', () => {
  const scores = { a: -10, b: 0, c: -3, d: 4 };
  assert.deepEqual(placements(scores), { a: 4, b: 2, c: 3, d: 1 });
  assert.deepEqual(placements(scores, { lowIsBetter: true }), { a: 1, b: 3, c: 2, d: 4 });
  assert.deepEqual(placements({ a: -2, b: -2, c: -1 }), { a: 2, b: 2, c: 1 });
});

test('placements: ties in the middle skip positions, and a tie for last works', () => {
  assert.deepEqual(placements({ a: 9, b: 7, c: 7, d: 7, e: 1 }), { a: 1, b: 2, c: 2, d: 2, e: 5 });
  assert.deepEqual(placements({ a: 9, b: 1, c: 1 }), { a: 1, b: 2, c: 2 });
  assert.deepEqual(placements({ a: 3, b: 3, c: 1, d: 1 }), { a: 1, b: 1, c: 3, d: 3 });
});

test('placements: one player, no players, and fractional scores', () => {
  assert.deepEqual(placements({ solo: -5 }), { solo: 1 });
  assert.deepEqual(placements({}), {});
  assert.deepEqual(placements({ a: 0.1 + 0.2, b: 0.3 }), { a: 1, b: 2 }, 'plain number comparison, no rounding');
  assert.deepEqual(placements({ a: 1.5, b: 1.25 }), { a: 1, b: 2 });
});

test('placements: numeric-looking ids stay as keys and the input is not changed', () => {
  const scores = { 2: 10, 1: 30, 3: 30 };
  const copy = { ...scores };
  assert.deepEqual(placements(scores), { 1: 1, 2: 3, 3: 1 });
  assert.deepEqual(scores, copy);
});

test('placements: a missing options object or an empty one means higher is better', () => {
  assert.deepEqual(placements({ a: 1, b: 2 }, undefined), { a: 2, b: 1 });
  assert.deepEqual(placements({ a: 1, b: 2 }, {}), { a: 2, b: 1 });
  assert.deepEqual(placements({ a: 1, b: 2 }, { lowIsBetter: false }), { a: 2, b: 1 });
});

test('placements: every position is between 1 and the number of players, and the best is always 1', () => {
  const seeded = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const rng = seeded(11);
  for (let round = 0; round < 100; round++) {
    const n = 1 + Math.floor(rng() * 8);
    const scores = Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, Math.floor(rng() * 7) - 3]));
    for (const lowIsBetter of [false, true]) {
      const places = Object.values(placements(scores, { lowIsBetter }));
      assert.equal(Math.min(...places), 1);
      assert.ok(places.every((p) => p >= 1 && p <= n));
    }
  }
});

test('winnersOf: everyone wins when everyone ties, including on zero or negative scores', () => {
  assert.deepEqual(winnersOf({ a: 0, b: 0, c: 0 }), ['a', 'b', 'c']);
  assert.deepEqual(winnersOf({ a: -4, b: -4 }), ['a', 'b']);
  assert.deepEqual(winnersOf({ a: -4, b: -4 }, { lowIsBetter: true }), ['a', 'b']);
});

test('winnersOf: negative scores and low-is-better', () => {
  assert.deepEqual(winnersOf({ a: -10, b: -3, c: -7 }), ['b']);
  assert.deepEqual(winnersOf({ a: -10, b: -3, c: -7 }, { lowIsBetter: true }), ['a']);
  assert.deepEqual(winnersOf({ a: 7, b: -1, c: 0 }, { lowIsBetter: true }), ['b']);
});

test('winnersOf: one player wins alone, a runaway leader wins alone, and ids come back as text', () => {
  assert.deepEqual(winnersOf({ only: 0 }), ['only']);
  assert.deepEqual(winnersOf({ a: 100, b: 99, c: 98 }), ['a']);
  assert.deepEqual(winnersOf({ 7: 3, 8: 9 }), ['8']);
  assert.deepEqual(winnersOf({ 7: 9, 8: 9 }), ['7', '8']);
  assert.deepEqual(winnersOf({ a: 3, b: 9 }, undefined), ['b']);
});

test('winnersOf agrees with placements: the winners are exactly the players in first place', () => {
  const scores = { a: 4, b: 9, c: 9, d: -1 };
  const first = Object.entries(placements(scores)).filter(([, p]) => p === 1).map(([id]) => id);
  assert.deepEqual(winnersOf(scores), first);
});

test('totalsFromRounds: negative and fractional points, and players who only appear in later rounds', () => {
  const rounds = [{ deltas: { a: -5, b: 2.5 } }, { deltas: { a: 3, b: 2.5, late: 10 } }, { deltas: { a: 0 } }];
  assert.deepEqual(totalsFromRounds(rounds, ['a', 'b']), { a: -2, b: 5, late: 10 });
});

test('totalsFromRounds: rounds without deltas count for nothing, and listed players start on zero', () => {
  assert.deepEqual(totalsFromRounds([{}, { deltas: null }, { deltas: undefined }, { label: 'Hand 4' }], ['a', 'b']), { a: 0, b: 0 });
  assert.deepEqual(totalsFromRounds([], []), {});
  assert.deepEqual(totalsFromRounds([{ deltas: { a: 1 } }]), { a: 1 }, 'player ids are optional');
  assert.deepEqual(totalsFromRounds([{ deltas: {} }], ['a']), { a: 0 });
});

test('totalsFromRounds does not change its input and keeps ids as text keys', () => {
  const rounds = [{ deltas: { 1: 5, 2: 6 }, notes: { 1: 'shot the moon' } }];
  const copy = JSON.parse(JSON.stringify(rounds));
  assert.deepEqual(totalsFromRounds(rounds, [1, 2, 3]), { 1: 5, 2: 6, 3: 0 });
  assert.deepEqual(rounds, copy);
});

test('totals feed placements and winners as the games use them', () => {
  const rounds = [{ deltas: { a: 10, b: 20, c: 20 } }, { deltas: { a: 15, b: -5, c: 0 } }];
  const totals = totalsFromRounds(rounds, ['a', 'b', 'c']);
  assert.deepEqual(totals, { a: 25, b: 15, c: 20 });
  assert.deepEqual(placements(totals), { a: 1, b: 3, c: 2 });
  assert.deepEqual(winnersOf(totals), ['a']);
  assert.deepEqual(winnersOf(totals, { lowIsBetter: true }), ['b']);
});
