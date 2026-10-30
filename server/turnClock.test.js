import test from 'node:test';
import assert from 'node:assert/strict';
import { isMyTurn, SLOW_TURN_MS, watchTurns } from './turnClock.js';

const view = (current) => ({ scoreboard: { players: [{ id: 0, isMe: false, current: !current }, { id: 1, isMe: true, current }] } });

function watcher() {
  let time = 1000;
  let slow = 0;
  const watch = watchTurns({ onSlow: () => slow++, now: () => time });
  return { watch, wait: (ms) => (time += ms), slow: () => slow };
}

test('a view says whether it is the turn of the player it was sent to', () => {
  assert.equal(isMyTurn(view(true)), true);
  assert.equal(isMyTurn(view(false)), false);
  assert.equal(isMyTurn(null), false);
  assert.equal(isMyTurn({}), false);
});

test('a turn that took over ten minutes counts when it ends while still connected', () => {
  const t = watcher();
  t.watch(view(true));
  t.wait(SLOW_TURN_MS);
  t.watch(view(false));
  assert.equal(t.slow(), 1);
  t.watch(view(false));
  assert.equal(t.slow(), 1, 'only once for the turn');
});

test('a quicker turn does not count', () => {
  const t = watcher();
  t.watch(view(true));
  t.wait(SLOW_TURN_MS - 1);
  t.watch(view(false));
  assert.equal(t.slow(), 0);
});

test('other updates during the turn do not restart the clock', () => {
  const t = watcher();
  t.watch(view(true));
  t.wait(SLOW_TURN_MS / 2);
  t.watch(view(true));
  t.wait(SLOW_TURN_MS / 2);
  t.watch(view(false));
  assert.equal(t.slow(), 1);
});

test('leaving the game (no view) ends the turn without counting it', () => {
  const t = watcher();
  t.watch(view(true));
  t.wait(SLOW_TURN_MS * 2);
  t.watch(null);
  assert.equal(t.slow(), 0);
});
