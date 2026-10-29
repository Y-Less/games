// Unit tests for accounts: validation, hashing, sessions, throttling and the cookie helpers (no HTTP involved).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AuthError,
  BACKGROUND_PRESETS,
  CARD_BACK_PRESETS,
  SESSION_COOKIE,
  SESSION_DAYS,
  cleanBackground,
  cleanCardBack,
  clearedCookie,
  createAuth,
  parseCookies,
  sessionCookie,
} from './auth.js';
import { openDatabase } from './db.js';

function setup(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  return { db, auth: createAuth(db) };
}
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const rejects = (promise, status) => assert.rejects(promise, (error) => error instanceof AuthError && error.status === status);
const threw = (fn, status) => assert.throws(fn, (error) => error instanceof AuthError && error.status === status);

test('usernames: 3 to 20 letters, digits, dashes and underscores', async (t) => {
  const { auth } = setup(t);
  for (const name of ['abc', 'a'.repeat(20), 'a-b_c', 'XYZ', '123', '___', '---']) {
    const { user } = await auth.register({ username: name, password: 'password1' });
    assert.equal(user.username, name, `accepts ${JSON.stringify(name)}`);
  }
  for (const name of ['', 'ab', 'a'.repeat(21), 'a b', 'a.b', 'a@b', 'ålice', 'ａｌｉｃｅ', 'аlice' /* Cyrillic a */, 'a\tb', 'a\nb', '日本語です', '😀😀😀', undefined, null, {}]) {
    await rejects(auth.register({ username: name, password: 'password1' }), 400);
  }
});

test('usernames are trimmed, and trimming happens before the length check', async (t) => {
  const { auth } = setup(t);
  assert.equal((await auth.register({ username: '  bob  ', password: 'password1' })).user.username, 'bob');
  assert.equal((await auth.register({ username: `\n${'c'.repeat(20)}\t`, password: 'password1' })).user.username, 'c'.repeat(20));
  await rejects(auth.register({ username: '  ab  ', password: 'password1' }), 400);
  await rejects(auth.register({ username: '        ', password: 'password1' }), 400);
});

test('usernames are unique ignoring case and surrounding whitespace, but keep the case they were typed in', async (t) => {
  const { auth } = setup(t);
  const { user } = await auth.register({ username: 'AliCe', password: 'password1' });
  assert.equal(user.username, 'AliCe');
  for (const again of ['alice', 'ALICE', ' aLiCe ', 'AliCe']) await rejects(auth.register({ username: again, password: 'password1' }), 409);
  const login = await auth.login({ username: 'ALICE', password: 'password1' });
  assert.equal(login.user.username, 'AliCe');
});

test('passwords: 8 to 200 characters, kept exactly as typed (no trimming)', async (t) => {
  const { auth } = setup(t);
  await rejects(auth.register({ username: 'user1', password: 'x'.repeat(7) }), 400);
  await rejects(auth.register({ username: 'user1', password: '' }), 400);
  await rejects(auth.register({ username: 'user1', password: undefined }), 400);
  await rejects(auth.register({ username: 'user1', password: 'x'.repeat(201) }), 400);
  await auth.register({ username: 'user1', password: 'x'.repeat(8) });
  await auth.register({ username: 'user2', password: 'y'.repeat(200) });
  await auth.register({ username: 'user3', password: '        ' }); // eight spaces are allowed
  await auth.register({ username: 'user4', password: '  spaced out  ' });
  await auth.register({ username: 'user5', password: 'pässwörd日本語🔑' });

  await auth.login({ username: 'user2', password: 'y'.repeat(200) });
  await auth.login({ username: 'user3', password: '        ' });
  await auth.login({ username: 'user4', password: '  spaced out  ' });
  await rejects(auth.login({ username: 'user4', password: 'spaced out' }), 401);
  await auth.login({ username: 'user5', password: 'pässwörd日本語🔑' });
  await rejects(auth.login({ username: 'user5', password: 'passwörd日本語🔑' }), 401);
  await rejects(auth.login({ username: 'user2', password: 'y'.repeat(199) }), 401);
});

test('a failed registration creates no account and no session', async (t) => {
  const { auth, db } = setup(t);
  await rejects(auth.register({ username: 'ok-name', password: 'short' }), 400);
  await rejects(auth.register({ username: 'x', password: 'password1' }), 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('display names: default to the username, are trimmed and are cut to 20 characters', async (t) => {
  const { auth } = setup(t);
  const name = async (username, displayName) => (await auth.register({ username, password: 'password1', displayName })).user.displayName;
  assert.equal(await name('user01', undefined), 'user01');
  assert.equal(await name('user02', null), 'user02');
  assert.equal(await name('user03', ''), 'user03');
  assert.equal(await name('user04', '   \t '), 'user04');
  assert.equal(await name('user05', '  Fancy Name  '), 'Fancy Name');
  assert.equal(await name('user06', 'z'.repeat(20)), 'z'.repeat(20));
  assert.equal(await name('user07', 'z'.repeat(40)), 'z'.repeat(20));
  assert.equal(await name('user08', 'Fancy Name'), 'Fancy Name', 'display names need not be unique');
  assert.equal(await name('user09', 'Fancy Name'), 'Fancy Name');
  assert.equal(await name('user10', 12345), '12345');
  assert.equal(await name('user11', 'Ünïcödé 日本'), 'Ünïcödé 日本');
});

test('registering gives the default background and card back, and bots can be flagged only by the server', async (t) => {
  const { auth } = setup(t);
  const { user } = await auth.register({ username: 'human', password: 'password1' });
  assert.deepEqual(user.background, { type: 'preset', value: 'night' });
  assert.deepEqual(user.cardBack, { type: 'preset', value: 'crimson' });
  assert.equal(user.isBot, false);
  assert.deepEqual(Object.keys(user).sort(), ['avatar', 'background', 'cardBack', 'displayName', 'id', 'isBot', 'nameStyle', 'username']);
  assert.equal((await auth.register({ username: 'robot', password: 'password1', isBot: true })).user.isBot, true);
  assert.equal(auth.userById(user.id).username, 'human');
  assert.equal(auth.userById(9999), null);
});

test('passwords are hashed with a fresh salt and verify correctly', async (t) => {
  const { auth, db } = setup(t);
  await auth.register({ username: 'first', password: 'same password' });
  await auth.register({ username: 'second', password: 'same password' });
  const [a, b] = db.prepare('SELECT password_hash AS h FROM users ORDER BY id').all().map((r) => r.h);
  assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.match(b, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(a, b, 'the same password hashes differently for different users');
  assert.notEqual(a.split('$')[1], b.split('$')[1], 'because the salts differ');
  assert.ok(!a.includes('same password'));
  await auth.login({ username: 'first', password: 'same password' });
  await auth.login({ username: 'second', password: 'same password' });
  await rejects(auth.login({ username: 'first', password: 'Same password' }), 401);
  // The stored key really is scrypt(password, salt).
  const [, salt, key] = a.split('$');
  assert.equal(crypto.scryptSync('same password', Buffer.from(salt, 'hex'), 64).toString('hex'), key);
});

test('a malformed stored hash never lets anyone in and never crashes the login', async (t) => {
  const { auth, db } = setup(t);
  await auth.register({ username: 'victim', password: 'real password' });
  const good = db.prepare('SELECT password_hash AS h FROM users').get().h;
  const [, salt, key] = good.split('$');
  const malformed = [
    '',
    'scrypt',
    'scrypt$',
    'scrypt$$',
    `scrypt$${salt}`,
    `scrypt$${salt}$`,
    `scrypt$$${key}`,
    `bcrypt$${salt}$${key}`,
    `SCRYPT$${salt}$${key}`,
    'scrypt$zz$zz',
    'scrypt$00$00',
    `scrypt$${salt}$zz`,
    `scrypt$${salt}$${key.slice(0, 2)}`, // a key that is far too short
    `scrypt$${salt}$${key.slice(0, -1)}`, // odd length hex
    `plain$${salt}$${key}`,
    'real password',
    '$$$',
  ];
  let n = 0;
  for (const stored of malformed) {
    db.prepare('UPDATE users SET password_hash = ?').run(stored);
    for (const attempt of ['real password', '', 'x', 'scrypt$00$00']) {
      await rejects(auth.login({ username: 'victim', password: attempt, ip: `ip-${n++}` }), 401).catch((error) => {
        throw new Error(`stored ${JSON.stringify(stored)} with attempt ${JSON.stringify(attempt)}: ${error.message}`);
      });
    }
  }
  // Restoring the proper hash makes the account usable again.
  db.prepare('UPDATE users SET password_hash = ?').run(good);
  await auth.login({ username: 'victim', password: 'real password' });
});

test('a missing user and a wrong password are indistinguishable', async (t) => {
  const { auth } = setup(t);
  await auth.register({ username: 'real', password: 'password1' });
  const messages = [];
  for (const username of ['real', 'ghost']) {
    await assert.rejects(auth.login({ username, password: 'nope nope nope' }), (error) => {
      messages.push([error.status, error.message]);
      return true;
    });
  }
  assert.deepEqual(messages[0], messages[1]);
  assert.equal(messages[0][0], 401);
  await rejects(auth.login({}), 401);
  await rejects(auth.login({ username: 'real' }), 401);
  await rejects(auth.login({ password: 'password1' }), 401);
});

test('sessions: only a hash of the token is stored, and they last 30 days', async (t) => {
  const { auth, db } = setup(t);
  const { token, user } = await auth.register({ username: 'sess', password: 'password1' });
  assert.match(token, /^[0-9a-f]{64}$/);
  const [row] = db.prepare('SELECT * FROM sessions').all();
  assert.equal(row.token_hash, sha256(token));
  assert.notEqual(row.token_hash, token);
  assert.equal(row.user_id, user.id);
  assert.equal(row.expires_at - row.created_at, SESSION_DAYS * 24 * 60 * 60 * 1000);
  assert.equal(SESSION_DAYS, 30);
  assert.equal(auth.userForToken(token).id, user.id);
  const second = await auth.login({ username: 'sess', password: 'password1' });
  assert.notEqual(second.token, token, 'every login gets its own token');
});

test('userForToken refuses missing, malformed and unknown tokens', async (t) => {
  const { auth } = setup(t);
  const { token } = await auth.register({ username: 'tokens', password: 'password1' });
  for (const bad of [undefined, null, '', 0, 123, {}, [], [token], { toString: () => token }, 'x'.repeat(64), token.toUpperCase(), ` ${token}`, token.slice(1)]) {
    assert.equal(auth.userForToken(bad), null, `refuses ${JSON.stringify(bad)}`);
  }
  assert.ok(auth.userForToken(token));
});

test('sessions past expires_at are refused, and the sweep removes only those', async (t) => {
  const { auth, db } = setup(t);
  const alice = await auth.register({ username: 'alice', password: 'password1' });
  const aliceTwo = await auth.login({ username: 'alice', password: 'password1' });
  const bob = await auth.register({ username: 'bob1', password: 'password1' });
  const now = Date.now();
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now - 1, sha256(alice.token));
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now, sha256(bob.token)); // exactly now: expired
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now + 60_000, sha256(aliceTwo.token));

  assert.equal(auth.userForToken(alice.token), null);
  assert.equal(auth.userForToken(bob.token), null);
  assert.ok(auth.userForToken(aliceTwo.token));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 3, 'still stored until swept');

  auth.deleteExpiredSessions();
  const left = db.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash);
  assert.deepEqual(left, [sha256(aliceTwo.token)]);
  auth.deleteExpiredSessions(); // harmless when there is nothing to remove
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('a session stops working once it passes its expiry time (clock moves forward)', async (t) => {
  const { auth } = setup(t);
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  const { token } = await auth.register({ username: 'clock', password: 'password1' });
  t.mock.timers.tick(30 * 24 * 60 * 60 * 1000 - 1);
  assert.ok(auth.userForToken(token), 'still valid a millisecond before the end');
  t.mock.timers.tick(1);
  assert.equal(auth.userForToken(token), null, 'expired exactly at 30 days');
});

test('logout removes only that session', async (t) => {
  const { auth, db } = setup(t);
  const laptop = await auth.register({ username: 'multi', password: 'password1' });
  const phone = await auth.login({ username: 'multi', password: 'password1' });
  const other = await auth.register({ username: 'other', password: 'password1' });
  auth.logout(laptop.token);
  assert.equal(auth.userForToken(laptop.token), null);
  assert.ok(auth.userForToken(phone.token));
  assert.ok(auth.userForToken(other.token));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 2);
  // Logging out of nothing, or an unknown token, is harmless.
  auth.logout(undefined);
  auth.logout('');
  auth.logout('not-a-token');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 2);
});

test("changing the password signs out every other device, and only that user's", async (t) => {
  const { auth, db } = setup(t);
  const laptop = await auth.register({ username: 'changer', password: 'old password' });
  const phone = await auth.login({ username: 'changer', password: 'old password' });
  const tablet = await auth.login({ username: 'changer', password: 'old password' });
  const other = await auth.register({ username: 'bystander', password: 'password1' });

  await rejects(auth.changePassword(laptop.user.id, 'wrong', 'a new password', laptop.token), 401);
  await rejects(auth.changePassword(laptop.user.id, 'old password', 'short', laptop.token), 400);
  await rejects(auth.changePassword(laptop.user.id, 'old password', 'x'.repeat(201), laptop.token), 400);
  await rejects(auth.changePassword(laptop.user.id, undefined, 'a new password', laptop.token), 401);
  await rejects(auth.changePassword(999, 'old password', 'a new password', laptop.token), 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 4, 'refused changes sign nobody out');

  await auth.changePassword(laptop.user.id, 'old password', 'a new password', phone.token);
  assert.equal(auth.userForToken(laptop.token), null);
  assert.ok(auth.userForToken(phone.token), 'the device that changed it stays signed in');
  assert.equal(auth.userForToken(tablet.token), null);
  assert.ok(auth.userForToken(other.token), 'other users are untouched');

  await rejects(auth.login({ username: 'changer', password: 'old password' }), 401);
  await auth.login({ username: 'changer', password: 'a new password' });
});

test('changing the password without saying which session to keep signs everything out', async (t) => {
  const { auth, db } = setup(t);
  const { user } = await auth.register({ username: 'nokeep', password: 'old password' });
  await auth.changePassword(user.id, 'old password', 'a new password');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 0);
});

test('login throttling: the eleventh try in a row is refused, even with the right password', async (t) => {
  const { auth } = setup(t);
  await auth.register({ username: 'target', password: 'right password' });
  const ip = '10.0.0.1';
  for (let i = 0; i < 10; i++) await rejects(auth.login({ username: 'target', password: `guess ${i}`, ip }), 401);
  await rejects(auth.login({ username: 'target', password: 'right password', ip }), 429);
  await rejects(auth.login({ username: 'target', password: 'right password', ip }), 429);
});

test('login throttling resets after a successful login', async (t) => {
  const { auth } = setup(t);
  await auth.register({ username: 'target', password: 'right password' });
  const ip = '10.0.0.1';
  for (let i = 0; i < 9; i++) await rejects(auth.login({ username: 'target', password: `guess ${i}`, ip }), 401);
  await auth.login({ username: 'target', password: 'right password', ip });
  for (let i = 0; i < 10; i++) await rejects(auth.login({ username: 'target', password: `guess ${i}`, ip }), 401);
  await rejects(auth.login({ username: 'target', password: 'guess', ip }), 429);
});

test("login throttling is per address and username, ignoring the username's case and padding", async (t) => {
  const { auth } = setup(t);
  await auth.register({ username: 'target', password: 'right password' });
  await auth.register({ username: 'bystander', password: 'right password' });
  for (let i = 0; i < 11; i++) await auth.login({ username: 'target', password: 'wrong', ip: 'A' }).catch(() => {});
  await rejects(auth.login({ username: 'target', password: 'right password', ip: 'A' }), 429);
  await rejects(auth.login({ username: 'TARGET', password: 'right password', ip: 'A' }), 429);
  await rejects(auth.login({ username: ' Target ', password: 'right password', ip: 'A' }), 429);
  await auth.login({ username: 'target', password: 'right password', ip: 'B' });
  await auth.login({ username: 'bystander', password: 'right password', ip: 'A' });
});

test('login throttling also covers usernames that do not exist (so they cannot be told apart)', async (t) => {
  const { auth } = setup(t);
  for (let i = 0; i < 10; i++) await rejects(auth.login({ username: 'nobody', password: 'x', ip: 'A' }), 401);
  await rejects(auth.login({ username: 'nobody', password: 'x', ip: 'A' }), 429);
});

test('login throttling forgets after fifteen minutes', async (t) => {
  const { auth } = setup(t);
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  await auth.register({ username: 'target', password: 'right password' });
  for (let i = 0; i < 11; i++) await auth.login({ username: 'target', password: 'wrong', ip: 'A' }).catch(() => {});
  await rejects(auth.login({ username: 'target', password: 'right password', ip: 'A' }), 429);
  t.mock.timers.tick(15 * 60 * 1000);
  await rejects(auth.login({ username: 'target', password: 'right password', ip: 'A' }), 429);
  t.mock.timers.tick(1);
  await auth.login({ username: 'target', password: 'right password', ip: 'A' });
});

test('profile: display name rules', async (t) => {
  const { auth } = setup(t);
  const { user } = await auth.register({ username: 'profile', password: 'password1' });
  assert.equal(auth.updateProfile(user.id, { displayName: '  Padded  ' }).displayName, 'Padded');
  assert.equal(auth.updateProfile(user.id, { displayName: 'x'.repeat(20) }).displayName, 'x'.repeat(20));
  assert.equal(auth.updateProfile(user.id, { displayName: 'x'.repeat(20).padStart(30) }).displayName, 'x'.repeat(20), 'trimmed before the length check');
  threw(() => auth.updateProfile(user.id, { displayName: 'x'.repeat(21) }), 400);
  threw(() => auth.updateProfile(user.id, { displayName: '' }), 400);
  threw(() => auth.updateProfile(user.id, { displayName: ' \t\n ' }), 400);
  assert.equal(auth.updateProfile(user.id, { displayName: 'Ünï 日本語 😀' }).displayName, 'Ünï 日本語 😀');
  assert.equal(auth.updateProfile(user.id, {}).displayName, 'Ünï 日本語 😀', 'no changes asked for, none made');
  assert.equal(auth.userById(user.id).username, 'profile', 'the username itself never changes');
});

test('profile: a refused change changes nothing at all, even alongside valid changes', async (t) => {
  const { auth } = setup(t);
  const { user } = await auth.register({ username: 'atomic', password: 'password1', displayName: 'Before' });
  threw(() => auth.updateProfile(user.id, { displayName: 'After', background: { type: 'preset', value: 'nope' } }), 400);
  assert.equal(auth.userById(user.id).displayName, 'Before');
  threw(() => auth.updateProfile(user.id, { displayName: 'After', background: { type: 'preset', value: 'dusk' }, cardBack: { type: 'preset', value: 'nope' } }), 400);
  const after = auth.userById(user.id);
  assert.equal(after.displayName, 'Before');
  assert.deepEqual(after.background, { type: 'preset', value: 'night' });
  assert.deepEqual(after.cardBack, { type: 'preset', value: 'crimson' });
  threw(() => auth.updateProfile(user.id, { displayName: 'x'.repeat(21), background: { type: 'preset', value: 'dusk' } }), 400);
  assert.deepEqual(auth.userById(user.id).background, { type: 'preset', value: 'night' });
});

test('a damaged background or card back in the database falls back to the defaults', async (t) => {
  const { auth, db } = setup(t);
  const { user } = await auth.register({ username: 'damaged', password: 'password1' });
  db.prepare("UPDATE users SET background = 'not json', card_back = '{oops'").run();
  const shown = auth.userById(user.id);
  assert.deepEqual(shown.background, { type: 'preset', value: 'night' });
  assert.deepEqual(shown.cardBack, { type: 'preset', value: 'crimson' });
});

test('cleanBackground: presets', () => {
  for (const name of Object.keys(BACKGROUND_PRESETS)) assert.deepEqual(cleanBackground({ type: 'preset', value: name }), { type: 'preset', value: name });
  for (const bad of ['nope', '', 'NIGHT', ' night', 'constructor', 'toString', '__proto__', 'hasOwnProperty', undefined, null, 5, {}, ['night'], [['night']]]) {
    assert.throws(() => cleanBackground({ type: 'preset', value: bad }), AuthError, `rejects ${JSON.stringify(bad)}`);
  }
});

test('cleanBackground: single colours must be six hex digits and are lower-cased', () => {
  assert.deepEqual(cleanBackground({ type: 'colour', value: '#AbCdEf' }), { type: 'colour', value: '#abcdef' });
  assert.deepEqual(cleanBackground({ type: 'colour', value: '#000000' }), { type: 'colour', value: '#000000' });
  for (const bad of ['#abc', '#abcde', '#abcdef0', 'abcdef', '#ghijkl', '#abcdeg', ' #abcdef', '#abcdef ', '#abcdef\n', 'red', 'rgb(1,2,3)', '#abcdef; x: y', 'url(#abcdef)', '', undefined, null, 0xabcdef, {}, ['#abcdef'], [['#abcdef']]]) {
    assert.throws(() => cleanBackground({ type: 'colour', value: bad }), AuthError, `rejects ${JSON.stringify(bad)}`);
  }
});

test('cleanBackground: gradients need two good colours, and the angle is rounded and clamped to 0 to 360', () => {
  const gradient = (angle) => cleanBackground({ type: 'gradient', from: '#FFFFFF', to: '#000000', angle });
  assert.deepEqual(gradient(90), { type: 'gradient', from: '#ffffff', to: '#000000', angle: 90 });
  assert.equal(gradient(0).angle, 0);
  assert.equal(gradient(360).angle, 360);
  assert.equal(gradient(361).angle, 360);
  assert.equal(gradient(100000).angle, 360);
  assert.equal(gradient(-1).angle, 0);
  assert.equal(gradient(-100000).angle, 0);
  assert.equal(gradient(Infinity).angle, 360);
  assert.equal(gradient(-Infinity).angle, 0);
  assert.equal(gradient(45.4).angle, 45);
  assert.equal(gradient(45.5).angle, 46);
  assert.equal(gradient('120').angle, 120);
  assert.equal(gradient(undefined).angle, 160, 'a missing angle gets the default');
  assert.equal(gradient(null).angle, 160);
  assert.equal(gradient(NaN).angle, 160);
  assert.equal(gradient('sideways').angle, 160);
  assert.equal(gradient({}).angle, 160);
  assert.throws(() => cleanBackground({ type: 'gradient', from: '#ffffff', to: 'blue', angle: 1 }), AuthError);
  assert.throws(() => cleanBackground({ type: 'gradient', from: 'white', to: '#000000' }), AuthError);
  assert.throws(() => cleanBackground({ type: 'gradient', from: '#ffffff' }), AuthError);
  assert.throws(() => cleanBackground({ type: 'gradient', from: ['#ffffff'], to: '#000000' }), AuthError);
  assert.throws(() => cleanBackground({ type: 'gradient', from: '#ffffff', to: ['#000000'] }), AuthError);
});

test('cleanBackground: uploaded images must match the file name pattern exactly', () => {
  for (const good of ['bg-1-aaaaaaaaaaaa.png', 'bg-12345-0123456789ab.jpg', 'bg-7-abcdefabcdef.webp']) {
    assert.deepEqual(cleanBackground({ type: 'image', file: good }), { type: 'image', file: good });
  }
  for (const bad of [
    'bg-1-aaaaaaaaaaa.png', // 11 hex digits
    'bg-1-aaaaaaaaaaaaa.png', // 13
    'bg-1-AAAAAAAAAAAA.png', // upper case
    'bg-1-gggggggggggg.png',
    'bg--aaaaaaaaaaaa.png',
    'bg-x-aaaaaaaaaaaa.png',
    'bg-1-aaaaaaaaaaaa.gif',
    'bg-1-aaaaaaaaaaaa.jpeg',
    'bg-1-aaaaaaaaaaaa.PNG',
    'bg-1-aaaaaaaaaaaa.png.exe',
    'bg-1-aaaaaaaaaaaa',
    'xbg-1-aaaaaaaaaaaa.png',
    ' bg-1-aaaaaaaaaaaa.png',
    'bg-1-aaaaaaaaaaaa.png\n',
    '../bg-1-aaaaaaaaaaaa.png',
    'bg-1-aaaaaaaaaaaa.png/../../x',
    '..\\bg-1-aaaaaaaaaaaa.png',
    'sub/bg-1-aaaaaaaaaaaa.png',
    '/etc/passwd',
    '../../etc/passwd',
    '%2e%2e/bg-1-aaaaaaaaaaaa.png',
    'cb-1-aaaaaaaaaaaa.png', // a card back is not a background
    '',
    undefined,
    null,
    5,
    {},
    ['bg-1-aaaaaaaaaaaa.png'],
  ]) {
    assert.throws(() => cleanBackground({ type: 'image', file: bad }), AuthError, `rejects ${JSON.stringify(bad)}`);
  }
});

test('cleanBackground: unknown types and non-objects are refused', () => {
  for (const bad of [undefined, null, 'night', 5, true, [], {}, { type: 'css', value: 'x' }, { type: 'PRESET', value: 'night' }, { type: ['preset'], value: 'night' }, { value: 'night' }]) {
    assert.throws(() => cleanBackground(bad), AuthError, `rejects ${JSON.stringify(bad)}`);
  }
});

test('cleanBackground drops everything it was not asked to keep', () => {
  assert.deepEqual(cleanBackground({ type: 'preset', value: 'night', css: 'evil', extra: 1 }), { type: 'preset', value: 'night' });
  assert.deepEqual(cleanBackground({ type: 'colour', value: '#112233', css: 'evil' }), { type: 'colour', value: '#112233' });
  assert.deepEqual(cleanBackground({ type: 'image', file: 'bg-1-aaaaaaaaaaaa.png', url: 'http://evil' }), { type: 'image', file: 'bg-1-aaaaaaaaaaaa.png' });
});

test('cleanCardBack: presets and its own image pattern', () => {
  for (const name of Object.keys(CARD_BACK_PRESETS)) assert.deepEqual(cleanCardBack({ type: 'preset', value: name }), { type: 'preset', value: name });
  assert.deepEqual(cleanCardBack({ type: 'image', file: 'cb-3-0123456789ab.webp' }), { type: 'image', file: 'cb-3-0123456789ab.webp' });
  for (const bad of [
    { type: 'preset', value: 'night' }, // a background preset is not a card back
    { type: 'preset', value: 'constructor' },
    { type: 'preset', value: ['navy'] },
    { type: 'colour', value: '#ffffff' },
    { type: 'image', file: 'bg-3-0123456789ab.webp' },
    { type: 'image', file: 'cb-3-0123456789ab.gif' },
    { type: 'image', file: 'cb-3-0123456789a.png' },
    { type: 'image', file: '../cb-3-0123456789ab.png' },
    { type: 'image', file: ['cb-3-0123456789ab.png'] },
    { type: 'image' },
    {},
    null,
    undefined,
    'navy',
  ]) {
    assert.throws(() => cleanCardBack(bad), AuthError, `rejects ${JSON.stringify(bad)}`);
  }
});

test('parseCookies: the ordinary case', () => {
  assert.deepEqual(parseCookies('sid=abc; theme=dark'), { sid: 'abc', theme: 'dark' });
  assert.deepEqual(parseCookies('  sid = abc  ;  theme=dark  '), { sid: 'abc', theme: 'dark' });
  assert.deepEqual(parseCookies('a=b=c'), { a: 'b=c' }, 'only the first = splits');
  assert.deepEqual(parseCookies('name=caf%C3%A9%20au%20lait'), { name: 'café au lait' });
});

test('parseCookies: empty, missing and odd headers', () => {
  assert.deepEqual(parseCookies(), {});
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(';;;'), {});
  assert.deepEqual(parseCookies('novalue'), {}, 'a part without = is skipped');
  assert.deepEqual(parseCookies('novalue; sid=abc'), { sid: 'abc' });
  assert.deepEqual(parseCookies('sid='), { sid: '' }, 'an empty value is an empty string');
  assert.deepEqual(parseCookies('=abc'), { '': 'abc' });
  assert.deepEqual(parseCookies(12345), {}, 'a non-string header is just text');
  assert.deepEqual(parseCookies(null), {}, 'null becomes the text "null", which has no =');
});

test('parseCookies: duplicates (the last one wins) and malformed percent-encoding (skipped, others kept)', () => {
  assert.deepEqual(parseCookies('sid=one; sid=two'), { sid: 'two' });
  assert.deepEqual(parseCookies('sid=one; other=x; sid=three'), { sid: 'three', other: 'x' });
  assert.deepEqual(parseCookies('bad=%E0%A4%A; good=ok'), { good: 'ok' });
  assert.deepEqual(parseCookies('bad=%; good=ok'), { good: 'ok' });
  assert.deepEqual(parseCookies('bad=%zz; good=ok'), { good: 'ok' });
  assert.deepEqual(parseCookies('sid=good; sid=%'), { sid: 'good' }, 'a malformed duplicate does not clobber the good one');
  assert.deepEqual(parseCookies('a=%41%42'), { a: 'AB' });
});

test('parseCookies does not let a cookie named like an Object property cause trouble', () => {
  const cookies = parseCookies('__proto__=x; constructor=y; toString=z; sid=abc');
  assert.equal(cookies.sid, 'abc');
  assert.equal(cookies.constructor, 'y');
  assert.equal(cookies.toString, 'z');
  assert.equal(Object.getPrototypeOf(cookies), Object.prototype, 'the prototype is intact');
  assert.equal(typeof parseCookies('a=b').hasOwnProperty, 'function');
});

test('sessionCookie and clearedCookie have the right attributes', () => {
  const cookie = sessionCookie('abc123');
  const parts = cookie.split('; ');
  assert.equal(parts[0], `${SESSION_COOKIE}=abc123`);
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`]) assert.ok(parts.includes(attribute), attribute);
  assert.ok(!parts.includes('Secure'));
  assert.ok(sessionCookie('abc123', { secure: true }).endsWith('; Secure'));
  assert.ok(!sessionCookie('abc123', { secure: false }).includes('Secure'));
  assert.ok(!sessionCookie('abc123', {}).includes('Secure'));
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']) assert.ok(clearedCookie.split('; ').includes(attribute), attribute);
  assert.ok(clearedCookie.startsWith(`${SESSION_COOKIE}=;`));
});

test('the cookie we write is one parseCookies reads back', () => {
  const token = crypto.randomBytes(32).toString('hex');
  assert.equal(parseCookies(sessionCookie(token))[SESSION_COOKIE], token);
});
