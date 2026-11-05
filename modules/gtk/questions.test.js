// The content of GTK: enough questions, each asked in both forms, and a pool of plausible answers behind every one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { POOLS, QUESTIONS, answersFor, normal } from './questions.js';

test('there are plenty of questions and no two share an id', () => {
  assert.ok(QUESTIONS.length >= 100, `there are ${QUESTIONS.length} questions`);
  const ids = QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'every id is unique');
});

test('every question is asked of the subject and of everybody else', () => {
  for (const question of QUESTIONS) {
    assert.ok(question.you.trim().endsWith('?'), `${question.id}: the subject is asked a question`);
    assert.ok(question.about.trim().endsWith('?'), `${question.id}: the others are asked a question`);
    assert.ok(!question.you.includes('{name}'), `${question.id}: the subject is asked about themselves`);
    assert.ok(question.about.includes('{name}'), `${question.id}: the others are told whom it is about`);
    assert.notEqual(question.you, question.about, `${question.id}: the two forms differ`);
  }
});

test('every question has a pool of plausible answers, and no pool goes unused', () => {
  for (const question of QUESTIONS) {
    const pool = answersFor(question);
    assert.ok(pool.length >= 8, `${question.id}: its pool has ${pool.length} answers`);
    assert.equal(new Set(pool.map(normal)).size, pool.length, `${question.id}: its pool has no two answers that count as the same`);
  }
  const used = new Set(QUESTIONS.map((q) => q.pool));
  assert.deepEqual(Object.keys(POOLS).filter((key) => !used.has(key)), [], 'every pool is asked for by some question');
  assert.deepEqual(answersFor({ pool: 'no-such-pool' }), [], 'an unknown pool is empty rather than a crash');
  assert.deepEqual(answersFor(null), []);
});

test('answers that come to the same thing compare equal', () => {
  assert.equal(normal('Carrots'), normal('carrot'));
  assert.equal(normal('The Red Panda'), normal('red pandas'));
  assert.equal(normal('  fish   and chips!'), normal('Fish and Chips'));
  assert.notEqual(normal('a cat'), normal('a dog'));
  assert.equal(normal('   '), '');
  assert.equal(normal('!?!'), '');
  assert.equal(normal(null), '');
  assert.equal(normal(undefined), '');
  assert.equal(normal('as'), 'as', 'a short word keeps its s');
});
