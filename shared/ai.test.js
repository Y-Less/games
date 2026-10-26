// The computer-player registry: checking a module's list, choosing by weight, assigning seats and describing an AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiById, assignAIs, defineAIs, describeAI, pickAI } from './ai.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LIST = [
  { id: 'a', name: 'A', description: 'first', weight: 6, secret: () => 1 },
  { id: 'b', name: 'B', weight: 3 },
  { id: 'c', name: 'C' },
  { id: 'off', name: 'Off', weight: 0 },
];

test('defineAIs returns the list it was given and rejects a bad one', () => {
  assert.equal(defineAIs(LIST), LIST);
  assert.throws(() => defineAIs([]), /at least one/);
  assert.throws(() => defineAIs('nope'), /at least one/);
  assert.throws(() => defineAIs([{ id: 'a', name: 'A' }, { id: 'a', name: 'Again' }]), /Duplicate AI id "a"/);
  assert.throws(() => defineAIs([{ name: 'No id' }]), /needs an id/);
  assert.throws(() => defineAIs([{ id: '', name: 'Empty' }]), /needs an id/);
  assert.throws(() => defineAIs([{ id: 'x' }]), /needs a name/);
  assert.throws(() => defineAIs([{ id: 'x', name: 'X', weight: -1 }]), /bad weight/);
  assert.throws(() => defineAIs([{ id: 'x', name: 'X', weight: NaN }]), /bad weight/);
  assert.throws(() => defineAIs([null]), /needs an id/);
});

test('aiById finds an AI and falls back to the first for anything unknown', () => {
  assert.equal(aiById(LIST, 'b').id, 'b');
  assert.equal(aiById(LIST, 'gone').id, 'a');
  assert.equal(aiById(LIST, undefined).id, 'a');
  assert.equal(aiById(LIST, null).id, 'a');
});

test('pickAI follows the weights and never picks a weight of zero', () => {
  const rng = seeded(1);
  const counts = { a: 0, b: 0, c: 0, off: 0 };
  const n = 20000;
  for (let i = 0; i < n; i++) counts[pickAI(LIST, rng).id]++;
  assert.equal(counts.off, 0);
  // Weights 6 : 3 : 1 (the default weight is 1).
  assert.ok(Math.abs(counts.a / n - 0.6) < 0.02, `a ${counts.a / n}`);
  assert.ok(Math.abs(counts.b / n - 0.3) < 0.02, `b ${counts.b / n}`);
  assert.ok(Math.abs(counts.c / n - 0.1) < 0.02, `c ${counts.c / n}`);
});

test('pickAI is decided entirely by the rng it is given', () => {
  assert.equal(pickAI(LIST, () => 0).id, 'a');
  assert.equal(pickAI(LIST, () => 0.59).id, 'a');
  assert.equal(pickAI(LIST, () => 0.61).id, 'b');
  assert.equal(pickAI(LIST, () => 0.95).id, 'c');
  assert.equal(pickAI(LIST, () => 0.999999).id, 'c');
  const again = [seeded(7), seeded(7)].map((rng) => Array.from({ length: 30 }, () => pickAI(LIST, rng).id));
  assert.deepEqual(again[0], again[1]);
});

test('pickAI copes with a list where nothing can be picked at random', () => {
  const only = [{ id: 'x', name: 'X', weight: 0 }, { id: 'y', name: 'Y', weight: 0 }];
  assert.equal(pickAI(only, () => 0.5).id, 'x');
  assert.equal(pickAI([{ id: 'z', name: 'Z' }], () => 0.9).id, 'z');
});

test('assignAIs gives every seat key an id from the list, and is repeatable with a seeded rng', () => {
  const ids = new Set(LIST.map((ai) => ai.id));
  const first = assignAIs(LIST, [1, 2, 3], seeded(5));
  assert.deepEqual(Object.keys(first), ['1', '2', '3']);
  assert.ok(Object.values(first).every((id) => ids.has(id) && id !== 'off'));
  assert.deepEqual(assignAIs(LIST, [1, 2, 3], seeded(5)), first);
  assert.deepEqual(assignAIs(LIST, [], seeded(5)), {});
  const seen = new Set();
  for (let seed = 1; seed < 60; seed++) for (const id of Object.values(assignAIs(LIST, [0, 1, 2, 3], seeded(seed)))) seen.add(id);
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c'], 'with enough games every weighted AI turns up');
});

test('describeAI shows the name and description, never the decision functions', () => {
  assert.deepEqual(describeAI(LIST[0]), { id: 'a', name: 'A', description: 'first' });
  assert.deepEqual(describeAI(LIST[1]), { id: 'b', name: 'B', description: '' });
  assert.equal('secret' in describeAI(LIST[0]), false);
});
