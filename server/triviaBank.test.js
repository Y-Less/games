// The site's own trivia questions, against a real (in-memory) database: what goes in, what the filters let out, and
// that a question comes back in the shape shared/trivia.js expects of The Trivia API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.js';
import { createQuestionBank, where } from './triviaBank.js';
import { prepare } from '../shared/trivia.js';
import { seeded } from '../shared/random.js';

/** A question in the shape the bank takes, numbered so every one is a different one. */
const question = (n, over = {}) => ({
  id: `q-${n}`,
  question: `question ${n}?`,
  correct: `right-${n}`,
  wrong: [`wrong-${n}a`, `wrong-${n}b`, `wrong-${n}c`],
  category: 'history',
  difficulty: 'medium',
  tags: ['history'],
  regions: [],
  ...over,
});

/** A bank on a database of its own, with `count` questions already in it. */
function bankOf(count = 0, make = question) {
  const bank = createQuestionBank(openDatabase(':memory:'), { now: () => 1000 });
  if (count) bank.add(Array.from({ length: count }, (_, n) => make(n)));
  return bank;
}

test('questions go in once, and one already held is not added again', () => {
  const bank = bankOf();
  assert.equal(bank.add([question(1), question(2)]), 2);
  assert.equal(bank.count(), 2);
  assert.equal(bank.add([question(1)]), 0, 'the same id is already held');
  assert.equal(bank.count(), 2);
  assert.equal(bank.add([question(1, { id: undefined })]), 1, 'without an id the question itself is the id');
});

test('a question that could not be asked is not taken', () => {
  const bank = bankOf();
  const added = bank.add([
    question(1, { question: '   ' }),
    question(2, { correct: '' }),
    question(3, { wrong: [] }),
    question(4, { wrong: ['  '] }),
    null,
    'not a question',
    question(5),
  ]);
  assert.equal(added, 1, 'only the whole one');
  assert.equal(bank.count(), 1);
  assert.equal(bank.add('not a list'), 0);
});

test('a drawn question is in the shape the API sends, so one prepare serves both sources', () => {
  const bank = bankOf(1);
  const [raw] = bank.draw(1);
  assert.deepEqual(raw, {
    id: 'q-0',
    question: { text: 'question 0?' },
    correctAnswer: 'right-0',
    incorrectAnswers: ['wrong-0a', 'wrong-0b', 'wrong-0c'],
    category: 'history',
    difficulty: 'medium',
    tags: ['history'],
    regions: [],
  });
  const ready = prepare(raw, seeded(1));
  assert.equal(ready.question, 'question 0?');
  assert.equal(ready.answers.length, 4);
  assert.equal(ready.answers[ready.correct], 'right-0');
  assert.equal(ready.category, 'history');
});

test('counting and drawing narrow to the filters they are given', () => {
  const bank = bankOf();
  bank.add([
    question(1, { category: 'history', difficulty: 'easy', tags: ['kings'] }),
    question(2, { category: 'history', difficulty: 'hard', tags: ['kings', 'wars'] }),
    question(3, { category: 'music', difficulty: 'easy', tags: ['pop'] }),
    question(4, { category: 'music', difficulty: 'easy', tags: ['pop'], regions: ['GB'] }),
    question(5, { category: 'music', difficulty: 'easy', tags: ['pop'], regions: ['US'] }),
  ]);
  assert.equal(bank.count(), 5, 'no filters at all means every question');
  assert.equal(bank.count({}), 5);
  assert.equal(bank.count({ categories: 'history' }), 2);
  assert.equal(bank.count({ categories: 'history,music' }), 5);
  assert.equal(bank.count({ difficulties: 'easy' }), 4);
  assert.equal(bank.count({ categories: 'history', difficulties: 'easy' }), 1);
  assert.equal(bank.count({ tags: 'wars' }), 1);
  assert.equal(bank.count({ tags: 'kings,pop' }), 5);
  assert.equal(bank.count({ region: 'GB' }), 4, 'a question for one region is left out of another, and one for none suits all');
  assert.equal(bank.count({ region: 'US' }), 4);
  assert.equal(bank.count({ categories: 'nothing-like-it' }), 0);

  for (const raw of bank.draw(10, { categories: 'history' })) assert.equal(raw.category, 'history');
  for (const raw of bank.draw(10, { region: 'GB' })) assert.ok(!raw.regions.length || raw.regions.includes('GB'));
  assert.deepEqual(bank.draw(10, { categories: 'nothing-like-it' }), []);
});

test('a draw brings back more than asked for, so the store can throw away what has been seen', () => {
  const bank = bankOf(30);
  assert.ok(bank.draw(2).length > 2, 'more than two to choose from');
  assert.ok(bank.draw(2).length <= 30);
  assert.equal(bank.draw(100).length, 30, 'never more than it holds');
  for (const count of [0, -1, 1.5, 'two', null]) assert.deepEqual(bank.draw(count), [], String(count));
});

test('two draws of the same size are not always the same questions', () => {
  const bank = bankOf(40);
  const ids = (n) => bank.draw(n).map((raw) => raw.id).join(',');
  const draws = new Set(Array.from({ length: 10 }, () => ids(3)));
  assert.ok(draws.size > 1, 'the order is random');
});

test('the filter clause only asks about what it was given', () => {
  assert.deepEqual(where(), { sql: '', values: [] });
  assert.deepEqual(where({ categories: '' }), { sql: '', values: [] });
  assert.deepEqual(where({ categories: ' history , music ' }), { sql: ' WHERE category IN (?, ?)', values: ['history', 'music'] });
  const both = where({ categories: 'history', difficulties: 'easy' });
  assert.match(both.sql, /^ WHERE category IN \(\?\) AND difficulty IN \(\?\)$/);
  assert.deepEqual(both.values, ['history', 'easy']);
});

test('a bank with nothing in it counts none and draws none', () => {
  const bank = bankOf();
  assert.equal(bank.count(), 0);
  assert.deepEqual(bank.draw(5), []);
});
