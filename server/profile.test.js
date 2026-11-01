// The profile settings table: every row maps to a real column, the shop check sees only the settings it should, and a
// refused change changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.js';
import { AuthError } from './errors.js';
import { SETTINGS, createProfiles } from './profile.js';
import { DEFAULT_FONT } from '../shared/siteThemes.js';

/**
 * Makes an in-memory database with one user and a profile whose canUse records what it was asked.
 * @param {import('node:test').TestContext} t
 * @returns {{ db: object, profiles: object, id: number, asked: object[] }}
 * Side effects: opens a database, closed when the test ends.
 */
function setup(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const asked = [];
  const profiles = createProfiles(db, { canUse: (userId, settings) => asked.push(settings) });
  const id = Number(db.prepare('INSERT INTO users (username, username_lower, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)').run('ann', 'ann', 'x', 'Ann', 1).lastInsertRowid);
  return { db, profiles, id, asked };
}

test('every setting stores into a column that exists, and keys are unique', (t) => {
  const { db } = setup(t);
  const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  for (const { column } of SETTINGS) assert.ok(columns.includes(column), column);
  assert.equal(new Set(SETTINGS.map((s) => s.key)).size, SETTINGS.length);
  assert.equal(new Set(SETTINGS.map((s) => s.column)).size, SETTINGS.length);
});

test('canUse sees the shop-gated settings (and not the display name or play animations), and only those given', (t) => {
  const { profiles, id, asked } = setup(t);
  profiles.updateProfile(id, { displayName: 'Anna', playAnimations: false, siteFont: DEFAULT_FONT });
  assert.equal(asked.length, 1);
  assert.deepEqual(Object.keys(asked[0]).sort(), SETTINGS.filter((s) => s.gated).map((s) => s.key).sort());
  assert.equal(asked[0].displayName, undefined);
  assert.equal(asked[0].playAnimations, undefined);
  assert.equal(asked[0].background, undefined);
});

test('a refused change changes nothing: a bad later setting stops an earlier good one', (t) => {
  const { profiles, id } = setup(t);
  assert.throws(() => profiles.updateProfile(id, { displayName: 'Changed', effectSpeed: 5 }), AuthError);
  assert.equal(profiles.userById(id).displayName, 'Ann');
});

test('a picture of someone else is refused only after every setting has been cleaned', (t) => {
  const { profiles, id } = setup(t);
  const foreign = { type: 'image', file: 'bg-999-0123456789ab.png' };
  assert.throws(() => profiles.updateProfile(id, { background: foreign, nameStyle: { style: 'nonsense' } }), /invalidNameStyle/);
  assert.throws(() => profiles.updateProfile(id, { background: foreign }), /invalidBackground/);
});
