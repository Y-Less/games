// Signing up, signing in and out through the real UI.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers.js';

let world;
before(async () => {
  world = await createWorld({ suite: 'auth' });
});
after(async () => {
  await world?.close();
});

test('a signed-out visit to a game redirects to the sign-in page, and registering lands back on the game', { timeout: 60000 }, world_guard('redirect and return', async () => {
  const user = await world.newUser('visitor');
  await user.goto('/play/hearts?x');
  await user.waitForSelector('#username');
  assert.equal(user.url.pathname, '/login');
  assert.equal(user.url.searchParams.get('next'), '/play/hearts?x', 'the page you wanted is kept in the address');

  await user.register(world.uniqueName('auth'), { displayName: 'Auth Person' });
  await user.waitForText('Hearts'); // the game page's heading
  assert.equal(user.url.pathname, '/play/hearts');
  await user.waitForText('Auth Person ▾');
  await user.clickButton('Rules', { exact: true });
  await user.waitForSelector('[role="dialog"][aria-label="Rules"]');
}));

test('the wrong password is refused with a message', { timeout: 60000 }, world_guard('wrong password', async () => {
  const maker = await world.newUser('maker');
  await maker.signUp('wrongpw');
  const name = maker.username;

  const user = await world.newUser('wrongpw');
  await user.goto('/login');
  await user.login(name, 'not-the-password');
  await user.waitForText('Wrong username or password.');
  assert.equal(user.url.pathname, '/login');
  assert.equal(await user.page.$('.account button'), null, 'still signed out');
  // The right password then works from the same form.
  await user.login(name);
  await user.waitForText('Choose a game.');
}));

test('registering rejects a short password with the server message, and a bad username too', { timeout: 60000 }, world_guard('register validation', async () => {
  const user = await world.newUser('shorty');
  await user.goto('/login');
  await user.register(world.uniqueName('short'), { password: 'abc123', expectUrl: false });
  await user.waitForText('Passwords must be at least 8 characters.');
  assert.equal(user.url.pathname, '/login');

  await user.fill('#username', 'x!');
  await user.fill('#password', 'long-enough-1');
  await user.clickButton('Create account', { exact: true });
  await user.waitForText('Usernames are 3 to 20 letters, numbers, dashes or underscores.');

  // A taken username is refused as well.
  const other = await world.newUser('taken');
  await other.signUp('taken');
  await user.fill('#username', other.username);
  await user.clickButton('Create account', { exact: true });
  await user.waitForText('That username is taken.');
}));

test('a session survives a reload, and signing out ends it', { timeout: 60000 }, world_guard('reload and sign out', async () => {
  const user = await world.newUser('session');
  await user.signUp('session', { displayName: 'Sessy' });

  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForText('Welcome, Sessy');
  assert.equal(user.url.pathname, '/');

  // Signing out sends you to the sign-in page; protected pages bounce back there.
  await user.clickButton('Sessy ▾');
  await user.clickButton('Sign out', { exact: true });
  await user.waitForSelector('#username');
  assert.equal(user.url.pathname, '/login');
  await user.goto('/stats');
  await user.waitForSelector('#username');
  assert.equal(user.url.pathname, '/login');
  assert.equal(user.url.searchParams.get('next'), '/stats');

  // Even a reload does not bring the session back.
  await user.page.reload({ waitUntil: 'domcontentloaded' });
  await user.waitForSelector('#username');

  // Signing in again returns to the page that was asked for.
  await user.login(user.username);
  await user.waitForText('Statistics for Sessy');
  assert.equal(user.url.pathname, '/stats');
}));

test('no uncaught errors in any page', () => {
  assert.deepEqual(world.pageErrors, []);
});

function world_guard(name, body) {
  return (t) => world.guard(name, body)(t);
}
