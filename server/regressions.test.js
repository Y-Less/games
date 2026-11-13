// Regression tests for the site server: bugs that were fixed in server/ without a test being written for them at the
// time.  Each test names the commit it pins and says what went wrong, and each asserts what that commit's message says
// is right, so that taking the fix back out fails here rather than in front of a player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from './auth.js';
import { openDatabase } from './db.js';
import { AuthError } from './errors.js';
import { cleanBackground } from './profileSettings.js';
import { EMPTY_SERVER, withSite, writeModules } from './fixtures/testkit.js';

/** Accounts over an empty in-memory database. */
function setup(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  return createAuth(db);
}

/**
 * Values for which `String(value)` and `Number(value)` throw a TypeError, which is what the fix was about.  The first
 * cannot come over HTTP; the second is plain JSON and can.
 */
const unconvertible = () => [
  ['an object with no prototype', Object.create(null)],
  ['an object whose toString is not a function', { toString: 'x', valueOf: 'y' }],
];

/** Passes when the promise is refused with an AuthError: a refusal, where a TypeError would be a crash. */
const refuses = (promise, what) => assert.rejects(promise, (error) => error instanceof AuthError, what);

// e614659 "Never let Number() or String() throw on a client payload".  Registering, signing in, and changing a
// password each passed what the client sent to String(), which throws for an object that cannot become a primitive.
test('registering with a username or password that cannot be made into text is refused, not a crash', async (t) => {
  const auth = setup(t);
  for (const [label, value] of unconvertible()) {
    await refuses(auth.register({ username: value, password: 'password1' }), `username: ${label}`);
    await refuses(auth.register({ username: 'alice', password: value }), `password: ${label}`);
  }
});

// e614659 "Never let Number() or String() throw on a client payload".  The display name went through String() as
// well, so the same payload crashed a registration whose username and password were fine.
test('a display name that cannot be made into text does not crash a registration', async (t) => {
  const auth = setup(t);
  let n = 0;
  for (const [label, value] of unconvertible()) {
    // Whether such a name is refused or left off is not what the fix decided; that it is not a TypeError is.
    const outcome = await auth.register({ username: `user-${n++}`, password: 'password1', displayName: value }).catch((error) => error);
    assert.ok(!(outcome instanceof Error) || outcome instanceof AuthError, `${label}: ${outcome}`);
  }
});

// e614659 "Never let Number() or String() throw on a client payload".  Signing in read the username and the password
// with String(), which threw before either could be checked.
test('signing in with a username or password that cannot be made into text is refused, not a crash', async (t) => {
  const auth = setup(t);
  await auth.register({ username: 'alice', password: 'password1' });
  for (const [label, value] of unconvertible()) {
    await refuses(auth.login({ username: value, password: 'password1' }), `username: ${label}`);
    await refuses(auth.login({ username: 'alice', password: value, ip: label }), `password: ${label}`);
  }
});

// e614659 "Never let Number() or String() throw on a client payload".  Changing a password read both the current and
// the new one with String(), so either could throw where "wrong password" or "too short" was due.
test('changing a password to or from something that cannot be made into text is refused, not a crash', async (t) => {
  const auth = setup(t);
  const { user, token } = await auth.register({ username: 'alice', password: 'password1' });
  for (const [label, value] of unconvertible()) {
    await refuses(auth.changePassword(user.id, value, 'password2', token), `current password: ${label}`);
    await refuses(auth.changePassword(user.id, 'password1', value, token), `new password: ${label}`);
  }
  assert.ok((await auth.login({ username: 'alice', password: 'password1' })).user, 'and the password is still the one she chose');
});

// e614659 "Never let Number() or String() throw on a client payload".  The profile's display name was cleaned with
// String(input), which threw instead of reaching the length check that refuses an empty name.
test('a profile change whose display name cannot be made into text is refused, not a crash', async (t) => {
  const auth = setup(t);
  const { user } = await auth.register({ username: 'alice', password: 'password1' });
  for (const [label, value] of unconvertible()) {
    assert.throws(() => auth.updateProfile(user.id, { displayName: value }), AuthError, label);
  }
});

// e614659 "Never let Number() or String() throw on a client payload".  A gradient's angle went through Number(),
// which threw on the same kind of payload before the angle could be rounded and clamped.
test('a gradient whose angle cannot be made into a number does not crash the background check', () => {
  // Whether such an angle is refused or replaced by the usual one is not what the fix decided; that it is not a TypeError is.
  for (const [label, value] of unconvertible()) {
    let cleaned;
    try {
      cleaned = cleanBackground({ type: 'gradient', from: '#000000', to: '#ffffff', angle: value });
    } catch (error) {
      assert.ok(error instanceof AuthError, `${label}: ${error}`);
      continue;
    }
    assert.ok(Number.isFinite(cleaned.angle) && cleaned.angle >= 0 && cleaned.angle <= 360, `${label}: the angle kept is a real one (${cleaned.angle})`);
  }
});

// e614659 "Never let Number() or String() throw on a client payload".  The same thing as a visitor meets it: "an HTTP
// route that throws on a hostile payload is a crash where a refusal was due", and such a payload is plain JSON.
test('over HTTP, credentials that cannot be made into text are answered as a bad request, not a server error', async (t) => {
  const { client } = await withSite(t);
  const hostile = { toString: 'x', valueOf: 'y' }; // survives JSON, and makes String() throw
  const c = client();
  for (const body of [
    { username: hostile, password: 'password1' },
    { username: 'alice', password: hostile },
  ]) {
    for (const route of ['/api/auth/register', '/api/auth/login']) {
      const res = await c.post(route, body);
      assert.ok(res.status >= 400 && res.status < 500, `${route} with ${JSON.stringify(body)} answered ${res.status}`);
    }
  }
});

// 346fd07 "A misspelt achievement tier (or any refused definition) is reported at start-up rather than dropped
// silently".  A definition the manifest reader would not take simply vanished: the game loaded without the
// achievement and nothing anywhere said so.
test('a game whose achievement names a tier that does not exist is reported when the site starts', async (t) => {
  const modulesDir = writeModules(t, {
    typo: {
      'module.json': {
        id: 'typo',
        name: 'Typo',
        achievements: [
          { key: 'fine', name: 'Fine', text: 'Do {n} things', levels: [1, 5] },
          { key: 'moonshot', name: 'Moonshot', text: 'Do {n} things', levels: 'very-hrad' },
        ],
      },
      'server.js': EMPTY_SERVER,
    },
  });
  const { logs } = await withSite(t, { modulesDir });
  const said = logs.filter((line) => line.includes('moonshot'));
  assert.equal(said.length > 0, true, `nothing was said about the refused achievement:\n${logs.join('\n')}`);
  assert.ok(said.some((line) => line.includes('typo')), 'and the line says which game it belongs to');
});
