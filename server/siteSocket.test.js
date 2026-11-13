// The site's own socket (server/siteSocket.js): the default namespace every signed-in page holds open.  What is
// protected: nobody gets on it without a session, each connection lands in its own person's room and no other (a
// pop-up is sent to `user:<id>`, so the wrong room is somebody else's news), and the presence clock is told about
// every page that opens and closes, with "away" announced only when the last one goes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSiteSocket } from './siteSocket.js';
import { connected, refused, register, withSite } from './fixtures/testkit.js';
import { until } from '../shared/testkit.js';

/**
 * Just enough of a socket.io server to drive attachSiteSocket by hand: `open(cookie)` runs the middleware and then the
 * connection handlers, as socket.io does, and returns the socket with what happened to it.
 */
function fakeIo() {
  const middleware = [];
  const handlers = [];
  return {
    use: (fn) => middleware.push(fn),
    on: (event, fn) => event === 'connection' && handlers.push(fn),
    open(cookie) {
      const listeners = [];
      const socket = {
        handshake: { headers: cookie === undefined ? {} : { cookie } },
        data: {},
        rooms: [],
        refusal: null,
        join: (room) => socket.rooms.push(room),
        on: (event, fn) => event === 'disconnect' && listeners.push(fn),
        close: () => listeners.forEach((fn) => fn('client namespace disconnect')),
      };
      for (const fn of middleware) {
        let passed = false;
        fn(socket, (error) => {
          if (error) socket.refusal = error;
          else passed = true;
        });
        if (!passed) return socket;
      }
      for (const fn of handlers) fn(socket);
      return socket;
    },
  };
}

// Sessions "t1" and "t2" belong to accounts 1 and 2; every other token belongs to nobody.
const auth = { userForToken: (token) => (token === 't1' ? { id: 1 } : token === 't2' ? { id: 2 } : null) };

/** A presence clock that only writes down what it is told, and answers `leave` the way the real one does. */
function recordingPresence() {
  const open = new Map();
  const calls = [];
  return {
    calls,
    arrive(userId) {
      calls.push(['arrive', userId]);
      open.set(userId, (open.get(userId) ?? 0) + 1);
    },
    leave(userId) {
      calls.push(['leave', userId]);
      open.set(userId, open.get(userId) - 1);
      return open.get(userId) === 0;
    },
  };
}

test('a connection with no session is refused, and is neither put in a room nor counted as here', () => {
  const io = fakeIo();
  const presence = recordingPresence();
  attachSiteSocket(io, auth, { presence });
  for (const cookie of [undefined, '', 'sid=', 'sid=nobody', 'other=t1', 'sid=%', 't1']) {
    const socket = io.open(cookie);
    assert.ok(socket.refusal instanceof Error, `cookie ${JSON.stringify(cookie)} should be refused`);
    assert.deepEqual(socket.rooms, [], `cookie ${JSON.stringify(cookie)}`);
  }
  assert.deepEqual(presence.calls, [], 'a refused connection never reaches the clock');
});

test("a signed-in connection joins its own person's room, and only that one", () => {
  const io = fakeIo();
  attachSiteSocket(io, auth, { presence: recordingPresence() });
  const one = io.open('sid=t1');
  const two = io.open('theme=dark; sid=t2');
  assert.equal(one.refusal, null);
  assert.deepEqual(one.rooms, ['user:1']);
  assert.deepEqual(two.rooms, ['user:2']);
});

test('the clock hears of every page opening and closing, and away is called only when the last page goes', () => {
  const io = fakeIo();
  const presence = recordingPresence();
  const away = [];
  attachSiteSocket(io, auth, { presence, onAway: (userId) => away.push(userId) });

  const first = io.open('sid=t1');
  const second = io.open('sid=t1'); // the same person in a second tab
  const other = io.open('sid=t2');
  assert.deepEqual(presence.calls, [['arrive', 1], ['arrive', 1], ['arrive', 2]]);

  first.close();
  assert.deepEqual(away, [], 'somebody with two tabs open is still here when one closes');
  other.close();
  assert.deepEqual(away, [2], 'the other person, whose only page it was, is away');
  second.close();
  assert.deepEqual(away, [2, 1], 'and now the last tab has gone too');
  assert.deepEqual(presence.calls.slice(3), [['leave', 1], ['leave', 2], ['leave', 1]]);
});

test('without a presence clock, or without anybody to tell, connections still work', () => {
  const bare = fakeIo();
  attachSiteSocket(bare, auth); // no options at all
  const socket = bare.open('sid=t1');
  assert.deepEqual(socket.rooms, ['user:1']);
  assert.doesNotThrow(() => socket.close());

  const quiet = fakeIo();
  const presence = recordingPresence();
  attachSiteSocket(quiet, auth, { presence }); // a clock, but no onAway
  const page = quiet.open('sid=t2');
  assert.doesNotThrow(() => page.close());
  assert.deepEqual(presence.calls, [['arrive', 2], ['leave', 2]]);
});

// ---- through the real site ----

test("one person's news goes to all of their pages and to nobody else's", async (t) => {
  const { client } = await withSite(t);
  const ann = client();
  await register(ann, 'ann', 'correct horse ann');
  const bob = client();
  await register(bob, 'bob', 'correct horse bob');

  const heard = { laptop: 0, phone: 0, bob: 0 };
  const laptop = await connected(ann.socket('/'));
  const phone = await connected(ann.socket('/'));
  const bobs = await connected(bob.socket('/'));
  laptop.on('achievements', () => heard.laptop++);
  phone.on('achievements', () => heard.phone++);
  bobs.on('achievements', () => heard.bob++);

  // The secret achievement is the simplest thing that makes the site tell one person something (routes/achievements.js).
  assert.equal((await ann.post('/api/achievements/steve')).status, 200);
  await until(() => heard.laptop > 0 && heard.phone > 0, 'both of Ann’s pages to be told');
  // Bob is told about his own afterwards.  The site sends in order, so had Ann's news reached him it would have
  // arrived first and he would have heard twice by now.
  assert.equal((await bob.post('/api/achievements/steve')).status, 200);
  await until(() => heard.bob > 0, 'Bob’s page to be told about his own');
  assert.equal(heard.bob, 1, "Bob heard his own news and not Ann's");
  assert.equal(heard.laptop, 1, "and Ann's pages did not hear Bob's");
  assert.equal(heard.phone, 1);
});

test('a session that has been signed out cannot open the site socket again', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const old = c.cookie();
  await connected(c.socket('/'));
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  const stale = client();
  stale.setCookie(old);
  await refused(stale.socket('/'));
});
