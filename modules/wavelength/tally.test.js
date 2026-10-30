import test from 'node:test';
import assert from 'node:assert/strict';
import { newCounters, tallyTurn } from './tally.js';

test('guesses and how far they were from the target are counted', () => {
  const players = { a: newCounters(), b: newCounters() };
  tallyTurn(
    [
      { id: 'a', position: 40, distance: 10, points: 3, bullseye: false },
      { id: 'b', position: 100, distance: 55, points: 0, bullseye: false },
    ],
    (id) => players[id],
    undefined,
  );
  assert.deepEqual([players.a.guesses, players.a.missDistance], [1, 10]);
  assert.deepEqual([players.b.guesses, players.b.missDistance], [1, 55]);
});
