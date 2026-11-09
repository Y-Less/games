// The shared view-secrecy check: it must find a leak, and must not invent one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoLeaks, leaks, leaksInRun } from './leaks.js';

const CARD = /\bc\d\d\b/g;

test('a view naming only what the viewer may see is clean', () => {
  const view = { board: ['c01', 'c02'], mine: ['c03'] };
  assert.deepEqual(leaks(view, { allowed: ['c01', 'c02', 'c03'], pattern: CARD }), []);
});

test('a card the viewer may not see is reported, wherever it is hiding', () => {
  const view = { board: ['c01'], opponent: { reserved: [{ card: 'c99' }] } };
  const found = leaks(view, { allowed: ['c01'], pattern: CARD, who: 'seat 2' });
  assert.equal(found.length, 1);
  assert.match(found[0], /seat 2: was sent c99/);
});

test('the same card leaking twice is one problem', () => {
  const view = { a: 'c99', b: 'c99' };
  assert.equal(leaks(view, { allowed: [], pattern: CARD }).length, 1);
});

test('ids are compared as text, so a number in the view matches a number allowed', () => {
  const view = { dice: [{ id: 7 }] };
  assert.deepEqual(leaks(view, { allowed: [7], pattern: /"id":(\d+)/g }), []);
  assert.equal(leaks(view, { allowed: [8], pattern: /"id":(\d+)/g }).length, 1);
});

test('forbidden text is caught even when it is no identifier at all', () => {
  const view = { clue: 'the word is ELEPHANT' };
  const found = leaks(view, { allowed: [], pattern: CARD, forbidden: [{ text: 'ELEPHANT', why: 'the secret word reached a guesser' }] });
  assert.deepEqual(found, ['this view: the secret word reached a guesser']);
});

test('forbidden text that is not there is not reported, and null is not searched for', () => {
  const view = { clue: 'something else' };
  assert.deepEqual(leaks(view, { allowed: [], pattern: CARD, forbidden: [{ text: 'ELEPHANT', why: 'no' }, { text: null, why: 'no' }] }), []);
});

test('no view at all has nothing to leak', () => {
  assert.deepEqual(leaks(null, { allowed: [], pattern: CARD }), []);
  assert.deepEqual(leaks(undefined, { allowed: [], pattern: CARD }), []);
});

test('a pattern that is not global would check only the first id, so it is refused', () => {
  assert.throws(() => leaks({ a: 'c01' }, { allowed: [], pattern: /\bc\d\d\b/ }), /must be global/);
});

test('assertNoLeaks throws on a leak and says which, and passes a clean view', () => {
  assert.throws(() => assertNoLeaks({ a: 'c99' }, { allowed: [], pattern: CARD, who: 'the spectator' }), /the spectator: was sent c99/);
  assertNoLeaks({ a: 'c01' }, { allowed: ['c01'], pattern: CARD });
});

test('a whole recorded run is checked at once, and names every view that leaked', () => {
  const policy = { allowed: ['c01'], pattern: CARD };
  const found = leaksInRun([
    { view: { a: 'c01' }, policy: { ...policy, who: 'seat 1' } },
    { view: { a: 'c42' }, policy: { ...policy, who: 'seat 2' } },
    { view: { a: 'c43' }, policy: { ...policy, who: 'the spectator' } },
  ]);
  assert.equal(found.length, 2);
  assert.match(found.join('\n'), /seat 2: was sent c42/);
  assert.match(found.join('\n'), /the spectator: was sent c43/);
});
