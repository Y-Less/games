// Tests for the shared tournament helpers (shared/arena.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roundRobin, rotated } from './arena.js';

test('the lineup turns round by one seat each game', () => {
  const lineup = ['a', 'b', 'c'];
  assert.deepEqual(rotated(lineup, 0), ['a', 'b', 'c']);
  assert.deepEqual(rotated(lineup, 1), ['b', 'c', 'a']);
  assert.deepEqual(rotated(lineup, 2), ['c', 'a', 'b']);
  assert.deepEqual(rotated(lineup, 3), ['a', 'b', 'c']);
  assert.deepEqual(lineup, ['a', 'b', 'c']);
});

test('a round-robin gives each AI the seeds, tables, mean score and win share it played', () => {
  const seen = [];
  // The AI in seat 0 scores 10 and wins, except in game 2, where seats 0 and 1 share the win.
  const play = (table, seed, game) => {
    seen.push({ table, seed, game });
    return { winners: game === 2 ? [0, 1] : [0], scores: [10, 4] };
  };
  const tally = roundRobin(['x', 'y'], { games: 4, seed: 7, play, totalOf: (room, seat) => room.scores[seat] });
  assert.deepEqual(seen.map((s) => s.seed), [700000, 700001, 700002, 700003]);
  assert.deepEqual(seen.map((s) => s.table.join('')), ['xy', 'yx', 'xy', 'yx']);
  assert.deepEqual(tally.x, { games: 4, total: 28, wins: 1.5, mean: 7, winRate: 0.375 });
  assert.deepEqual(tally.y, { games: 4, total: 28, wins: 2.5, mean: 7, winRate: 0.625 });
});

test('an AI sitting twice at the table is counted for both seats', () => {
  const tally = roundRobin(['x', 'x', 'y'], { games: 3, play: () => ({ winners: [2], scores: [1, 1, 5] }), totalOf: (room, seat) => room.scores[seat] });
  assert.equal(tally.x.games, 6);
  assert.equal(tally.y.games, 3);
  assert.equal(tally.y.wins, 1);
  assert.equal(tally.y.mean, 7 / 3);
});
