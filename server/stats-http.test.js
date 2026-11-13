// What the statistics routes add to the statistics themselves (server/routes/stats.js and routes/people.js): finding
// the person an address names, and refusing a game that is not there.  The numbers are tested in stats.test.js and
// the other pages in people-http.test.js and leaderboard-http.test.js; this is the part between the address and those.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asSubject, personNamed } from './routes/people.js';
import { register, withSite } from './fixtures/testkit.js';

/** An auth that writes down what it was asked and knows one person, by id 42 and by the name "tom". */
function recordingAuth() {
  const asked = [];
  const tom = { id: 42, username: 'tom', displayName: 'Tom Thumb' };
  return {
    asked,
    tom,
    userById: (id) => (asked.push(['id', id]), id === 42 ? tom : null),
    userByName: (name) => (asked.push(['name', name]), name === 'tom' ? tom : null),
  };
}

test('a person is found by their account id or by the name they sign in with, and nobody is found for neither', () => {
  const auth = recordingAuth();
  assert.equal(personNamed(auth, '42'), auth.tom);
  assert.ok(auth.asked.some(([kind, value]) => kind === 'id' && value === 42), 'the id reaches the accounts as a number, not as text');
  assert.equal(personNamed(auth, 'tom'), auth.tom);
  assert.equal(personNamed(auth, '7'), null);
  assert.equal(personNamed(auth, 'nobody'), null);
});

test('a segment that names nobody at all is nobody, without the database being asked', () => {
  const auth = recordingAuth();
  for (const who of ['', '   ', undefined, null, {}, [], ['tom'], { toString: () => 'tom' }, Object.create(null), true]) {
    assert.equal(personNamed(auth, who), null, String(JSON.stringify(who)));
  }
  assert.deepEqual(auth.asked, []);
});

test("the subject of a page is who they are and nothing else about the account", () => {
  const whole = { id: 42, username: 'tom', displayName: 'Tom Thumb', isBot: false, background: { type: 'preset', value: 'night' }, language: 'fr', markerColour: '#ffffff' };
  assert.deepEqual(asSubject(whole), { id: 42, username: 'tom', displayName: 'Tom Thumb' });
});

test('a leaderboard for a game the site does not have is a 404 that says so', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const real = await c.get('/api/stats/leaderboard/coin');
  assert.equal(real.status, 200);
  assert.deepEqual(real.data, { leaderboard: [] }, 'a game nobody has played yet has an empty board, which is not the same thing');
  for (const game of ['nope', 'COIN', 'coin%20', '__proto__', 'constructor', 'toString', '0', 'coin%2Fx']) {
    const res = await c.get(`/api/stats/leaderboard/${game}`);
    assert.equal(res.status, 404, game);
    assert.deepEqual(res.data, { error: 'noSuchGame' }, game);
  }
});

test("your own statistics carry your time on the site as a whole number of seconds", async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const { status, data } = await c.get('/api/stats/me');
  assert.equal(status, 200);
  assert.ok(Number.isInteger(data.summary.onlineSeconds) && data.summary.onlineSeconds >= 0, `onlineSeconds was ${data.summary.onlineSeconds}`);
  assert.equal(data.summary.played, 0, 'a new account has played nothing');
});

// people-http.test.js says <who> is "the name they sign in with or their account id".  A username may be all digits
// (server/auth.js USERNAME allows it), and such a name is taken for an id (routes/people.js ID), so its owner cannot
// be found by the name they sign in with, and the address finds whoever has that id instead.
test('somebody whose username is all digits is still found by that name', { todo: 'routes/people.js:7 treats every all-digit segment as an account id, so /api/stats/user/<digits> never looks up the username; an account named "2" is unreachable by name and the address shows account 2 instead' }, async (t) => {
  const { client } = await withSite(t);
  const first = client();
  await register(first, 'first', 'correct horse 1');
  const digits = client();
  const made = await register(digits, '777', 'correct horse 2', { displayName: 'Sevens' });
  assert.equal(made.status, 200, 'an all-digit username is allowed');
  for (const page of ['stats', 'achievements']) {
    const res = await first.get(`/api/${page}/user/777`);
    assert.equal(res.status, 200, page);
    assert.equal(res.data.who.username, '777', page);
  }
});
