// The database a game's rooms live in (shared/roomDb.js): the file, its two tables, the statement cache, and the
// transaction.  shared/roomStore.test.js checks what a store promises without knowing what is on disk; this is the
// other side of that line.  What is protected here is the schema's one subtle point (a round is keyed by the room, the
// game, *and* its number, so "play again" cannot overwrite the game before it), that a transaction is all or nothing,
// that a file which is not a database is let go of so it can be moved aside, and that what is written comes back as
// it went in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspace } from '../server/fixtures/testkit.js';
import { seeded } from './random.js';
import { openRoomDb, roomDbFile, statements, transaction } from './roomDb.js';

/** A database in a folder of its own, closed and removed when the test ends. */
const fresh = (t) => {
  const { dir, track } = workspace(t, 'roomdb-');
  return { dir, track, db: track(openRoomDb(dir)) };
};

const INSERT_ROOM = 'INSERT INTO rooms (code, state_json, updated_at) VALUES (?, ?, ?)';
const INSERT_ROUND = 'INSERT INTO room_history (code, game_seq, seq, entry_json) VALUES (?, ?, ?, ?)';

test('the rooms are kept in rooms.sqlite, inside the module’s own data folder', (t) => {
  const { dir } = fresh(t);
  assert.equal(roomDbFile(dir), path.join(dir, 'rooms.sqlite'));
  assert.equal(fs.existsSync(roomDbFile(dir)), true, 'opening made the file where roomDbFile says it is');
});

test('opening creates the data folder if it is not there, however deep', (t) => {
  const { dir, track } = workspace(t, 'roomdb-');
  const dataDir = path.join(dir, 'not', 'made', 'yet');
  track(openRoomDb(dataDir));
  assert.equal(fs.existsSync(roomDbFile(dataDir)), true);
});

test('a new database has the two tables, empty, with the columns the header describes', (t) => {
  const { db } = fresh(t);
  const columns = (table) => db.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).all().map((row) => row.name);
  assert.deepEqual(columns('rooms'), ['code', 'state_json', 'updated_at']);
  assert.deepEqual(columns('room_history'), ['code', 'game_seq', 'seq', 'entry_json']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM room_history').get().n, 0);
});

test('there is no table of who is in which room: the store keeps that index in memory', (t) => {
  const { db } = fresh(t);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ['room_history', 'rooms']);
});

test('the database uses the write-ahead log, and has foreign keys on, as the site’s own does', (t) => {
  const { db } = fresh(t);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

test('opening a database that is already there keeps what is in it', (t) => {
  const { dir, track } = workspace(t, 'roomdb-');
  const first = openRoomDb(dir);
  first.prepare(INSERT_ROOM).run('a-b-c', '{"phase":"playing"}', 1000);
  first.prepare(INSERT_ROUND).run('a-b-c', 0, 0, '{"label":"Round 1"}');
  first.close();
  const second = track(openRoomDb(dir));
  assert.deepEqual({ ...second.prepare('SELECT code, state_json, updated_at FROM rooms').get() }, { code: 'a-b-c', state_json: '{"phase":"playing"}', updated_at: 1000 });
  assert.equal(second.prepare('SELECT COUNT(*) AS n FROM room_history').get().n, 1);
});

test('a room has one row: the same code cannot be inserted twice', (t) => {
  const { db } = fresh(t);
  db.prepare(INSERT_ROOM).run('a-b-c', '{}', 1);
  assert.throws(() => db.prepare(INSERT_ROOM).run('a-b-c', '{"other":true}', 2));
  assert.equal(db.prepare('SELECT state_json FROM rooms WHERE code = ?').get('a-b-c').state_json, '{}');
});

test('a round is keyed by room, game, and number, so the next game’s first round does not land on the last game’s', (t) => {
  const { db } = fresh(t);
  const insert = db.prepare(INSERT_ROUND);
  insert.run('a-b-c', 0, 0, '"game 0, round 0"');
  insert.run('a-b-c', 0, 1, '"game 0, round 1"');
  insert.run('a-b-c', 1, 0, '"game 1, round 0"'); // "play again": the same room, the next game, its first round
  insert.run('d-e-f', 0, 0, '"another room"');
  assert.throws(() => insert.run('a-b-c', 0, 0, '"a second round 0 of game 0"'), 'the same round of the same game is one row');
  const rounds = db.prepare('SELECT entry_json FROM room_history WHERE code = ? ORDER BY game_seq, seq').all('a-b-c').map((row) => JSON.parse(row.entry_json));
  assert.deepEqual(rounds, ['game 0, round 0', 'game 0, round 1', 'game 1, round 0']);
});

test('a round written without saying which game belongs to the room’s first', (t) => {
  const { db } = fresh(t);
  db.prepare('INSERT INTO room_history (code, seq, entry_json) VALUES (?, ?, ?)').run('a-b-c', 0, '{}');
  assert.equal(db.prepare('SELECT game_seq FROM room_history').get().game_seq, 0);
});

test('a file that is not a database throws on opening, and is let go of so the caller can move it out of the way', (t) => {
  const { dir } = workspace(t, 'roomdb-');
  const file = roomDbFile(dir);
  fs.writeFileSync(file, 'this is a text file, and long enough not to be mistaken for an empty database\n'.repeat(40));
  assert.throws(() => openRoomDb(dir));
  // An open handle cannot be renamed or deleted on Windows, so these two are the proof that it was closed.
  assert.doesNotThrow(() => fs.renameSync(file, `${file}.corrupt`));
  assert.doesNotThrow(() => fs.rmSync(`${file}.corrupt`));
  // And with it out of the way, the folder is ready for a new one.
  const db = openRoomDb(dir);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n, 0);
  db.close();
});

// ---- the statement cache ----

test('the same SQL is compiled once, and different SQL is a different statement', (t) => {
  const { db } = fresh(t);
  const sql = statements(db);
  const insert = sql(INSERT_ROOM);
  assert.equal(sql(INSERT_ROOM), insert, 'asked for again, the same statement comes back');
  assert.notEqual(sql('SELECT code FROM rooms'), insert);
  insert.run('a-b-c', '{}', 1);
  sql(INSERT_ROOM).run('d-e-f', '{}', 2);
  assert.deepEqual(sql('SELECT code FROM rooms ORDER BY code').all().map((row) => row.code), ['a-b-c', 'd-e-f'], 'a cached statement can be run as often as it is asked for');
});

test('each database has its own cache', (t) => {
  const one = fresh(t);
  const two = fresh(t);
  const fromOne = statements(one.db);
  const fromTwo = statements(two.db);
  fromOne(INSERT_ROOM).run('a-b-c', '{}', 1);
  assert.notEqual(fromOne(INSERT_ROOM), fromTwo(INSERT_ROOM));
  assert.equal(fromTwo('SELECT COUNT(*) AS n FROM rooms').get().n, 0, 'a statement runs against the database it was asked of');
});

test('SQL that will not compile throws each time it is asked for, rather than being remembered as if it had', (t) => {
  const { db } = fresh(t);
  const sql = statements(db);
  assert.throws(() => sql('SELECT nothing FROM nowhere'));
  assert.throws(() => sql('SELECT nothing FROM nowhere'));
  assert.doesNotThrow(() => sql('SELECT code FROM rooms'));
});

// ---- transactions ----

test('a transaction returns what its function returned, and everything it wrote is there afterwards', (t) => {
  const { db } = fresh(t);
  const sql = statements(db);
  const value = transaction(db, () => {
    sql(INSERT_ROOM).run('a-b-c', '{}', 1);
    sql(INSERT_ROUND).run('a-b-c', 0, 0, '{}');
    return 'done';
  });
  assert.equal(value, 'done');
  assert.equal(sql('SELECT COUNT(*) AS n FROM rooms').get().n, 1);
  assert.equal(sql('SELECT COUNT(*) AS n FROM room_history').get().n, 1);
});

test('a transaction that throws writes nothing at all, and the error that stopped it is the one that comes out', (t) => {
  const { db } = fresh(t);
  const sql = statements(db);
  sql(INSERT_ROOM).run('before', '{}', 1);
  const boom = new Error('the second write failed');
  assert.throws(
    () =>
      transaction(db, () => {
        sql(INSERT_ROOM).run('a-b-c', '{}', 2);
        sql(INSERT_ROUND).run('a-b-c', 0, 0, '{}');
        sql('DELETE FROM rooms WHERE code = ?').run('before');
        throw boom;
      }),
    (error) => error === boom,
  );
  assert.deepEqual(sql('SELECT code FROM rooms').all().map((row) => row.code), ['before'], 'neither the insert nor the delete happened');
  assert.equal(sql('SELECT COUNT(*) AS n FROM room_history').get().n, 0);
});

test('a write the database itself refuses rolls the whole transaction back too', (t) => {
  const { db } = fresh(t);
  const sql = statements(db);
  sql(INSERT_ROUND).run('a-b-c', 0, 0, '"first"');
  assert.throws(() =>
    transaction(db, () => {
      sql(INSERT_ROUND).run('a-b-c', 0, 1, '"second"');
      sql(INSERT_ROUND).run('a-b-c', 0, 0, '"a clash"');
    }),
  );
  assert.deepEqual(sql('SELECT entry_json FROM room_history').all().map((row) => JSON.parse(row.entry_json)), ['first']);
});

test('after a transaction has failed, the next one starts and commits as usual', (t) => {
  const { db } = fresh(t);
  const sql = statements(db);
  assert.throws(() => transaction(db, () => { throw new Error('no'); }), /no/);
  assert.equal(transaction(db, () => sql(INSERT_ROOM).run('a-b-c', '{}', 1).changes), 1);
  assert.equal(sql('SELECT COUNT(*) AS n FROM rooms').get().n, 1);
});

// ---- what goes in comes out ----

/** Text that has caught out a database or a serialiser somewhere before. */
const AWKWARD = ['', ' ', "it's", '"quoted"', 'a\\b', 'line\nbreak', 'tab\there', '\u0000nul', 'naïve', '日本語', '🎲 dice', '%_like', "'; DROP TABLE rooms; --", '__proto__', 'x'.repeat(5000)];

test('fuzz: rooms and rounds of any shape that JSON can hold are read back exactly as they were written, through a restart', (t) => {
  const seed = 0x700d;
  const rng = seeded(seed);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const leaf = () => pick([0, 1, -1, 1.5, 1e21, Number.MAX_SAFE_INTEGER, true, false, null, ...AWKWARD]);
  const build = (depth) => {
    const kind = depth > 3 ? 0 : Math.floor(rng() * 3);
    if (kind === 0) return leaf();
    if (kind === 1) return Array.from({ length: Math.floor(rng() * 5) }, () => build(depth + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(rng() * 5) }, () => [String(pick(AWKWARD)).slice(0, 20), build(depth + 1)]));
  };

  const { dir, track } = workspace(t, 'roomdb-');
  let db = openRoomDb(dir);
  let sql = statements(db);
  const rooms = new Map(); // code -> { state, updatedAt, rounds: Map of 'game:seq' -> entry }: what should be on disk
  // A NUL is left out of the codes, though not out of the rooms.  A code holding one was seen to come back cut short
  // at it, which nothing in roomDb.js makes a promise about either way: a code is made of words and hyphens.  Inside
  // a room it is written as JSON's "\u0000", which is six ordinary characters.
  const codes = ['a-b-c', 'd-e-f', ...AWKWARD.slice(0, 13).filter((text) => !text.includes('\u0000')).map((text, index) => `${index}:${text}`)];
  track({ close: () => db.close() }); // whichever connection is open at the end, pass or fail

  for (let step = 0; step < 300; step++) {
    const where = `seed ${seed}, step ${step}`;
    const code = pick(codes);
    const roll = rng();
    if (roll < 0.45) {
      const state = build(0);
      const updatedAt = Math.floor(rng() * 2 ** 45);
      sql('INSERT INTO rooms (code, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (code) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at').run(code, JSON.stringify(state), updatedAt);
      rooms.set(code, { rounds: new Map(), ...rooms.get(code), state, updatedAt });
    } else if (roll < 0.85) {
      if (!rooms.has(code)) continue;
      // Several rounds at once, as a flush writes them: all of them or none.
      const added = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => ({ game: Math.floor(rng() * 3), seq: Math.floor(rng() * 6), entry: build(1) }));
      const fresh = new Set(added.map((round) => `${round.game}:${round.seq}`)).size === added.length && added.every((round) => !rooms.get(code).rounds.has(`${round.game}:${round.seq}`));
      const write = () => transaction(db, () => added.forEach((round) => sql(INSERT_ROUND).run(code, round.game, round.seq, JSON.stringify(round.entry))));
      if (fresh) {
        write();
        for (const round of added) rooms.get(code).rounds.set(`${round.game}:${round.seq}`, round.entry);
      } else assert.throws(write, undefined, `${where}: a round that is already there was written over`);
    } else if (roll < 0.93) {
      transaction(db, () => {
        sql('DELETE FROM rooms WHERE code = ?').run(code);
        sql('DELETE FROM room_history WHERE code = ?').run(code);
      });
      rooms.delete(code);
    } else {
      db.close(); // the site stops and starts again
      db = openRoomDb(dir);
      sql = statements(db);
    }

    if (step % 10 !== 0 && step !== 299) continue;
    const savedRooms = sql('SELECT code, state_json, updated_at FROM rooms').all();
    assert.equal(savedRooms.length, rooms.size, `${where}: how many rooms are saved`);
    for (const row of savedRooms) {
      const expected = rooms.get(row.code);
      assert.ok(expected, `${where}: a room nobody wrote: ${JSON.stringify(row.code)}`);
      assert.deepEqual(JSON.parse(row.state_json), expected.state, `${where}: room ${JSON.stringify(row.code)}`);
      assert.equal(row.updated_at, expected.updatedAt, `${where}: when room ${JSON.stringify(row.code)} was last changed`);
    }
    const savedRounds = sql('SELECT code, game_seq, seq, entry_json FROM room_history').all();
    assert.equal(savedRounds.length, [...rooms.values()].reduce((sum, room) => sum + room.rounds.size, 0), `${where}: how many rounds are saved`);
    for (const row of savedRounds) {
      const expected = rooms.get(row.code)?.rounds;
      assert.ok(expected?.has(`${row.game_seq}:${row.seq}`), `${where}: a round nobody wrote: ${JSON.stringify(row.code)} ${row.game_seq}:${row.seq}`);
      assert.deepEqual(JSON.parse(row.entry_json), expected.get(`${row.game_seq}:${row.seq}`), `${where}: round ${row.game_seq}:${row.seq} of ${JSON.stringify(row.code)}`);
    }
  }
});
