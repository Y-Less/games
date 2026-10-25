// Invite codes: generating three-word codes and tidying typed or pasted ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codes } from './codes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORDS = fs.readFileSync(path.join(here, 'code-words.txt'), 'utf8').split(/\r?\n/).filter((w) => /^[a-z]+$/.test(w));

test('the word list is usable: plenty of distinct lower-case words', () => {
  assert.ok(WORDS.length >= 500);
  assert.equal(new Set(WORDS).size, WORDS.length, 'no duplicates');
  assert.ok(WORDS.every((w) => w.length >= 2 && w.length <= 16), "words of a sensible length");
});

test('generate makes three different words from the list, joined by dashes', () => {
  for (let i = 0; i < 300; i++) {
    const code = codes.generate();
    assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
    const words = code.split('-');
    assert.equal(new Set(words).size, 3, `${code} repeats a word`);
    for (const word of words) assert.ok(WORDS.includes(word), `${word} is in the list`);
    assert.equal(codes.normalise(code), code, 'a generated code is already tidy');
  }
});

test('generate gives varied codes', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(codes.generate());
  assert.ok(seen.size > 190, `only ${seen.size} different codes in 200`);
});

test('generate passes each candidate to taken() and avoids the ones that are taken', () => {
  const asked = [];
  let refusals = 3;
  const code = codes.generate((candidate) => {
    asked.push(candidate);
    return refusals-- > 0;
  });
  assert.equal(asked.length, 4, 'three taken, then one free');
  assert.equal(code, asked[3], 'the code returned is the one that was free');
  assert.ok(asked.every((c) => /^[a-z]+-[a-z]+-[a-z]+$/.test(c)));
});

test('generate never returns a code that taken() has seen and refused', () => {
  const used = new Set();
  for (let i = 0; i < 500; i++) {
    const code = codes.generate((candidate) => used.has(candidate));
    assert.ok(!used.has(code));
    used.add(code);
  }
  assert.equal(used.size, 500);
});

test('generate chooses words with Math.random, skipping a word it already has', (t) => {
  const draws = [0, 0, 0.5, 0.999999];
  t.mock.method(Math, 'random', () => draws.shift() ?? 0.25);
  const code = codes.generate();
  const pick = (r) => WORDS[Math.floor(r * WORDS.length)];
  assert.equal(code, [pick(0), pick(0.5), pick(0.999999)].join('-'), 'the repeated first word was skipped');
});

test('generate throws when no code is free (it tries 1000 times)', () => {
  let calls = 0;
  assert.throws(() => codes.generate(() => (calls++, true)), /Could not make an invite code/);
  assert.equal(calls, 1000);
});

test('generate succeeds on the very last attempt', () => {
  let calls = 0;
  const code = codes.generate(() => ++calls < 1000);
  assert.equal(calls, 1000);
  assert.match(code, /^[a-z]+-[a-z]+-[a-z]+$/);
});

test('normalise accepts the usual ways people write a code', () => {
  const expected = 'boss-aware-you';
  for (const raw of [
    'boss-aware-you',
    '?code=boss-aware-you',
    '?boss-aware-you',
    'code=boss-aware-you',
    'Boss Aware You',
    '  BOSS   AWARE   YOU  ',
    'boss_aware_you',
    'boss.aware.you',
    'boss, aware, you',
    'Boss-Aware-You',
    'boss-aware-you/',
    '-boss-aware-you-',
    'boss--aware---you',
    'https://example.com/play/coin?boss-aware-you',
    'https://example.com/play/coin?code=boss-aware-you',
    'http://localhost:3000/play/dixnt?code=Boss-Aware-You',
    'https://example.com/play/coin?code=Boss%20Aware%20You',
    '/play/coin?boss-aware-you',
    'a?b?boss-aware-you',
    'boss\taware\nyou',
  ]) {
    assert.equal(codes.normalise(raw), expected, JSON.stringify(raw));
  }
});

test('normalise rejects anything that is not three words', () => {
  for (const raw of [
    'boss-aware',
    'boss',
    'boss-aware-you-now',
    'boss aware you now',
    'one two',
    '1-2-3',
    '123',
    'boss-aware-1',
    '',
    '   ',
    '-',
    '---',
    '?',
    '?code=',
    'code=',
    '??',
    'https://example.com/play/coin',
    'https://example.com/play/coin?',
    'ünï-cödé-wörds',
    '日本語-日本語-日本語',
  ]) {
    assert.equal(codes.normalise(raw), '', JSON.stringify(raw));
  }
});

test('normalise gives an empty string for anything that is not text', () => {
  for (const raw of [undefined, null, 0, 42, NaN, true, false, {}, [], ['boss-aware-you'], { toString: () => 'boss-aware-you' }, () => 'boss-aware-you', Symbol('x'), 10n]) {
    assert.equal(codes.normalise(raw), '', String(typeof raw));
  }
});

test('normalise is idempotent and never throws on odd text', () => {
  for (const raw of ['Boss Aware You', '?code=A-B-C', 'x'.repeat(10000), '%'.repeat(50), '\u0000\u0001', '😀 😀 😀']) {
    const once = codes.normalise(raw);
    assert.equal(codes.normalise(once), once);
  }
  assert.equal(codes.normalise('a b c'), 'a-b-c', 'any three words have the right shape');
});
