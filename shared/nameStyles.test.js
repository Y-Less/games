// The name styles (shared/nameStyles.js) are data: one entry per style, sold by the shop and drawn by the client.  A
// mistake in data shows up as a style nobody can buy or a name nobody can read, so the list is checked as a list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NAME_STYLE, NAME_STYLES, isNameStyle, nameStyleById } from './nameStyles.js';

test('every style has an id of its own, a name, and a price', () => {
  const ids = NAME_STYLES.map((style) => style.id);
  assert.equal(new Set(ids).size, ids.length, 'an id appears twice');
  const names = NAME_STYLES.map((style) => style.name);
  assert.equal(new Set(names).size, names.length, 'a name appears twice');
  for (const style of NAME_STYLES) {
    assert.match(style.id, /^[a-z][a-z0-9-]*$/, `${style.id}: an id is a lower-case word, since it is saved and sent`);
    assert.ok(typeof style.name === 'string' && style.name.trim() === style.name && style.name.length > 0, `${style.id}: name`);
    assert.ok(Number.isInteger(style.price) && style.price >= 0, `${style.id}: price ${style.price}`);
  }
});

test('every style has the colours the client draws it from, and nothing it does not know', () => {
  for (const style of NAME_STYLES) {
    assert.ok(typeof style.border === 'string' && style.border.length > 0, `${style.id}: border`);
    assert.ok(typeof style.fill === 'string' && style.fill.length > 0, `${style.id}: fill`);
    if ('text' in style) assert.match(style.text, /^#[0-9a-f]{6}$/, `${style.id}: text`);
    for (const key of Object.keys(style)) assert.ok(['id', 'name', 'price', 'border', 'fill', 'text'].includes(key), `${style.id}: unexpected field ${key}`);
  }
});

test('a colour is something CSS would take, and cannot carry anything else into a style attribute', () => {
  const colour = /^(transparent|#[0-9a-f]{6}|rgb\(\d{1,3} \d{1,3} \d{1,3}( \/ (0?\.\d+|1))?\))$/;
  const gradient = /^linear-gradient\(\d{1,3}deg(, (#[0-9a-f]{6}|rgb\(\d{1,3} \d{1,3} \d{1,3}( \/ (0?\.\d+|1))?\))){2,}\)$/;
  for (const style of NAME_STYLES) {
    assert.match(style.border, colour, `${style.id}: border ${style.border}`);
    assert.ok(colour.test(style.fill) || gradient.test(style.fill), `${style.id}: fill ${style.fill}`);
    for (const value of [style.border, style.fill, style.text ?? '']) assert.doesNotMatch(value, /[;{}<>"']|url\(/, `${style.id}: ${value}`);
  }
});

test('plain is free, and is what a player has until they choose', () => {
  assert.equal(nameStyleById('plain').price, 0);
  assert.deepEqual(DEFAULT_NAME_STYLE, { style: 'plain' });
  assert.ok(isNameStyle(DEFAULT_NAME_STYLE.style));
});

test('a style is found by its id', () => {
  for (const style of NAME_STYLES) {
    assert.equal(nameStyleById(style.id), style);
    assert.equal(isNameStyle(style.id), true);
  }
});

test('an unknown id is not a style, and is drawn as plain', () => {
  const plain = nameStyleById('plain');
  const gold = { toString: () => 'gold' };
  for (const id of ['', 'Gold', 'gold ', 'nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', undefined, null, 0, 1, true, [], ['gold'], {}, gold]) {
    assert.equal(isNameStyle(id), false, String(id));
    assert.equal(nameStyleById(id), plain, String(id));
  }
});
