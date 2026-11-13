// The seeded generator and the two choosers built on it (shared/random.js).  Every replayable test in the project
// stands on `seeded`, so what is pinned here is that a seed means the same game tomorrow as it did today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawUnused, pickOne, seeded } from './random.js';

const take = (rng, n) => Array.from({ length: n }, () => rng());

test('the same seed gives the same numbers, and a different seed gives different ones', () => {
  assert.deepEqual(take(seeded(42), 50), take(seeded(42), 50));
  assert.notDeepEqual(take(seeded(42), 50), take(seeded(43), 50));
});

test('two generators do not share their state', () => {
  const a = seeded(7);
  const b = seeded(7);
  const first = a();
  a();
  a();
  assert.equal(b(), first, 'drawing from one must not move the other on');
});

test('every number is in [0, 1), for ordinary and awkward seeds alike', () => {
  for (const seed of [0, 1, -1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53, 1.5, NaN, Infinity]) {
    const rng = seeded(seed);
    for (let i = 0; i < 2000; i++) {
      const n = rng();
      assert.ok(n >= 0 && n < 1, `seed ${seed}, draw ${i}: ${n}`);
    }
  }
});

test('a seed is taken as an unsigned 32-bit integer', () => {
  assert.deepEqual(take(seeded(-1), 5), take(seeded(2 ** 32 - 1), 5));
  assert.deepEqual(take(seeded(2 ** 32 + 5), 5), take(seeded(5), 5));
});

test('the numbers are spread over the range rather than bunched', () => {
  const rng = seeded(2026);
  const buckets = new Array(10).fill(0);
  const draws = 20000;
  for (let i = 0; i < draws; i++) buckets[Math.floor(rng() * 10)]++;
  // A fair tenth is 2000; a bucket 15% out either way would be a broken generator rather than bad luck.
  for (const [index, count] of buckets.entries()) assert.ok(count > 1700 && count < 2300, `bucket ${index} holds ${count}`);
});

test('the sequence does not fall into a short loop', () => {
  const seen = new Set(take(seeded(1), 5000));
  assert.ok(seen.size > 4990, `only ${seen.size} different numbers in 5000`);
});

test('pickOne chooses by where the number falls, and reaches both ends', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.equal(pickOne(list, () => 0), 'a');
  assert.equal(pickOne(list, () => 0.249), 'a');
  assert.equal(pickOne(list, () => 0.25), 'b');
  assert.equal(pickOne(list, () => 0.999999), 'd');
  assert.equal(pickOne(['only'], () => 0.7), 'only');
});

test('pickOne asks for one number and leaves the list alone', () => {
  const list = Object.freeze([1, 2, 3]);
  let calls = 0;
  pickOne(list, () => (calls++, 0.5));
  assert.equal(calls, 1);
});

test('pickOne reaches every item, about equally often', () => {
  const rng = seeded(99);
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 9000; i++) counts[pickOne(['a', 'b', 'c'], rng)]++;
  for (const [item, count] of Object.entries(counts)) assert.ok(count > 2700 && count < 3300, `${item} was chosen ${count} times`);
});

test('drawUnused goes through the whole list before anything comes round again', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];
  for (let seed = 0; seed < 50; seed++) {
    const rng = seeded(seed);
    const used = [];
    const first = list.map(() => drawUnused(list, used, rng));
    assert.deepEqual([...first].sort(), list, `seed ${seed}: the first pass through`);
    assert.deepEqual(used, first, `seed ${seed}: the memory is the choices, in order`);
    // The list is used up, so the next draw clears the memory and starts again.
    const next = drawUnused(list, used, rng);
    assert.ok(list.includes(next), `seed ${seed}`);
    assert.deepEqual(used, [next], `seed ${seed}: the memory starts again from the one just chosen`);
  }
});

test('drawUnused keeps the caller\'s memory array, which is the one saved with the room', () => {
  const used = ['a', 'b'];
  const same = used;
  assert.equal(drawUnused(['a', 'b'], used, seeded(1)) in { a: 1, b: 1 }, true);
  assert.equal(used, same);
  assert.equal(used.length, 1, 'emptied in place and then given the new choice');
});

test('drawUnused never chooses something already used while anything fresh is left', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  const seed = 5150;
  const rng = seeded(seed);
  const used = [];
  for (let i = 0; i < 300; i++) {
    const before = [...used];
    const item = drawUnused(list, used, rng);
    if (before.length < list.length) assert.ok(!before.includes(item), `seed ${seed}, draw ${i}: ${item} came round early`);
    assert.ok(used.length >= 1 && used.length <= list.length, `seed ${seed}, draw ${i}: the memory holds ${used.length}`);
    assert.equal(new Set(used).size, used.length, `seed ${seed}, draw ${i}: something is remembered twice`);
  }
});

test('drawUnused is not put off by a memory of things no longer in the list', () => {
  // A word list that was edited between two games: what was used and has since been removed must not count as used up.
  const used = ['gone', 'a'];
  assert.equal(drawUnused(['a', 'b'], used, seeded(3)), 'b');
  // And once the real ones are used up it starts again rather than finding nothing to choose.
  assert.ok(['a', 'b'].includes(drawUnused(['a', 'b'], used, seeded(3))));
});
