// The timer behind "what the server does next by itself" (shared/scheduler.js).  A computer player's move and the pause
// at the end of a trick both hang on it, so what is protected here is that a room is owed exactly one thing at a time,
// that a timer for a room which has gone does nothing, that a throw never escapes from a timer or leaves a room stuck,
// and that a room which keeps throwing is left alone after a few tries rather than retried for ever.
//
// The clock is node:test's mock of setTimeout throughout, so nothing here waits for real time or depends on how busy
// the machine is: `tick` is the only thing that moves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from './random.js';
import { createScheduler } from './scheduler.js';

/**
 * A scheduler over a table of rooms, with a mocked clock.  `owed` says what each room is owed next (by code), which is
 * what a game's `nextAction` would work out; a test changes it as it goes.
 */
function rig(t, { changed } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rooms = new Map();
  const owed = new Map();
  const logs = [];
  const changes = [];
  let asked = 0;
  const scheduler = createScheduler({
    nextAction: (room) => {
      asked++;
      const next = owed.get(room.code);
      return typeof next === 'function' ? next(room) : (next ?? null);
    },
    current: (room) => rooms.get(room.code) === room,
    changed: (room) => {
      changes.push(room.code);
      changed?.(room);
    },
    log: (...args) => logs.push(args.map(String).join(' ')),
  });
  const room = (code) => {
    const made = { code };
    rooms.set(code, made);
    return made;
  };
  // A millisecond at a time: a timer set by a timer that has just fired (a retry scheduling the move it retries) is
  // only noticed by the mock on the tick after, and one big tick would leave it waiting.
  const tick = (ms) => {
    for (let i = 0; i < ms; i++) t.mock.timers.tick(1);
  };
  return { scheduler, rooms, owed, logs, changes, room, tick, asked: () => asked };
}

/** An action that notes it ran. */
const noting = (ran, name, wait, key) => ({ key, wait, run: () => ran.push(name) });

test('an action runs once, after its wait and not before, and the server is then told the room changed', (t) => {
  const { scheduler, owed, changes, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  owed.set('a', noting(ran, 'move', 500));
  scheduler.schedule(a);
  assert.deepEqual(ran, [], 'nothing runs at the moment it is scheduled');
  tick(499);
  assert.deepEqual(ran, []);
  assert.deepEqual(changes, []);
  tick(1);
  assert.deepEqual(ran, ['move']);
  assert.deepEqual(changes, ['a'], 'told after the action has run');
  tick(60_000);
  assert.deepEqual(ran, ['move'], 'and it does not run again by itself');
});

test('the server is told the room changed only after the action has finished', (t) => {
  const order = [];
  const { scheduler, owed, room, tick } = rig(t, { changed: () => order.push('changed') });
  owed.set('a', { wait: 10, run: () => order.push('run') });
  scheduler.schedule(room('a'));
  tick(10);
  assert.deepEqual(order, ['run', 'changed']);
});

test('a room that is owed nothing gets no timer, and loses the one it had', (t) => {
  const { scheduler, owed, changes, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  scheduler.schedule(a);
  tick(60_000);
  assert.deepEqual(changes, [], 'nothing owed, nothing done');
  owed.set('a', noting(ran, 'move', 100));
  scheduler.schedule(a);
  owed.delete('a'); // somebody acted, and the game no longer owes the room anything
  scheduler.schedule(a);
  tick(60_000);
  assert.deepEqual(ran, []);
  assert.deepEqual(changes, []);
});

test('scheduling again replaces the earlier timer, so a room is only ever owed one thing', (t) => {
  const { scheduler, owed, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  owed.set('a', noting(ran, 'first', 100));
  scheduler.schedule(a);
  tick(60);
  owed.set('a', noting(ran, 'second', 100));
  scheduler.schedule(a);
  tick(40);
  assert.deepEqual(ran, [], 'the first was replaced, and the second counts its wait from when it was set');
  tick(60);
  assert.deepEqual(ran, ['second']);
  tick(60_000);
  assert.deepEqual(ran, ['second']);
});

test('an action with the same key as the one waiting keeps the existing timer rather than restarting it', (t) => {
  const { scheduler, owed, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  owed.set('a', noting(ran, 'pause', 100, 'trick-3'));
  scheduler.schedule(a);
  // Views are sent on every change, and each one reschedules: a pause must not be pushed back by people looking.
  for (let i = 0; i < 9; i++) {
    tick(10);
    scheduler.schedule(a);
  }
  assert.deepEqual(ran, []);
  tick(10);
  assert.deepEqual(ran, ['pause'], 'it ran a hundred milliseconds after it was first set');
  tick(60_000);
  assert.deepEqual(ran, ['pause'], 'and once');
});

test('an action with a different key replaces the one waiting', (t) => {
  const { scheduler, owed, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  owed.set('a', noting(ran, 'trick-3', 100, 'trick-3'));
  scheduler.schedule(a);
  tick(60);
  owed.set('a', noting(ran, 'trick-4', 100, 'trick-4'));
  scheduler.schedule(a);
  tick(40);
  assert.deepEqual(ran, []);
  tick(60);
  assert.deepEqual(ran, ['trick-4']);
});

test('a key is forgotten once its action has run, so the same key can be owed again', (t) => {
  const { scheduler, owed, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  owed.set('a', noting(ran, 'tick', 50, 'same'));
  scheduler.schedule(a);
  tick(50);
  scheduler.schedule(a);
  tick(50);
  assert.deepEqual(ran, ['tick', 'tick']);
});

test('a timer that fires for a room which has been discarded or replaced does nothing', (t) => {
  const { scheduler, rooms, owed, changes, room, tick } = rig(t);
  const ran = [];
  const gone = room('a');
  owed.set('a', noting(ran, 'move', 100));
  scheduler.schedule(gone);
  rooms.delete('a');
  tick(100);
  assert.deepEqual(ran, [], 'discarded');
  const old = room('b');
  owed.set('b', noting(ran, 'move', 100));
  scheduler.schedule(old);
  rooms.set('b', { code: 'b' }); // another room now lives under that code
  tick(100);
  assert.deepEqual(ran, [], 'replaced');
  assert.deepEqual(changes, []);
});

test('cancel stops one room and leaves the others, and a cancelled room can be scheduled again', (t) => {
  const { scheduler, owed, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  const b = room('b');
  owed.set('a', noting(ran, 'a', 100, 'k'));
  owed.set('b', noting(ran, 'b', 100, 'k'));
  scheduler.schedule(a);
  scheduler.schedule(b);
  scheduler.cancel('a');
  scheduler.cancel('nobody'); // a room with no timer is not a mistake
  tick(100);
  assert.deepEqual(ran, ['b']);
  scheduler.schedule(a);
  tick(100);
  assert.deepEqual(ran, ['b', 'a'], 'the key it was cancelled with does not stop it being set again');
});

test('stop clears every timer', (t) => {
  const { scheduler, owed, changes, room, tick } = rig(t);
  const ran = [];
  for (const code of ['a', 'b', 'c']) {
    owed.set(code, noting(ran, code, 100));
    scheduler.schedule(room(code));
  }
  scheduler.stop();
  tick(60_000);
  assert.deepEqual(ran, []);
  assert.deepEqual(changes, []);
});

test('each room has its own timer: one room being rescheduled or failing does not disturb another', (t) => {
  const { scheduler, owed, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  const b = room('b');
  owed.set('a', noting(ran, 'a', 100));
  owed.set('b', { wait: 50, run: () => { throw new Error('b is broken'); } });
  scheduler.schedule(a);
  scheduler.schedule(b);
  tick(100);
  assert.deepEqual(ran, ['a']);
});

// ---- when something throws ----

test('a move that throws is logged, does not escape, and is tried again after a second', (t) => {
  const { scheduler, owed, logs, changes, room, tick } = rig(t);
  let attempts = 0;
  owed.set('a', () => ({
    wait: 10,
    run: () => {
      attempts++;
      if (attempts === 1) throw new Error('the bot fell over');
    },
  }));
  scheduler.schedule(room('a'));
  assert.doesNotThrow(() => tick(10));
  assert.equal(attempts, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /the bot fell over/);
  assert.deepEqual(changes, [], 'a move that failed is not announced as a change');
  tick(999);
  assert.equal(attempts, 1, 'not retried at once');
  tick(1 + 10);
  assert.equal(attempts, 2, 'the game was asked again what it owes, and that ran');
  assert.deepEqual(changes, ['a']);
});

test('working out the next move throwing is logged and retried the same way, and does not escape from schedule', (t) => {
  const { scheduler, owed, logs, room, tick } = rig(t);
  const ran = [];
  let asks = 0;
  owed.set('a', () => {
    asks++;
    if (asks === 1) throw new Error('the rules broke');
    return noting(ran, 'move', 10);
  });
  assert.doesNotThrow(() => scheduler.schedule(room('a')));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /the rules broke/);
  tick(1000 + 10);
  assert.deepEqual(ran, ['move']);
});

test('telling everybody afterwards throwing counts as a failed move: logged, and tried again', (t) => {
  let told = 0;
  const { scheduler, owed, logs, room, tick } = rig(t, {
    changed: () => {
      told++;
      if (told === 1) throw new Error('could not save');
    },
  });
  const ran = [];
  owed.set('a', noting(ran, 'move', 10));
  scheduler.schedule(room('a'));
  assert.doesNotThrow(() => tick(10));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /could not save/);
  tick(1000 + 10);
  assert.equal(told, 2, 'the room was not left waiting for ever');
});

test('a room that keeps throwing is tried three more times, each wait double the last, and then left alone', (t) => {
  const { scheduler, owed, logs, room, tick, asked } = rig(t);
  owed.set('a', () => { throw new Error('always broken'); });
  scheduler.schedule(room('a'));
  // The first try, then retries after 1 s, 2 s and 4 s: at 1000, 3000 and 7000 ms.
  const seen = [asked()];
  for (const ms of [999, 1, 1999, 1, 3999, 1]) {
    tick(ms);
    seen.push(asked());
  }
  assert.deepEqual(seen, [1, 1, 2, 2, 3, 3, 4]);
  tick(60_000);
  assert.equal(asked(), 4, 'after three retries in a row it waits for a person to do something');
  assert.equal(logs.length, 4, 'every failure was logged, including the last');
});

test('forget starts the count afresh, so a room somebody has acted in is worth trying for again', (t) => {
  const { scheduler, owed, room, tick, asked } = rig(t);
  const a = room('a');
  owed.set('a', () => { throw new Error('always broken'); });
  scheduler.schedule(a);
  tick(60_000);
  assert.equal(asked(), 4);
  scheduler.forget('a');
  scheduler.schedule(a);
  tick(60_000);
  assert.equal(asked(), 8, 'the whole run of retries again, not one last try');
});

test('without forget, a room that has used up its retries is not retried when it fails again', (t) => {
  const { scheduler, owed, room, tick, asked } = rig(t);
  const a = room('a');
  owed.set('a', () => { throw new Error('always broken'); });
  scheduler.schedule(a);
  tick(60_000);
  scheduler.schedule(a);
  tick(60_000);
  assert.equal(asked(), 5, 'the one try it was asked for, and no retries');
});

test('the count is each room’s own', (t) => {
  const { scheduler, owed, room, tick } = rig(t);
  let aAsks = 0;
  let bAsks = 0;
  owed.set('a', () => { aAsks++; throw new Error('a is broken'); });
  owed.set('b', () => { bAsks++; throw new Error('b is broken'); });
  scheduler.schedule(room('a'));
  tick(60_000);
  scheduler.schedule(room('b'));
  tick(60_000);
  assert.equal(aAsks, 4);
  assert.equal(bAsks, 4, 'one room running out of retries does not use up another’s');
});

test('a retry for a room that has gone in the meantime does nothing', (t) => {
  const { scheduler, rooms, owed, room, tick, asked } = rig(t);
  owed.set('a', () => { throw new Error('always broken'); });
  scheduler.schedule(room('a'));
  rooms.delete('a');
  tick(60_000);
  assert.equal(asked(), 1);
});

test('cancel and stop also stop a retry that is waiting', (t) => {
  const { scheduler, owed, room, tick, asked } = rig(t);
  owed.set('a', () => { throw new Error('always broken'); });
  owed.set('b', () => { throw new Error('always broken'); });
  scheduler.schedule(room('a'));
  scheduler.cancel('a');
  tick(60_000);
  assert.equal(asked(), 1);
  scheduler.schedule(room('b'));
  scheduler.stop();
  tick(60_000);
  assert.equal(asked(), 2);
});

test('somebody acting while a retry is waiting gets the room scheduled at once, and the retry does not then run a second move', (t) => {
  const { scheduler, owed, room, tick } = rig(t);
  const ran = [];
  const a = room('a');
  let broken = true;
  owed.set('a', () => {
    if (broken) throw new Error('broken for now');
    return noting(ran, 'move', 100, 'k');
  });
  scheduler.schedule(a);
  tick(500);
  broken = false;
  scheduler.forget('a');
  scheduler.schedule(a);
  tick(100);
  assert.deepEqual(ran, ['move']);
  owed.delete('a');
  tick(60_000);
  assert.deepEqual(ran, ['move']);
});

// ---- at random ----

test('fuzz: whatever order rooms are scheduled, cancelled, discarded, and left to run in, each runs exactly what it was last owed', () => {
  // Checked against a model that holds, per room, the one thing it is owed and when: the promises above, all at once.
  for (const seed of [11, 12, 13, 0x5eed]) {
    test.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const rng = seeded(seed);
      const codes = ['a', 'b', 'c'];
      const rooms = new Map();
      const owed = new Map();
      const ran = [];
      const expected = [];
      const pending = new Map(); // code -> { at, name, key, room }
      let clock = 0;
      let made = 0;
      const scheduler = createScheduler({
        nextAction: (room) => owed.get(room.code) ?? null,
        current: (room) => rooms.get(room.code) === room,
        changed: () => {},
        log: (...args) => assert.fail(`seed ${seed}: something was logged: ${args.join(' ')}`),
      });
      for (const code of codes) rooms.set(code, { code });
      for (let step = 0; step < 800; step++) {
        const where = `seed ${seed}, step ${step}`;
        const code = codes[Math.floor(rng() * codes.length)];
        const roll = rng();
        if (roll < 0.45) {
          // What the room is owed changes (or does not), and it is scheduled.
          const kind = rng();
          if (kind < 0.2) owed.delete(code);
          else if (kind < 0.8) {
            const name = `${code}${++made}`;
            const key = rng() < 0.5 ? undefined : `key${Math.floor(rng() * 3)}`;
            owed.set(code, { key, wait: Math.floor(rng() * 200), run: () => ran.push(name), name });
          }
          const room = rooms.get(code);
          scheduler.schedule(room);
          const action = owed.get(code);
          const waiting = pending.get(code);
          if (!action) pending.delete(code);
          else if (!(action.key !== undefined && waiting?.key === action.key)) pending.set(code, { at: clock + action.wait, name: action.name, key: action.key, room });
        } else if (roll < 0.55) {
          scheduler.cancel(code);
          pending.delete(code);
        } else if (roll < 0.62) {
          // Discarded and made again under the same code.  Whoever discards a room cancels its timer first (see
          // roomLife's `discard`); a timer left to fire for a room that has gone has a test of its own above.
          scheduler.cancel(code);
          pending.delete(code);
          rooms.set(code, { code });
        } else if (roll < 0.65) {
          scheduler.stop();
          pending.clear();
        } else {
          const by = Math.floor(rng() * 150);
          clock += by;
          for (const [waitingCode, waiting] of [...pending]) {
            if (waiting.at > clock) continue;
            pending.delete(waitingCode);
            if (rooms.get(waitingCode) === waiting.room) expected.push(waiting.name);
          }
          test.mock.timers.tick(by);
        }
        // Rooms are independent, so the order between two rooms due in the same tick is nobody's promise.
        for (const each of codes) {
          const of = (list) => list.filter((name) => name.startsWith(each));
          assert.deepEqual(of(ran), of(expected), `${where}: what room ${each} has run`);
        }
      }
      assert.ok(ran.length > 20, `seed ${seed}: the run exercised very little (${ran.length} moves)`);
    } finally {
      test.mock.timers.reset();
    }
  }
});
