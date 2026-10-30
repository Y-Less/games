import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollections } from './collections.js';
import { openDatabase } from './db.js';

function setup() {
  const db = openDatabase(':memory:');
  const user = (name) =>
    Number(db.prepare("INSERT INTO users (username, username_lower, password_hash, display_name, is_bot, created_at) VALUES (?, ?, 'x', ?, 0, 0)").run(name, name, name).lastInsertRowid);
  return { db, user };
}

test('a collection counts each different number once, however often it is added', () => {
  const { db, user } = setup();
  const ann = user('ann');
  const sets = createCollections(db);
  assert.equal(sets.add(ann, 'dixnt.art', [10001, 10002, 10001]), 2);
  assert.equal(sets.add(ann, 'dixnt.art', [10002, 80256, 0]), 4);
  assert.equal(sets.count(ann, 'dixnt.art'), 4);
  assert.equal(sets.add(ann, 'dixnt.art', [-1, 1.5, NaN, 'x', 2_000_000]), 4, 'things that are not numbers of a collection are ignored');
});

test('collections are kept for each player and id, and survive a restart', () => {
  const { db, user } = setup();
  const [ann, bob] = [user('ann'), user('bob')];
  const sets = createCollections(db);
  sets.add(ann, 'a', [1, 2, 3]);
  sets.add(bob, 'a', [3]);
  sets.add(ann, 'b', [9]);
  assert.deepEqual([sets.count(ann, 'a'), sets.count(bob, 'a'), sets.count(ann, 'b')], [3, 1, 1]);
  const again = createCollections(db); // a fresh start reads what was saved
  assert.equal(again.count(ann, 'a'), 3);
  assert.equal(again.add(ann, 'a', [3, 4]), 4);
  assert.equal(createCollections(db).count(ann, 'a'), 4);
});

test('the blob is only as long as the highest number needs', () => {
  const { db, user } = setup();
  const ann = user('ann');
  createCollections(db).add(ann, 'a', [15]);
  assert.equal(db.prepare('SELECT length(bits) AS n FROM achievement_sets').get().n, 2);
});
