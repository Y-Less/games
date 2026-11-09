// The database a game's rooms live in: one rooms.sqlite per module, in its own data folder.  This file knows SQL and
// nothing about games; shared/roomStore.js knows about rooms and nothing about SQL.
//
// Two tables, and the split between them is the whole point of using a database at all.  Writing every room of a
// module to one file on every move was the cost this is here to remove (the largest room on disk is about 5 KB, and
// most of it is history), so what goes in a row of its own is what is big, and what stays in the room's own column is
// what is small or changes every time anyway:
//
//   rooms         one row per room, holding the room as JSON *without* its history.  Rewritten when anything in it
//                 changes, which for a game under way is most moves, but it is a kilobyte or two rather than every
//                 room in the module.
//   room_history  one row per finished round.  This is the part that grows without limit, and since slots made the
//                 history immutable it is only ever appended to, so an ordinary move writes one row and touches
//                 nothing else.
//
// The move log stays inside the room's JSON on purpose.  It is a window on the last sixty lines that slides along, so
// every move shifts every entry; a row per line would mean rewriting sixty rows a move to save a few hundred bytes.
//
// There is deliberately **no** table of who is in which room.  The plan called for one, to answer "which rooms is this
// account in?" by index instead of by looking through every room — but the store already keeps that index in memory
// (it is what made that scan cheap in the first place), and it is rebuilt at start-up from the rooms it loads anyway.
// A table nothing reads is schema that still has to be migrated later.  When something stops holding every room in
// memory, that is the change that earns it.
//
// Depends on: node:sqlite and node:fs only.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_history (
  code TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry_json TEXT NOT NULL,
  PRIMARY KEY (code, seq)
);
`;

/**
 * Opens (or creates) a module's room database.
 *
 * The same settings as the site's own database (server/db.js): the write-ahead log, so a reader never waits for the
 * writer, and foreign keys on.  Throws if the file is not a database the way a damaged JSON file failed to parse, and
 * the caller deals with it the same way.
 *
 * @param {string} dataDir  the module's data folder; it is created if it is not there
 * @returns {import('node:sqlite').DatabaseSync}
 * Side effects: creates the folder and the file, and creates the tables if they are missing.
 */
export function openRoomDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'rooms.sqlite'));
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA);
    return db;
  } catch (error) {
    // A file that is not a database opens happily and only fails on the first statement.  Let go of it before the
    // failure travels on, or the caller cannot move it out of the way: an open handle cannot be deleted on Windows.
    try {
      db.close();
    } catch {
      // Already beyond saving; the original failure is the one worth reporting.
    }
    throw error;
  }
}

/** Where a module's rooms are kept. */
export const roomDbFile = (dataDir) => path.join(dataDir, 'rooms.sqlite');

/**
 * A cache of prepared statements for one database: the same SQL is compiled once, however often it is run.
 *
 * A move writes the same two or three statements every time, and preparing them afresh each time is the cost that was
 * taken out of the site's own database for the same reason.
 *
 * @param {import('node:sqlite').DatabaseSync} db  the database
 * @returns {(sql: string) => import('node:sqlite').StatementSync} ask for a statement by its SQL
 * Side effects: the returned function fills the cache as it is used.
 */
export function statements(db) {
  const cache = new Map();
  return (sql) => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };
}

/**
 * Runs `fn` as one transaction: either everything it writes lands or none of it does.
 *
 * @param {import('node:sqlite').DatabaseSync} db  the database
 * @param {() => any} fn  what to do inside it
 * @returns {any} whatever `fn` returned
 * Side effects: whatever `fn` does; rolls back and rethrows if it throws.
 */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
