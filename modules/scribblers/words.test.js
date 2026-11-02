// The word list and the guess comparison: the list is there and is clean, words are drawn without repeating, and a
// guess counts as right, nearly right, or neither in the way the players are told it does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import { DEFAULT_LANGUAGE, WORD_LANGUAGES, cleanText, guessQuality, pickWords, wordList } from './words.js';

test('the word list is long, lowercase, and free of stray characters', () => {
  const words = wordList();
  assert.ok(words.length > 4000, `only ${words.length} words`);
  assert.equal(new Set(words).size, words.length, 'no word twice');
  for (const word of words) {
    assert.equal(word, word.toLowerCase(), word);
    assert.equal(word, word.trim(), word);
    assert.ok(/^[a-z][a-z ./-]*$/.test(word), word);
  }
});

test('a language with no list of its own falls back to English, and the list is read once', () => {
  assert.ok(WORD_LANGUAGES.includes(DEFAULT_LANGUAGE));
  assert.equal(wordList('tlh'), wordList('en'), 'the same list, not merely an equal one');
  assert.equal(wordList(), wordList('en'));
});

test('words are drawn as many as asked, all different, and not ones already played', () => {
  const rng = seeded(5);
  const used = [];
  for (let turn = 0; turn < 50; turn++) {
    const words = pickWords(4, used, rng);
    assert.equal(words.length, 4);
    assert.equal(new Set(words).size, 4, 'four different words');
    for (const word of words) assert.ok(!used.includes(word), `${word} was played already`);
    used.push(words[0]);
  }
});

test('asking for more words than are left starts the list again rather than failing', () => {
  const rng = seeded(6);
  const all = wordList();
  const words = pickWords(3, all, rng);
  assert.equal(words.length, 3);
  assert.equal(new Set(words).size, 3);
});

test('comparing ignores capitals, accents, spaces, hyphens and underscores', () => {
  assert.equal(cleanText('Pac-Man'), 'pacman');
  assert.equal(cleanText('  CAFÉ  '), 'cafe');
  assert.equal(guessQuality('PAC MAN', 'pac-man'), 'exact');
  assert.equal(guessQuality('cafe', 'café'), 'exact');
});

test('a guess is right, nearly right, or neither', () => {
  for (const [guess, word, expected] of [
    ['house', 'house', 'exact'],
    ['hous', 'house', 'close'], // one missing
    ['housee', 'house', 'close'], // one too many
    ['houde', 'house', 'close'], // one wrong
    ['huose', 'house', 'close'], // two swapped
    ['hoose', 'house', 'close'],
    ['mouse', 'house', 'close'],
    ['ho', 'house', 'wrong'],
    ['horse riding', 'house', 'wrong'],
    ['', 'house', 'wrong'],
    ['houses!', 'house', 'wrong'], // two too many once the exclamation mark is counted
    ['tree', 'house', 'wrong'],
    ['abc', 'acb', 'close'],
    ['abcde', 'abde', 'close'],
  ]) {
    assert.equal(guessQuality(guess, word), expected, `${guess} ~ ${word}`);
  }
});

test('the comparison is symmetrical and never throws on odd input', () => {
  for (const [a, b] of [
    ['house', 'hous'],
    ['hous', 'house'],
    ['', ''],
    ['x', ''],
  ]) {
    assert.equal(guessQuality(a, b), guessQuality(b, a), `${a} ~ ${b}`);
  }
  assert.equal(guessQuality('ok', 'ok'), 'exact');
});
