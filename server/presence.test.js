// How long somebody has been on the site: the clock runs while they have at least one page open, counts once however
// many they have, and survives the site being restarted under them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.js';
import { createPresence } from './presence.js';

function setup(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let n = 0;
  const addUser = (name) =>
    Number(db.prepare('INSERT INTO users (username, username_lower, password_hash, display_name, is_bot, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(name, name, 'x', name, ++n).lastInsertRowid);
  let clock = 1_000_000;
  const presence = createPresence(db, { now: () => clock });
  return { db, presence, addUser, tick: (seconds) => (clock += seconds * 1000) };
}

test('the clock runs from the first page opening to the last one closing', (t) => {
  const { presence, addUser, tick } = setup(t);
  const ann = addUser('ann');
  assert.equal(presence.seconds(ann), 0, 'somebody who has never been here has no time');

  presence.arrive(ann);
  tick(30);
  assert.equal(presence.seconds(ann), 30, 'the session counts while it is still open');
  assert.equal(presence.minutes(ann), 0, 'and only whole minutes count towards the achievement');
  tick(90);
  assert.equal(presence.minutes(ann), 2);

  assert.equal(presence.leave(ann), true, 'that was the last page');
  assert.equal(presence.seconds(ann), 120, 'the session was banked');
  tick(600);
  assert.equal(presence.seconds(ann), 120, 'and the clock stops while they are away');

  presence.arrive(ann);
  tick(60);
  assert.equal(presence.seconds(ann), 180, 'a second visit adds to the first');
});

test('two pages are one person: the time is not counted twice', (t) => {
  const { presence, addUser, tick } = setup(t);
  const ann = addUser('ann');
  presence.arrive(ann);
  presence.arrive(ann); // a second tab
  tick(60);
  assert.equal(presence.seconds(ann), 60, 'one minute of being here, not two');
  assert.equal(presence.leave(ann), false, 'one tab closing does not send them away');
  tick(60);
  assert.equal(presence.seconds(ann), 120, 'the clock kept running on the tab still open');
  assert.equal(presence.leave(ann), true);
  assert.equal(presence.seconds(ann), 120);
});

test('people are counted apart, and `here` says who is on the site', (t) => {
  const { presence, addUser, tick } = setup(t);
  const [ann, bob] = ['ann', 'bob'].map(addUser);
  presence.arrive(ann);
  tick(60);
  presence.arrive(bob);
  tick(60);
  assert.deepEqual(presence.here().sort(), [ann, bob].sort());
  assert.equal(presence.seconds(ann), 120);
  assert.equal(presence.seconds(bob), 60);
  presence.leave(ann);
  assert.deepEqual(presence.here(), [bob]);
});

test('closing the site keeps the time people are in the middle of, and does not count it twice', (t) => {
  const { presence, addUser, tick } = setup(t);
  const ann = addUser('ann');
  presence.arrive(ann);
  tick(45);
  presence.flush(); // the site is shutting down with Ann still connected
  assert.equal(presence.seconds(ann), 45, 'her 45 seconds are safe');
  tick(15);
  assert.equal(presence.seconds(ann), 60, 'and the clock carried on from where it was, not from zero');
  presence.leave(ann);
  assert.equal(presence.seconds(ann), 60, 'the banked part was not added a second time');
});

test('a part second is not lost: it is carried into the next banking', (t) => {
  const { db, presence, addUser, tick } = setup(t);
  const ann = addUser('ann');
  presence.arrive(ann);
  for (let i = 0; i < 4; i++) {
    tick(0.5); // half a second at a time, banked each time
    presence.flush();
  }
  assert.equal(presence.seconds(ann), 2, 'four half seconds are two whole ones');
  assert.equal(db.prepare('SELECT online_seconds AS s FROM users WHERE id = ?').get(ann).s, 2, 'and that is what was written down');
});

test('leaving without having arrived changes nothing', (t) => {
  const { presence, addUser } = setup(t);
  const ann = addUser('ann');
  assert.equal(presence.leave(ann), false);
  assert.equal(presence.seconds(ann), 0);
  assert.deepEqual(presence.here(), []);
});
