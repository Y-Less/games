// The statement cache (server/sql.js).  Its two promises are what is protected here: a statement is compiled once
// however often it is asked for (userById runs on nearly every request), and it is compiled on first use rather than
// when the cache is made, so that a statement naming a column a migration adds can be written before the migration runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { statements } from './sql.js';

/** A stand-in database that only counts what it is asked to prepare. */
function countingDb() {
  const prepared = [];
  return { prepared, prepare: (sql) => (prepared.push(sql), { sql }) };
}

/** A real in-memory database, closed when the test ends. */
function memoryDb(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return db;
}

test('the same text is compiled once and the same statement comes back every time', () => {
  const db = countingDb();
  const q = statements(db);
  const first = q('SELECT 1');
  for (let i = 0; i < 50; i++) assert.equal(q('SELECT 1'), first, `call ${i}`);
  assert.deepEqual(db.prepared, ['SELECT 1'], 'prepare ran once, not once per call');
});

test('different text is a different statement, each compiled once', () => {
  const db = countingDb();
  const q = statements(db);
  const one = q('SELECT 1');
  const two = q('SELECT 2');
  assert.notEqual(one, two);
  assert.equal(q('SELECT 1'), one);
  assert.equal(q('SELECT 2'), two);
  assert.deepEqual(db.prepared, ['SELECT 1', 'SELECT 2']);
});

test('nothing is compiled until a statement is asked for', () => {
  const db = countingDb();
  statements(db);
  assert.deepEqual(db.prepared, [], 'making the cache prepares nothing');
});

test('a statement may name a column that is added after the cache was made', (t) => {
  const db = memoryDb(t);
  db.exec('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT)');
  const q = statements(db); // made against the table as it was, the way the site builds its services before migrating
  db.exec('ALTER TABLE people ADD COLUMN colour TEXT');
  q('INSERT INTO people (name, colour) VALUES (?, ?)').run('ann', 'green');
  assert.equal(q('SELECT colour FROM people WHERE name = ?').get('ann').colour, 'green');
});

test('a kept statement goes on working, call after call', (t) => {
  const db = memoryDb(t);
  db.exec('CREATE TABLE tally (n INTEGER)');
  const q = statements(db);
  for (let n = 1; n <= 20; n++) q('INSERT INTO tally (n) VALUES (?)').run(n);
  assert.equal(q('SELECT COUNT(*) AS rows, SUM(n) AS total FROM tally').get().rows, 20);
  assert.equal(q('SELECT COUNT(*) AS rows, SUM(n) AS total FROM tally').get().total, 210);
});

test('each database has its own cache', (t) => {
  const one = memoryDb(t);
  const two = memoryDb(t);
  for (const [db, word] of [[one, 'first'], [two, 'second']]) {
    db.exec('CREATE TABLE notes (word TEXT)');
    db.prepare('INSERT INTO notes (word) VALUES (?)').run(word);
  }
  const fromOne = statements(one);
  const fromTwo = statements(two);
  const sql = 'SELECT word FROM notes';
  assert.equal(fromOne(sql).get().word, 'first');
  assert.equal(fromTwo(sql).get().word, 'second', 'the same text against another database reads that database');
  assert.equal(fromOne(sql).get().word, 'first');
});

test('text the database cannot compile is an error for the caller, not something swallowed', (t) => {
  const q = statements(memoryDb(t));
  assert.throws(() => q('SELECT * FROM a_table_nobody_made'));
  assert.throws(() => q('this is not SQL'));
});
