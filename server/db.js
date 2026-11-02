// The site's database: accounts, sessions and game results, in one SQLite file (Node's built-in node:sqlite).
// Depends on: node:sqlite, node:fs and node:path only; the other server files take the database it opens.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  background TEXT NOT NULL DEFAULT '{"type":"preset","value":"night"}',
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY,
  game TEXT NOT NULL,
  code TEXT,
  finished_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS result_players (
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  placement INTEGER,
  score REAL,
  outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss', 'draw')),
  extras TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS coin_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  result_id INTEGER REFERENCES results(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS owned_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  bought_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
-- Progress a game saves towards an achievement (shared/achievements.js); the id is "<game>.<key>", or "global.<key>".
CREATE TABLE IF NOT EXISTS achievement_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- The numbered things a player has had so far for an achievement that collects them (server/collections.js): a bit for each number.
CREATE TABLE IF NOT EXISTS achievement_sets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  bits BLOB NOT NULL,
  PRIMARY KEY (user_id, id)
);
-- Each level a player has unlocked, once: it pays its coins when it is added, and shown is 0 until the player has seen the pop-up.
CREATE TABLE IF NOT EXISTS achievement_awards (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  level INTEGER NOT NULL,
  coins INTEGER NOT NULL,
  awarded_at INTEGER NOT NULL,
  shown INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id, level)
);
-- Trivia questions the site holds itself, rather than fetching (shared/trivia.js draws on both, in proportion to how
-- many each has).  The answers are kept as the right one and the wrong ones, which is the shape The Trivia API sends,
-- so that a question from here and a question from there become the same thing.  The wrong answers, the tags and the
-- regions are JSON arrays; no regions at all means the question suits everywhere.
CREATE TABLE IF NOT EXISTS trivia_questions (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  correct TEXT NOT NULL,
  wrong TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  regions TEXT NOT NULL DEFAULT '[]',
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trivia_questions_kind ON trivia_questions (category, difficulty);
CREATE INDEX IF NOT EXISTS coin_ledger_user ON coin_ledger (user_id);
-- An achievement level pays once, even if it were settled twice.
CREATE UNIQUE INDEX IF NOT EXISTS coin_ledger_achievement ON coin_ledger (user_id, reason) WHERE reason LIKE 'achievement:%';
-- A game pays a player once, even if it were recorded twice.
CREATE UNIQUE INDEX IF NOT EXISTS coin_ledger_once ON coin_ledger (user_id, result_id) WHERE reason = 'placement';
CREATE INDEX IF NOT EXISTS result_players_user ON result_players (user_id);
CREATE INDEX IF NOT EXISTS result_players_result ON result_players (result_id);
CREATE INDEX IF NOT EXISTS results_game ON results (game, finished_at);
`;

/**
 * A migration step that adds a column to `users` when it is missing.
 * @param {string} column  the column name
 * @param {string} definition  its SQL type and default, as in ALTER TABLE ... ADD COLUMN
 * @returns {{ id: string, run: (db: import('node:sqlite').DatabaseSync, columns: string[]) => void }}
 * Side effects: none until the step runs, then it may ALTER the table.
 */
const addUserColumn = (column, definition) => ({
  id: `users.${column}`,
  run(db, columns) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
  },
});

/**
 * The steps that bring a database made by an older version up to date, in the order they run. Every step is safe to run
 * on a database that already has it (the site runs all of them each time it opens one), so a step only adds what is missing.
 * Each is { id, run(db, usersColumns) }, where usersColumns are the names of the users table's columns before any step ran.
 * @type {Array<{ id: string, run: (db: import('node:sqlite').DatabaseSync, columns: string[]) => void }>}
 * Side effects: none until a step runs (see openDatabase); steps ALTER tables or insert and update rows.
 */
export const MIGRATIONS = [
  addUserColumn('card_back', `TEXT NOT NULL DEFAULT '{"type":"preset","value":"crimson"}'`),
  addUserColumn('name_style', `TEXT NOT NULL DEFAULT '{"style":"plain"}'`),
  addUserColumn('avatar', `TEXT NOT NULL DEFAULT ''`), // empty: the default avatar
  addUserColumn('background_animation', `TEXT NOT NULL DEFAULT 'none'`),
  addUserColumn('effect_intensity', 'INTEGER'), // percent; NULL: full (100)
  addUserColumn('effect_speed', 'INTEGER'), // percent; NULL: normal (100)
  addUserColumn('marker_colour', 'TEXT'), // the default marker colour (#rrggbb); NULL: none chosen
  addUserColumn('site_theme', 'TEXT'), // the colour theme (shared/siteThemes.js); NULL: the first, free one
  addUserColumn('site_font', 'TEXT'), // the font; NULL: the first, free one
  addUserColumn('animations_choice', 'INTEGER'), // NULL: follow the device's own motion setting
  addUserColumn('language', 'TEXT'), // the site's language (a tag such as 'fr'); NULL: follow the browser
  addUserColumn('online_seconds', 'INTEGER NOT NULL DEFAULT 0'), // how long they have been on the site, banked per visit (server/presence.js)
  {
    // Matrix B was taken off sale (its code is kept). Whoever owned it was given Matrix (the former Matrix A, 'matrix-a') in its
    // place, and whoever was using it is moved to that one, so that their background does not just stop.
    id: 'matrix-b-retired',
    run(db) {
      db.exec("INSERT OR IGNORE INTO owned_items (user_id, item_id, bought_at) SELECT user_id, 'ba:matrix-a', bought_at FROM owned_items WHERE item_id = 'ba:matrix'");
      db.exec("UPDATE users SET background_animation = 'matrix-a' WHERE background_animation = 'matrix'");
    },
  },
];

/**
 * Opens (creating if needed) the database in dataDir. Pass ':memory:' as dataDir for a throwaway one.
 * @param {string} dataDir  the folder for hub.sqlite (created when missing), or ':memory:'
 * @returns {import('node:sqlite').DatabaseSync}
 * Side effects: creates the folder and file, creates missing tables and runs every migration step.
 */
export function openDatabase(dataDir) {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, 'hub.sqlite');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  for (const step of MIGRATIONS) step.run(db, columns);
  return db;
}

/**
 * Runs fn inside a transaction (rolled back if it throws).
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}  what fn returned
 * @throws whatever fn threw, after rolling back
 * Side effects: BEGIN, then COMMIT or ROLLBACK.
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
