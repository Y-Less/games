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
CREATE INDEX IF NOT EXISTS coin_ledger_user ON coin_ledger (user_id);
-- An achievement level pays once, even if it were settled twice.
CREATE UNIQUE INDEX IF NOT EXISTS coin_ledger_achievement ON coin_ledger (user_id, reason) WHERE reason LIKE 'achievement:%';
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
  if (!columns.includes('site_theme')) {
    db.exec('ALTER TABLE users ADD COLUMN site_theme TEXT'); // the colour theme (shared/siteThemes.js); NULL: the first, free one
  }
  if (!columns.includes('site_font')) {
    db.exec('ALTER TABLE users ADD COLUMN site_font TEXT'); // the font; NULL: the first, free one
  }
  if (!columns.includes('animations_choice')) {
    db.exec('ALTER TABLE users ADD COLUMN animations_choice INTEGER'); // NULL: follow the device's own motion setting
  }
  // Matrix B was taken off sale (its code is kept). Whoever owned it was given Matrix (the former Matrix A, 'matrix-a') in its
  // place, and whoever was using it is moved to that one, so that their background does not just stop.
  db.exec("INSERT OR IGNORE INTO owned_items (user_id, item_id, bought_at) SELECT user_id, 'ba:matrix-a', bought_at FROM owned_items WHERE item_id = 'ba:matrix'");
  db.exec("UPDATE users SET background_animation = 'matrix-a' WHERE background_animation = 'matrix'");
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
