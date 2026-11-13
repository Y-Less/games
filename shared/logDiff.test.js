// The pieces every game's "Recent moves" shares (shared/logDiff.js): a line must appear on the step something happens
// and on no step after, because the client runs these on every state it is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { endOfGame, entering, nameIn, newlyFlagged } from './logDiff.js';
import { msg } from './messages.js';

const players = (...list) => list.map(([id, name, extra]) => ({ id, name, ...extra }));

test('entering is true on the step that reaches a phase, and only that one', () => {
  assert.equal(entering({ phase: 'lobby' }, { phase: 'playing' }, 'playing'), true);
  assert.equal(entering({ phase: 'playing' }, { phase: 'playing' }, 'playing'), false, 'still there is not entering');
  assert.equal(entering({ phase: 'lobby' }, { phase: 'playing' }, 'finished'), false, 'a different phase');
  assert.equal(entering({ phase: 'playing' }, { phase: 'lobby' }, 'playing'), false, 'leaving is not entering');
});

test('the first state received enters whatever phase it is in', () => {
  assert.equal(entering(null, { phase: 'playing' }, 'playing'), true);
  assert.equal(entering(undefined, { phase: 'playing' }, 'playing'), true);
  assert.equal(entering(null, { phase: 'playing' }, 'lobby'), false);
});

test('nameIn names a player from the new state, and somebody who has gone is Someone', () => {
  const name = nameIn({ players: players([1, 'Ann'], ['s2', 'Bob']) });
  assert.equal(name(1), 'Ann');
  assert.equal(name('s2'), 'Bob');
  assert.deepEqual(name(3), msg('common.someone'));
  assert.deepEqual(name(undefined), msg('common.someone'));
});

test('nameIn does not confuse an account id with a slot that looks like it', () => {
  // A slot is a string and an account id a number, deliberately (see shared/layout.js); 1 and '1' are different people.
  const name = nameIn({ players: players([1, 'Ann']) });
  assert.deepEqual(name('1'), msg('common.someone'));
});

test('nameIn keeps an empty name rather than calling its owner Someone', () => {
  assert.equal(nameIn({ players: players([1, '']) })(1), '');
});

test('newlyFlagged gives a line for each player whose flag has just turned true', () => {
  const prev = { players: players([1, 'Ann', { written: false }], [2, 'Bob', { written: true }], [3, 'Cy', { written: false }]) };
  const next = { players: players([1, 'Ann', { written: true }], [2, 'Bob', { written: true }], [3, 'Cy', { written: false }]) };
  assert.deepEqual(newlyFlagged(prev, next, 'written', 'log.written'), [msg('log.written', { name: 'Ann' })]);
});

test('newlyFlagged says nothing for the first state, whatever it holds', () => {
  const next = { players: players([1, 'Ann', { written: true }]) };
  assert.deepEqual(newlyFlagged(null, next, 'written', 'log.written'), []);
});

test('newlyFlagged says nothing when nothing changed, or when a flag went back', () => {
  const on = { players: players([1, 'Ann', { picked: true }]) };
  const off = { players: players([1, 'Ann', { picked: false }]) };
  assert.deepEqual(newlyFlagged(on, on, 'picked', 'log.picked'), []);
  assert.deepEqual(newlyFlagged(on, off, 'picked', 'log.picked'), []);
  assert.deepEqual(newlyFlagged(off, off, 'picked', 'log.picked'), []);
});

test('newlyFlagged follows the order of the new state, not the order people acted in', () => {
  const prev = { players: players([1, 'Ann', {}], [2, 'Bob', {}], [3, 'Cy', {}]) };
  const next = { players: players([3, 'Cy', { guessed: true }], [1, 'Ann', { guessed: true }], [2, 'Bob', {}]) };
  assert.deepEqual(newlyFlagged(prev, next, 'guessed', 'log.guessed').map((line) => line.params.name), ['Cy', 'Ann']);
});

test('newlyFlagged counts somebody who arrived already flagged, and uses the name they have now', () => {
  const prev = { players: players([1, 'Ann', { written: false }]) };
  const next = { players: players([1, 'Annie', { written: true }], [2, 'Bob', { written: true }]) };
  assert.deepEqual(newlyFlagged(prev, next, 'written', 'log.written'), [msg('log.written', { name: 'Annie' }), msg('log.written', { name: 'Bob' })]);
});

test('newlyFlagged leaves both states as they were', () => {
  const prev = Object.freeze({ players: Object.freeze(players([1, 'Ann', { written: false }]).map(Object.freeze)) });
  const next = Object.freeze({ players: Object.freeze(players([1, 'Ann', { written: true }]).map(Object.freeze)) });
  assert.equal(newlyFlagged(prev, next, 'written', 'log.written').length, 1);
});

test('endOfGame names the winners on the step the game finishes', () => {
  const next = { phase: 'finished', players: players([1, 'Ann', { winner: true }], [2, 'Bob', { winner: false }]) };
  assert.deepEqual(endOfGame({ phase: 'playing' }, next), [msg('log.gameOver', { names: ['Ann'], count: 1 })]);
});

test('endOfGame counts joint winners, in the order of the table', () => {
  const next = { phase: 'finished', players: players([2, 'Bob', { winner: true }], [1, 'Ann', { winner: true }], [3, 'Cy', {}]) };
  assert.deepEqual(endOfGame({ phase: 'playing' }, next), [msg('log.gameOver', { names: ['Bob', 'Ann'], count: 2 })]);
});

test('endOfGame says it once: not before the end, and not again after', () => {
  const finished = { phase: 'finished', players: players([1, 'Ann', { winner: true }]) };
  const playing = { phase: 'playing', players: players([1, 'Ann', { winner: true }]) };
  assert.deepEqual(endOfGame({ phase: 'lobby' }, playing), [], 'not finished yet');
  assert.deepEqual(endOfGame(finished, finished), [], 'already said');
});

test('endOfGame is quiet about a game that ended with no winner', () => {
  const next = { phase: 'finished', players: players([1, 'Ann', {}], [2, 'Bob', { winner: false }]) };
  assert.deepEqual(endOfGame({ phase: 'playing' }, next), []);
});

test('endOfGame speaks for somebody who opens the page on a finished game', () => {
  const next = { phase: 'finished', players: players([1, 'Ann', { winner: true }]) };
  assert.deepEqual(endOfGame(null, next), [msg('log.gameOver', { names: ['Ann'], count: 1 })]);
});
