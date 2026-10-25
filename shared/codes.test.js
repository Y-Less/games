// shared/codes.js is what every client uses to tidy a typed or pasted invite code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCode } from './codes.js';

test('normaliseCode tidies the usual ways of writing a code', () => {
  for (const raw of ['boss-aware-you', 'Boss Aware You', '?boss-aware-you', '?code=boss-aware-you', 'https://example.com/play/dixnt?code=Boss-Aware-You', '  boss  aware  you  ', 'BOSS_AWARE_YOU']) {
    assert.equal(normaliseCode(raw), 'boss-aware-you', raw);
  }
});

test('normaliseCode uses what follows the last question mark', () => {
  assert.equal(normaliseCode('what?is?boss-aware-you'), 'boss-aware-you');
  assert.equal(normaliseCode('boss-aware-you?'), '', 'nothing after the question mark means no code');
  assert.equal(normaliseCode('boss-aware-you?code='), '');
});

test('normaliseCode refuses text that is not exactly three words', () => {
  for (const raw of ['', ' ', 'one', 'two words', 'four words are too many', '1 2 3', 'abc-123-def-456', '-', '?']) {
    assert.equal(normaliseCode(raw), '', JSON.stringify(raw));
  }
});

test('normaliseCode only accepts text', () => {
  for (const raw of [undefined, null, 5, {}, [], ['a', 'b', 'c'], true]) assert.equal(normaliseCode(raw), '');
});

test('normaliseCode output is always empty or lower-case words joined by single dashes', () => {
  for (const raw of ['A B C', 'a--b--c', '--a-b-c--', 'A.B.C', 'A\tB\nC', '?code=A B C']) {
    assert.match(normaliseCode(raw), /^[a-z]+-[a-z]+-[a-z]+$/, raw);
  }
});
