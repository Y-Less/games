import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PERFECT_TURNS, newCounters, statsExtras, tallyTurn } from './tally.js';

const people = () => ({ ann: newCounters(), bob: newCounters(), cat: newCounters(), dan: newCounters() });
const clue = (writer, cancelled = false) => ({ writer, cancelled });

test('a turn counts the guess, the best hint, every clue and the clues that were cancelled', () => {
  const p = people();
  tallyTurn({ guesser: p.ann, best: p.bob, correct: true, clues: [clue(p.bob), clue(p.cat, true), clue(p.dan, true)] });
  assert.deepEqual([p.ann.guesserTurns, p.ann.correctGuesses, p.bob.bestHints], [1, 1, 1]);
  assert.deepEqual([p.cat.cluesGiven, p.cat.cancelledClues, p.bob.cancelledClues], [1, 1, 0]);
  assert.equal(p.cat.hiveMinds, 0, 'a clue got through');
});

test('a turn where every clue was cancelled is a hive mind for each writer, and a missed guess is not counted right', () => {
  const p = people();
  tallyTurn({ guesser: p.ann, best: null, correct: false, clues: [clue(p.bob, true), clue(p.cat, true), clue(null, true)] });
  assert.deepEqual([p.bob.hiveMinds, p.cat.hiveMinds], [1, 1]);
  assert.deepEqual([p.ann.guesserTurns, p.ann.correctGuesses], [1, 0]);
});

test('the perfect guesser guessed every turn they had, over enough turns', () => {
  const p = people();
  const turn = (correct) => tallyTurn({ guesser: p.ann, best: null, correct, clues: [] });
  turn(true);
  assert.equal(statsExtras(p.ann).perfectGuesser, 0, `one turn is too few: it takes ${MIN_PERFECT_TURNS}`);
  turn(true);
  assert.equal(statsExtras(p.ann).perfectGuesser, 1);
  turn(false);
  assert.equal(statsExtras(p.ann).perfectGuesser, 0);
  assert.equal(statsExtras(p.bob).perfectGuesser, 0, 'never a guesser');
  assert.equal(statsExtras(p.ann).guesserTurns, undefined, 'only what is recorded');
});
