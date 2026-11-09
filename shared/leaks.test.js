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

test('a secret is named only when it stands on its own, not when it is part of a longer word', () => {
  // Draw's word list holds "raw" and the error code notYourTurnToDraw contains those letters; a Scribblers guesser who
  // writes "perceives" is shown their own near miss while "perceive" is still the word.  Neither is a leak.
  const forbidden = [{ text: 'raw', why: 'the word was sent' }];
  assert.deepEqual(leaks({ error: 'notYourTurnToDraw' }, { forbidden }), []);
  assert.deepEqual(leaks({ feed: [{ text: 'rawer' }] }, { forbidden }), []);
  assert.equal(leaks({ feed: [{ text: 'raw' }] }, { forbidden, who: 'seat 1' }).length, 1);
  assert.equal(leaks({ feed: [{ text: 'a raw deal' }] }, { forbidden }).length, 1);
});

test('a key that happens to spell a secret is not that secret', () => {
  // Every Scribblers view carries votes.can, saying whether this person may judge the drawing; "can" is also a word
  // in the list.  Only what a view *says* counts, never what the shape of it is called.
  const forbidden = [{ text: 'can', why: 'the word was sent' }];
  assert.deepEqual(leaks({ votes: { can: true, up: 0 } }, { forbidden }), []);
  assert.equal(leaks({ votes: { can: true }, feed: [{ text: 'can' }] }, { forbidden }).length, 1);
});

test('a whole structure is still matched against the serialised view', () => {
  const bag = ['b', 'l', 'u', 'e'];
  assert.equal(leaks({ sneaked: ['b', 'l', 'u', 'e'] }, { forbidden: [{ text: bag, why: 'the bag was sent' }] }).length, 1);
  assert.deepEqual(leaks({ sneaked: ['b', 'l', 'u'] }, { forbidden: [{ text: bag, why: 'the bag was sent' }] }), []);
});

test('a game whose secret is not an identifier needs no pattern, and a policy that checks nothing is refused', () => {
  assert.deepEqual(leaks({ word: null }, { forbidden: [{ text: 'otter', why: 'the word was sent' }] }), []);
  assert.throws(() => leaks({ a: 1 }, {}), /nothing is checked/);
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
