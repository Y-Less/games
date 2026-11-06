// Counting the words of a refund request: the rule the page and the server both go by.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REFUND_ITEM, REFUND_MAXIMUM_CHARACTERS, REFUND_MINIMUM_WORDS, countWords } from './refunds.js';

test('a word is a run of anything that is not a space, however it is spaced', () => {
  assert.equal(countWords('one two three'), 3);
  assert.equal(countWords('  one   two \n three \t four  '), 4);
  assert.equal(countWords('one\nper\nline'), 3);
  assert.equal(countWords('one'), 1);
  assert.equal(countWords('hyphen-counts-once'), 1);
});

test('nothing written is no words at all, whatever was sent', () => {
  for (const nothing of ['', '   ', '\n\t ', null, undefined, 42, {}, []]) assert.equal(countWords(nothing), 0, JSON.stringify(nothing));
});

test('the rule is a whole number of words, and the maximum leaves room for far more than it', () => {
  assert.equal(REFUND_ITEM, 'refunds');
  assert.ok(Number.isInteger(REFUND_MINIMUM_WORDS) && REFUND_MINIMUM_WORDS > 0);
  // Room for words far longer than any real one, so the character limit is never what stops somebody writing enough.
  assert.ok(REFUND_MAXIMUM_CHARACTERS > REFUND_MINIMUM_WORDS * 8);
});
