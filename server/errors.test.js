// The site's error type (server/errors.js) and the three small pieces every route stands on: the error handler that
// turns a throw into a JSON reply (routes/errorHandler.js), and the cookie reader, the sign-in guard, and the async
// wrapper (routes/http.js).  What is protected: a refusal reaches the client as its own status and a code the client
// can put into words, and an unexpected error reaches nobody but the log.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { AuthError } from './errors.js';
import { ShopError } from './shop.js';
import { registerErrorHandler } from './routes/errorHandler.js';
import { handler, makeRequireUser, tokenOf } from './routes/http.js';

/**
 * A tiny app with the real error handler behind whatever routes the test adds.
 * @returns {Promise<{ get: (url: string, headers?: object) => Promise<{ status: number, type: string, text: string, data: any }>, post: Function, calls: () => unknown[][] }>}
 */
async function miniApp(t, addRoutes) {
  const logged = t.mock.method(console, 'error', () => {}); // the handler logs what it will not send; keep the test output clean and look at it
  const app = express();
  addRoutes(app);
  registerErrorHandler(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const send = async (method, url, headers = {}, body) => {
    const res = await fetch(base + url, { method, headers, body });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON: the test will say so
    }
    return { status: res.status, type: res.headers.get('content-type') ?? '', text, data };
  };
  return {
    get: (url, headers) => send('GET', url, headers),
    post: (url, body, headers = { 'content-type': 'application/json' }) => send('POST', url, headers, body),
    // What the handler logged.  Node prints its own warnings (node:sqlite is experimental) through console.error too,
    // whenever they happen to arrive, and those are not the handler's.
    calls: () => logged.mock.calls.map((call) => call.arguments).filter((args) => !(typeof args[0] === 'string' && /^\(node:\d+\) /.test(args[0]))),
  };
}

test('an AuthError is an Error whose message is the code, with status 400 unless told otherwise', () => {
  const plain = new AuthError('usernameRules');
  assert.ok(plain instanceof Error);
  assert.equal(plain.message, 'usernameRules');
  assert.equal(plain.status, 400);
  assert.equal(plain.params, undefined);

  const full = new AuthError('invalidEffectLevel', 422, { min: 10, max: 300 });
  assert.equal(full.message, 'invalidEffectLevel');
  assert.equal(full.status, 422);
  assert.deepEqual(full.params, { min: 10, max: 300 });
});

test('a ShopError is an AuthError, so the same handler answers for it', () => {
  const error = new ShopError('notEnoughGold', 402);
  assert.ok(error instanceof AuthError);
  assert.equal(error.status, 402);
  assert.equal(error.message, 'notEnoughGold');
});

test('a refusal is sent with its own status and code, and its params only when it has some', async (t) => {
  const app = await miniApp(t, (a) => {
    a.get('/plain', handler(() => {
      throw new AuthError('usernameRules');
    }));
    a.get('/conflict', handler(async () => {
      throw new AuthError('usernameTaken', 409);
    }));
    a.get('/params', handler(async () => {
      throw new AuthError('invalidEffectLevel', 400, { min: 10, max: 300 });
    }));
    a.get('/shop', handler(async () => {
      throw new ShopError('notEnoughGold', 402);
    }));
  });
  const plain = await app.get('/plain');
  assert.equal(plain.status, 400);
  assert.match(plain.type, /application\/json/);
  assert.deepEqual(plain.data, { error: 'usernameRules' }, 'no params key when there are none');

  const conflict = await app.get('/conflict');
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.data, { error: 'usernameTaken' });

  const params = await app.get('/params');
  assert.equal(params.status, 400);
  assert.deepEqual(params.data, { error: 'invalidEffectLevel', params: { min: 10, max: 300 } });

  const shop = await app.get('/shop');
  assert.equal(shop.status, 402);
  assert.deepEqual(shop.data, { error: 'notEnoughGold' });

  assert.deepEqual(app.calls(), [], 'a refusal is not a fault: nothing is logged');
});

test('a body that is too large is a 413 and one that is not JSON is a 400, each with its code', async (t) => {
  const app = await miniApp(t, (a) => {
    a.use(express.json({ limit: '1kb' }));
    a.post('/echo', (req, res) => res.json({ got: req.body }));
  });
  assert.deepEqual((await app.post('/echo', JSON.stringify({ a: 1 }))).data, { got: { a: 1 } }, 'an ordinary body goes through');

  const large = await app.post('/echo', JSON.stringify({ a: 'x'.repeat(2000) }));
  assert.equal(large.status, 413);
  assert.deepEqual(large.data, { error: 'tooLarge' });

  for (const body of ['{', '{"a":', 'nonsense', '{"a":1}}', "{'a':1}"]) {
    const bad = await app.post('/echo', body);
    assert.equal(bad.status, 400, body);
    assert.deepEqual(bad.data, { error: 'invalidJson' }, body);
  }
  assert.equal(app.calls().length, 0, 'what a client got wrong is not logged as a fault');
});

test('anything unexpected is a plain 500: the error is logged and none of it is sent', async (t) => {
  const secret = 'the-database-password-is-hunter2';
  const thrown = {
    sync: new TypeError(`sync ${secret}`),
    async: new RangeError(`async ${secret}`),
  };
  const app = await miniApp(t, (a) => {
    a.get('/sync', handler(() => {
      throw thrown.sync;
    }));
    a.get('/async', handler(async () => {
      await null;
      throw thrown.async;
    }));
    a.get('/string', handler(async () => {
      throw `a bare string ${secret}`;
    }));
  });
  for (const url of ['/sync', '/async', '/string']) {
    const res = await app.get(url);
    assert.equal(res.status, 500, url);
    assert.deepEqual(res.data, { error: 'serverError' }, url);
    assert.ok(!res.text.includes(secret), `${url}: the error's own words stay on the server`);
    assert.ok(!/\bat .*\.js:\d+/.test(res.text), `${url}: no stack trace`);
  }
  const logged = app.calls().map((args) => args[0]);
  assert.ok(logged.includes(thrown.sync), 'the thrown error itself was logged');
  assert.ok(logged.includes(thrown.async), 'and the one from the rejected promise');
  assert.equal(logged.length, 3, 'once each');
});

test('the async wrapper sends nothing by itself when the route answers', async (t) => {
  const app = await miniApp(t, (a) => {
    a.get('/fine', handler(async (req, res) => {
      await null;
      res.json({ ok: true });
    }));
  });
  const res = await app.get('/fine');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { ok: true });
  assert.equal(app.calls().length, 0);
});

test('the session token is read from the sid cookie, wherever in the header it is', () => {
  const req = (cookie) => /** @type {any} */ ({ headers: cookie === undefined ? {} : { cookie } });
  assert.equal(tokenOf(req('sid=abc123')), 'abc123');
  assert.equal(tokenOf(req('theme=dark; sid=abc123; other=1')), 'abc123');
  assert.equal(tokenOf(req('theme=dark')), undefined);
  assert.equal(tokenOf(req('')), undefined);
  assert.equal(tokenOf(req(undefined)), undefined, 'no Cookie header at all');
});

test('the sign-in guard answers 401 signIn to a stranger and hands the user to the route otherwise', async (t) => {
  const asked = [];
  const auth = {
    userForToken: (token) => {
      asked.push(token);
      return token === 'good' ? { id: 7, username: 'ann' } : null;
    },
  };
  const app = await miniApp(t, (a) => {
    a.get('/mine', makeRequireUser(auth), (req, res) => res.json({ user: /** @type {any} */ (req).user }));
  });
  for (const headers of [{}, { cookie: 'sid=bad' }, { cookie: 'other=good' }]) {
    const res = await app.get('/mine', headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.deepEqual(res.data, { error: 'signIn' });
  }
  const res = await app.get('/mine', { cookie: 'sid=good' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { user: { id: 7, username: 'ann' } });
  assert.deepEqual(asked, [undefined, 'bad', undefined, 'good'], 'the guard asks about the sid cookie and nothing else');
});
