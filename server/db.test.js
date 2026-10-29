// The database: creation, reopening, and migrating a database made before the card_back column existed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from './auth.js';
import { openDatabase } from './db.js';
import { register, withSite, workspace } from './fixtures/testkit.js';

const OLD_USERS = `CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  background TEXT NOT NULL DEFAULT '{"type":"preset","value":"night"}',
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);`;

const columnsOf = (db) => db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const tablesOf = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);

/** Makes a database the way the site did before card backs: the old users table and one account, via the real code. */
async function oldDatabase(dir) {
  const old = new DatabaseSync(path.join(dir, 'hub.sqlite'));
  old.exec('PRAGMA journal_mode = WAL;');
  old.exec(OLD_USERS);
  old.exec(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
  assert.ok(!columnsOf(old).includes('card_back'));
  const { user, token } = await createAuth(old).register({ username: 'veteran', password: 'old password', displayName: 'Old Timer' });
  old.prepare("UPDATE users SET background = ? WHERE id = ?").run('{"type":"preset","value":"forest"}', user.id);
  old.close();
  return { user, token };
}

test('a new database has every table, foreign keys on and WAL journalling', (t) => {
  const { dir, track } = workspace(t);
  const db = track(openDatabase(dir));
  assert.deepEqual(tablesOf(db).filter((n) => !n.startsWith('sqlite_')).sort(), ['coin_ledger', 'owned_items', 'result_players', 'results', 'sessions', 'users']);
  assert.ok(columnsOf(db).includes('card_back'));
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.ok(fs.existsSync(path.join(dir, 'hub.sqlite')));
});

test('openDatabase creates missing folders, and ":memory:" touches no disk', (t) => {
  const { dir, track } = workspace(t);
  const nested = path.join(dir, 'a', 'b', 'c');
  track(openDatabase(nested));
  assert.ok(fs.existsSync(path.join(nested, 'hub.sqlite')));
  const memory = openDatabase(':memory:');
  memory.close();
  assert.ok(!fs.existsSync(path.join(process.cwd(), ':memory:')));
});

test('reopening a database keeps its data and does not fail on the existing schema', async (t) => {
  const { dir, track } = workspace(t);
  const first = track(openDatabase(dir));
  const { user } = await createAuth(first).register({ username: 'keeper', password: 'password1' });
  first.close();
  const second = track(openDatabase(dir));
  assert.equal(createAuth(second).userById(user.id).username, 'keeper');
  assert.equal(columnsOf(second).filter((c) => c === 'card_back').length, 1);
  second.close();
  const third = track(openDatabase(dir));
  third.close();
});

test('a database created without the card_back column gets it on open, and keeps its users', async (t) => {
  const { dir, track } = workspace(t);
  const { user } = await oldDatabase(dir);
  const db = track(openDatabase(dir));
  assert.ok(columnsOf(db).includes('card_back'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  const migrated = createAuth(db).userById(user.id);
  assert.equal(migrated.username, 'veteran');
  assert.equal(migrated.displayName, 'Old Timer');
  assert.deepEqual(migrated.background, { type: 'preset', value: 'forest' }, 'existing settings are untouched');
  assert.deepEqual(migrated.cardBack, { type: 'preset', value: 'crimson' }, 'the new column has its default');
  assert.deepEqual(tablesOf(db).filter((n) => !n.startsWith('sqlite_')).sort(), ['coin_ledger', 'owned_items', 'result_players', 'results', 'sessions', 'users'], 'the newer tables were added');
  assert.equal(createAuth(db).updateProfile(user.id, { cardBack: { type: 'preset', value: 'gold' } }).cardBack.value, 'gold');
  const login = await createAuth(db).login({ username: 'veteran', password: 'old password' });
  assert.equal(login.user.id, user.id, 'the old password still works');
});

test('the whole site starts on an old database, and an old session still works after the migration', async (t) => {
  const { dir, track } = workspace(t);
  const { token } = await oldDatabase(dir);
  const { client, close, site } = await withSite(t, { dataDir: dir, shopLocked: true });
  track({ close });
  const c = client();
  c.setCookie(`sid=${token}`);
  const me = (await c.get('/api/me')).data.user;
  assert.equal(me.username, 'veteran');
  assert.deepEqual(me.cardBack, { type: 'preset', value: 'crimson' });
  assert.deepEqual(me.background, { type: 'preset', value: 'forest' }, 'what they already used is theirs to keep');
  assert.equal((await c.patch('/api/me', { cardBack: { type: 'preset', value: 'teal' } })).status, 403, 'but the rest is for sale');
  site.db.prepare("INSERT INTO owned_items (user_id, item_id, bought_at) VALUES (?, 'cb:teal', 0)").run(me.id);
  assert.equal((await c.patch('/api/me', { cardBack: { type: 'preset', value: 'teal' } })).data.user.cardBack.value, 'teal');
  assert.equal((await register(client(), 'newcomer', 'password1')).data.user.cardBack.value, 'crimson');
  const owned = site.db.prepare('SELECT item_id FROM owned_items WHERE user_id = ? ORDER BY item_id').all(me.id).map((r) => r.item_id);
  assert.deepEqual(owned, ['bg:forest', 'cb:teal']);
});

test('deleting a user removes their sessions (cascade)', async (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const { user } = await createAuth(db).register({ username: 'doomed', password: 'password1' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('the database refuses an outcome other than win, loss or draw', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  db.prepare("INSERT INTO users (id, username, username_lower, password_hash, display_name, created_at) VALUES (1, 'a', 'a', 'x', 'a', 0)").run();
  db.prepare("INSERT INTO results (id, game, finished_at) VALUES (1, 'g', 0)").run();
  assert.throws(() => db.prepare("INSERT INTO result_players (result_id, user_id, outcome) VALUES (1, 1, 'won')").run());
  db.prepare("INSERT INTO result_players (result_id, user_id, outcome) VALUES (1, 1, 'draw')").run();
});

test('the two Matrix backgrounds become one: the first keeps its owners and users under the new id, and the owners of the second have the one that is left', async (t) => {
  const { dir, track } = workspace(t);
  const first = track(openDatabase(dir));
  const user = (id, animation) => first.prepare("INSERT INTO users (id, username, username_lower, password_hash, display_name, created_at, background_animation) VALUES (?, ?, ?, 'x', ?, 0, ?)").run(id, `u${id}`, `u${id}`, `U${id}`, animation);
  user(1, 'matrix-a'); // chose the first Matrix
  user(2, 'matrix'); // chose the second
  user(3, 'sweep'); // chose something else
  user(4, 'none'); // owns both, uses neither
  const own = (id, item) => first.prepare('INSERT INTO owned_items (user_id, item_id, bought_at) VALUES (?, ?, 5)').run(id, item);
  own(1, 'ba:matrix-a');
  own(2, 'ba:matrix');
  own(3, 'ba:sweep');
  own(4, 'ba:matrix-a');
  own(4, 'ba:matrix');
  first.close();

  const db = track(openDatabase(dir));
  const animations = db.prepare('SELECT id, background_animation AS a FROM users ORDER BY id').all().map((r) => r.a);
  assert.deepEqual(animations, ['matrix', 'matrix', 'sweep', 'none']);
  const items = db.prepare('SELECT user_id AS u, item_id AS i FROM owned_items ORDER BY user_id, item_id').all().map((r) => `${r.u}:${r.i}`);
  assert.deepEqual(items, ['1:ba:matrix', '2:ba:matrix', '3:ba:sweep', '4:ba:matrix'], 'one item each, none left under the old id');
  assert.equal(db.prepare("SELECT bought_at FROM owned_items WHERE user_id = 1").get().bought_at, 5, 'the purchase date is kept');
  db.close();

  // Opening it again changes nothing.
  const again = track(openDatabase(dir));
  assert.equal(again.prepare('SELECT COUNT(*) AS n FROM owned_items').get().n, 4);
  assert.equal(again.prepare("SELECT COUNT(*) AS n FROM users WHERE background_animation = 'matrix'").get().n, 2);
});
