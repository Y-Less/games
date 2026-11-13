// Reading numbers and text out of what a client sent (shared/input.js).  The whole point of these two is that they
// never throw, whatever they are handed, so most of this file is handing them things.
import test from 'node:test';
import assert from 'node:assert/strict';
import { numberFrom, textFrom } from './input.js';
import { seeded } from './random.js';

/** Values a hostile client can put in a payload field (after JSON, or made up by a test calling a handler directly). */
const HOSTILE = [
  undefined,
  null,
  true,
  false,
  [],
  [1],
  ['1'],
  {},
  { valueOf: () => 7 },
  { toString: () => '7' },
  Object.create(null),
  { valueOf: () => { throw new Error('valueOf was called'); } },
  { toString: () => { throw new Error('toString was called'); } },
  { [Symbol.toPrimitive]: () => { throw new Error('toPrimitive was called'); } },
  Symbol('s'),
  10n,
  () => 3,
  new Date(0),
  new Map(),
  /7/,
];

test('a number is itself, and a numeric string is the number it spells', () => {
  for (const n of [0, -0, 1, -1, 1.5, 1e21, Number.MAX_SAFE_INTEGER, Infinity, -Infinity]) assert.equal(numberFrom(n), n);
  assert.ok(Number.isNaN(numberFrom(NaN)));
  assert.equal(numberFrom('3'), 3);
  assert.equal(numberFrom('-2.5'), -2.5);
  assert.equal(numberFrom('1e3'), 1000);
  // What an empty or padded string should be is not something the contract says, so it is not pinned here.
  for (const text of ['three', '3px', '1,000', '--1', 'NaN']) assert.ok(Number.isNaN(numberFrom(text)), text);
});

test('anything that is neither a number nor a string is NaN, without being asked to become one', () => {
  for (const value of HOSTILE) {
    let result;
    assert.doesNotThrow(() => (result = numberFrom(value)));
    assert.ok(Number.isNaN(result), `expected NaN, got ${String(result)}`);
  }
});

test('text is itself, and a number is written out', () => {
  for (const text of ['', 'a', ' padded ', '0', '__proto__', '\u0000', '😀']) assert.equal(textFrom(text), text);
  assert.equal(textFrom(0), '0');
  assert.equal(textFrom(-1.5), '-1.5');
  assert.equal(textFrom(NaN), 'NaN');
  assert.equal(textFrom(Infinity), 'Infinity');
});

test('anything that is neither a string nor a number is the empty string, never "[object Object]"', () => {
  for (const value of HOSTILE) {
    let result;
    assert.doesNotThrow(() => (result = textFrom(value)));
    assert.equal(result, '');
  }
});

test('fuzz: neither helper throws, and each returns its own type, for anything built from JSON', () => {
  const seed = 0x1a9f;
  const rng = seeded(seed);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const leaves = [0, 1, -1, 1.5, 1e308, '', '0', '12', 'x', '__proto__', 'constructor', null, true, false];
  const build = (depth) => {
    const kind = depth > 3 ? 0 : Math.floor(rng() * 4);
    if (kind === 0 || kind === 1) return pick(leaves);
    if (kind === 2) return Array.from({ length: Math.floor(rng() * 4) }, () => build(depth + 1));
    const bag = {};
    for (let i = Math.floor(rng() * 4); i > 0; i--) bag[String(pick(leaves))] = build(depth + 1);
    return bag;
  };
  for (let i = 0; i < 2000; i++) {
    const value = JSON.parse(JSON.stringify(build(0)));
    const where = `seed ${seed}, step ${i}: ${JSON.stringify(value)}`;
    assert.equal(typeof numberFrom(value), 'number', where);
    assert.equal(typeof textFrom(value), 'string', where);
    if (typeof value !== 'number' && typeof value !== 'string') {
      assert.ok(Number.isNaN(numberFrom(value)), where);
      assert.equal(textFrom(value), '', where);
    }
  }
});
