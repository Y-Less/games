// Tests for the shared "Recent moves" log (shared/moveLog.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOG_KEPT, addMove, recentMoves } from './moveLog.js';

test('lines are added at the end, with whatever fields the game gives them', () => {
  const room = { log: [] };
  addMove(room, { seat: 0, text: 'plays a card' });
  addMove(room, { seat: null, text: 'new hand', points: 2 });
  assert.deepEqual(room.log, [{ seat: 0, text: 'plays a card' }, { seat: null, text: 'new hand', points: 2 }]);
});

test('only the newest lines are kept, 60 unless the game says otherwise', () => {
  const room = { log: [] };
  for (let i = 0; i < LOG_KEPT + 5; i++) addMove(room, { seat: 0, text: String(i) });
  assert.equal(LOG_KEPT, 60);
  assert.equal(room.log.length, 60);
  assert.equal(room.log[0].text, '5');
  assert.equal(room.log.at(-1).text, '64');
  const small = { log: [] };
  for (let i = 0; i < 5; i++) addMove(small, { text: String(i) }, 3);
  assert.deepEqual(small.log.map((l) => l.text), ['2', '3', '4']);
});

test('recent moves is a copy of the last few lines', () => {
  const room = { log: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] };
  const recent = recentMoves(room, 2);
  assert.deepEqual(recent, [{ text: 'b' }, { text: 'c' }]);
  recent.pop();
  assert.equal(room.log.length, 3);
  assert.equal(recentMoves(room, 10).length, 3);
});
