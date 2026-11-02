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

// ---- answers are a JSON array, not a joined string, so nothing in one needs escaping ----

// Every way an answer could upset a format that joined answers together with some character or other.
const AWKWARD = [
  'Salt, pepper, and vinegar',
  'He said "no"',
  "O'Brien",
  'C:\\Users\\Y_Less',
  'one\ntwo',
  'a|b;c\td',
  '["already", "json"]',
  '{"correct": "wrong"}',
  'naïve café — ☃ 日本語 😀',
  "'; DROP TABLE trivia_questions; --",
];

test('an answer with commas, quotes, backslashes or newlines in it comes back exactly as it went in', () => {
  const bank = bankOf();
  bank.add([question(1, { question: AWKWARD[0], correct: AWKWARD[1], wrong: AWKWARD.slice(2) })]);
  const [raw] = bank.draw(1);
  assert.equal(raw.question.text, AWKWARD[0]);
  assert.equal(raw.correctAnswer, AWKWARD[1]);
  assert.deepEqual(raw.incorrectAnswers, AWKWARD.slice(2), 'eight answers, none of them split or mangled');
  assert.equal(bank.count(), 1, 'and the SQL was not confused by the quote in it either');
});

test('an answer that contains the API filters\u2019 separator is still one answer', () => {
  const bank = bankOf();
  bank.add([question(1, { wrong: ['Salt, pepper', 'vinegar'] })]);
  const [raw] = bank.draw(1);
  assert.deepEqual(raw.incorrectAnswers, ['Salt, pepper', 'vinegar'], 'two answers, not three');
});

test('an awkward answer survives the whole way to a game, shuffled in with the rest', () => {
  const bank = bankOf();
  bank.add([question(1, { correct: AWKWARD[0], wrong: [AWKWARD[1], AWKWARD[2], AWKWARD[3]] })]);
  const ready = prepare(bank.draw(1)[0], seeded(3));
  assert.deepEqual([...ready.answers].sort(), AWKWARD.slice(0, 4).sort(), 'all four, unchanged');
  assert.equal(ready.answers[ready.correct], AWKWARD[0], 'and the right one is still the right one');
});

test('a tag or category with awkward characters is stored whole, and can be filtered for as a list', () => {
  const bank = bankOf();
  bank.add([
    question(1, { category: "rock 'n' roll", tags: ['1970s', 'glam, prog'] }),
    question(2, { category: 'history', tags: ['kings'] }),
  ]);
  assert.deepEqual(bank.draw(1, { categories: ["rock 'n' roll"] })[0].tags, ['1970s', 'glam, prog'], 'the comma in the tag is part of it');
  assert.equal(bank.count({ tags: ['glam, prog'] }), 1, 'and a list of filters says where one ends without a separator');
  // The comma-separated form is the API's own, so a name with a comma in it cannot be asked for that way: it splits.
  assert.equal(bank.count({ tags: 'glam, prog' }), 0, 'asked as a string, it is two tags, and nothing has either');
  assert.equal(bank.count({ tags: '1970s,kings' }), 2, 'which is what makes the ordinary form useful');
});

test('an id with awkward characters is still an id, and still only held once', () => {
  const bank = bankOf();
  const odd = `q,1"2'3\\4`;
  assert.equal(bank.add([question(1, { id: odd })]), 1);
  assert.equal(bank.add([question(2, { id: odd })]), 0, 'the same id, whatever is in it');
  assert.equal(bank.draw(1)[0].id, odd);
  // Without an id the question text is the id, so an awkward question text has to work as one too.
  assert.equal(bank.add([question(3, { id: undefined, question: AWKWARD[0] })]), 1);
  assert.equal(bank.add([question(4, { id: undefined, question: AWKWARD[0] })]), 0);
});

