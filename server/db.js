// The site's database: accounts, sessions and game results, in one SQLite file (Node's built-in node:sqlite).
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
CREATE INDEX IF NOT EXISTS coin_ledger_user ON coin_ledger (user_id);
-- A game pays a player once, even if it were recorded twice.
CREATE UNIQUE INDEX IF NOT EXISTS coin_ledger_once ON coin_ledger (user_id, result_id) WHERE reason = 'placement';
CREATE INDEX IF NOT EXISTS result_players_user ON result_players (user_id);
CREATE INDEX IF NOT EXISTS result_players_result ON result_players (result_id);
CREATE INDEX IF NOT EXISTS results_game ON results (game, finished_at);
`;

/** Opens (creating if needed) the database in dataDir. Pass ':memory:' as dataDir for a throwaway one. */
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
  if (!columns.includes('card_back')) {
    db.exec(`ALTER TABLE users ADD COLUMN card_back TEXT NOT NULL DEFAULT '{"type":"preset","value":"crimson"}'`);
  }
  if (!columns.includes('name_style')) {
    db.exec(`ALTER TABLE users ADD COLUMN name_style TEXT NOT NULL DEFAULT '{"style":"plain"}'`);
  }
  if (!columns.includes('avatar')) {
    db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''`); // empty: the default avatar
  }
  if (!columns.includes('background_animation')) {
    db.exec(`ALTER TABLE users ADD COLUMN background_animation TEXT NOT NULL DEFAULT 'none'`);
  }
  if (!columns.includes('effect_intensity')) {
    db.exec('ALTER TABLE users ADD COLUMN effect_intensity INTEGER'); // percent; NULL: full (100)
  }
  if (!columns.includes('effect_speed')) {
    db.exec('ALTER TABLE users ADD COLUMN effect_speed INTEGER'); // percent; NULL: normal (100)
  }
  if (!columns.includes('marker_colour')) {
    db.exec('ALTER TABLE users ADD COLUMN marker_colour TEXT'); // the default marker colour (#rrggbb); NULL: none chosen
  }
  if (!columns.includes('animations_choice')) {
    db.exec('ALTER TABLE users ADD COLUMN animations_choice INTEGER'); // NULL: follow the device's own motion setting
  }
  return db;
}

/** Runs fn inside a transaction (rolled back if it throws). */
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
