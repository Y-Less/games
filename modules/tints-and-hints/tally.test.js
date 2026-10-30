import test from 'node:test';
import assert from 'node:assert/strict';
import { CORNERS, cellNumber, distance } from './grid.js';
import { ALEX, newCounters, statsExtras, tallyTurn } from './tally.js';

const people = () => ({ ann: newCounters(), bob: newCounters(), cat: newCounters() });
const entry = (id, round, cell, kind) => ({ id, round, cell, kind });
const turn = (p, entries, target = 'M9') => tallyTurn({ entries, playerOf: (id) => p[id], hinter: p.cat, target });

test('distance counts columns plus rows, never diagonals, and the corners are the four ends of the grid', () => {
  assert.equal(distance('M9', 'M9'), 0);
  assert.equal(distance('M9', 'N10'), 2, 'a diagonal step is across and down');
  assert.equal(distance('A1', 'AZ24'), 51 + 23);
  assert.deepEqual(CORNERS, ['A1', 'AZ1', 'A24', 'AZ24']);
  assert.equal(new Set(CORNERS.map(cellNumber)).size, 4);
  assert.equal(cellNumber('A1'), 0);
  assert.equal(cellNumber('A24'), 23);
  assert.equal(cellNumber('B1'), 24);
  assert.equal(cellNumber('not a square'), -1);
});

test('a turn counts each guess by kind, the distance, a first exact guess and the hint', () => {
  const p = people();
  turn(p, [entry('ann', 1, 'M9', 'exact'), entry('bob', 1, 'P9', 'miss'), entry('ann', 2, 'M9', 'exact'), entry('bob', 2, 'N9', 'close')]);
  assert.deepEqual([p.ann.exactGuesses, p.ann.firstExact, p.ann.distance], [2, 1, 0]);
  assert.deepEqual([p.bob.missGuesses, p.bob.closeGuesses, p.bob.distance], [1, 1, 3 + 1]);
  assert.equal(p.cat.hintsGiven, 1);
  assert.equal(p.cat.leeks, 0, 'the first hint scored');
  const late = people();
  turn(late, [entry('ann', 2, 'M9', 'exact')]);
  assert.equal(late.ann.firstExact, 0, 'found on the second guess');
});

test('a leek: nobody scores on the first hint and somebody finds the square on the second', () => {
  const p = people();
  turn(p, [entry('ann', 1, 'A1', 'miss'), entry('bob', 1, 'B2', 'miss'), entry('ann', 2, 'M9', 'exact'), entry('bob', 2, 'M10', 'close')]);
  assert.equal(p.cat.leeks, 1);
  const close = people();
  turn(close, [entry('ann', 1, 'M10', 'close'), entry('bob', 1, 'B2', 'miss'), entry('ann', 2, 'M9', 'exact')]);
  assert.equal(close.cat.leeks, 0, 'a close guess scored on the first');
  const never = people();
  turn(never, [entry('ann', 1, 'A1', 'miss'), entry('ann', 2, 'A2', 'miss')]);
  assert.equal(never.cat.leeks, 0, 'nobody found it');
});

test('a turn with the secret square in column A, L, E or X counts once for the hinter, however many hints', () => {
  assert.deepEqual(ALEX, ['A', 'L', 'E', 'X']);
  for (const [target, expected] of [['A5', 1], ['L1', 1], ['E24', 1], ['X9', 1], ['AL3', 0], ['B5', 0], ['M9', 0]]) {
    const p = people();
    turn(p, [entry('ann', 1, target, 'exact'), entry('bob', 2, target, 'exact')], target);
    assert.equal(p.cat.alexTurns, expected, target);
  }
});

test('what is recorded', () => {
  assert.deepEqual(Object.keys(statsExtras(newCounters())).sort(), ['alexTurns', 'closeGuesses', 'distance', 'exactGuesses', 'firstExact', 'hintsGiven', 'leeks', 'missGuesses']);
});
