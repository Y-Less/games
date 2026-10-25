// The account endpoints over real HTTP: validation, cookies, JSON-only changes, body limits, throttling and sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, connected, refused, register, withSite } from './fixtures/testkit.js';

const setCookie = (res) => res.headers.get('set-cookie') ?? '';

test('registration over HTTP: username and password boundaries', async (t) => {
  const { client } = await withSite(t);
  const attempt = (username, password = 'password1') => register(client(), username, password);
  assert.equal((await attempt('abc')).status, 200, '3 characters');
  assert.equal((await attempt('d'.repeat(20))).status, 200, '20 characters');
  assert.equal((await attempt('ab')).status, 400);
  assert.equal((await attempt('e'.repeat(21))).status, 400);
  assert.equal((await attempt('with space')).status, 400);
  assert.equal((await attempt('ålice')).status, 400);
  assert.equal((await attempt('日本語です')).status, 400);
  assert.equal((await attempt('fine-name', 'x'.repeat(7))).status, 400);
  assert.equal((await attempt('fine-name', 'x'.repeat(8))).status, 200);
  assert.equal((await attempt('fine-two', 'x'.repeat(201))).status, 400);
  assert.equal((await attempt('fine-two', 'x'.repeat(200))).status, 200);
  const nothing = await client().post('/api/auth/register', {});
  assert.equal(nothing.status, 400);
  assert.ok(typeof nothing.data.error === 'string');
  assert.equal((await client().post('/api/auth/register', { username: { $ne: 1 }, password: 'password1' })).status, 400);
  assert.equal((await client().post('/api/auth/register', { username: 'okay-name', password: ['a', 'b'] })).status, 400, 'an array is text that is too short');
});

test('a refused registration sets no cookie and signs nobody in', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  const bad = await c.call('POST', '/api/auth/register', { username: 'x', password: 'password1' });
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('set-cookie'), null);
  assert.equal(c.cookie(), '');
});

test('display names through the API: defaults, trimming and length', async (t) => {
  const { client } = await withSite(t);
  const nameOf = async (username, displayName) => (await register(client(), username, 'password1', { displayName })).data.user.displayName;
  assert.equal(await nameOf('user01', undefined), 'user01');
  assert.equal(await nameOf('user02', '   '), 'user02');
  assert.equal(await nameOf('user03', '  Padded  '), 'Padded');
  assert.equal(await nameOf('user04', 'q'.repeat(50)), 'q'.repeat(20));

  const c = client();
  await register(c, 'editor', 'password1');
  assert.equal((await c.patch('/api/me', { displayName: ' Spaced ' })).data.user.displayName, 'Spaced');
  assert.equal((await c.patch('/api/me', { displayName: 'z'.repeat(20) })).status, 200);
  assert.equal((await c.patch('/api/me', { displayName: 'z'.repeat(21) })).status, 400);
  assert.equal((await c.patch('/api/me', { displayName: '' })).status, 400);
  assert.equal((await c.patch('/api/me', {})).status, 200, 'asking for no change is fine');
  assert.equal((await c.get('/api/me')).data.user.displayName, 'z'.repeat(20));
});

test('the account cannot be made a bot, or given an id, through registration', async (t) => {
  const { client } = await withSite(t);
  const res = await register(client(), 'sneaky', 'password1', { isBot: true, id: 99, is_bot: 1 });
  assert.equal(res.data.user.isBot, false);
  assert.notEqual(res.data.user.id, 99);
});

test('usernames are unique ignoring case, over HTTP', async (t) => {
  const { client } = await withSite(t);
  assert.equal((await register(client(), 'Dupe', 'password1')).status, 200);
  for (const again of ['dupe', 'DUPE', ' dupe ']) assert.equal((await register(client(), again, 'password2')).status, 409, again);
});

test('the session cookie is HttpOnly, SameSite=Lax, Path=/ and not Secure on plain HTTP', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  const res = await c.call('POST', '/api/auth/register', { username: 'cookie', password: 'password1' });
  const cookie = setCookie(res);
  assert.match(cookie, /^sid=[0-9a-f]{64};/);
  const attributes = cookie.split('; ').slice(1);
  assert.deepEqual(attributes.sort(), ['HttpOnly', 'Max-Age=2592000', 'Path=/', 'SameSite=Lax'].sort());

  const login = await client().call('POST', '/api/auth/login', { username: 'cookie', password: 'password1' });
  assert.deepEqual(setCookie(login).split('; ').slice(1).sort(), attributes.sort(), 'logging in sets the same attributes');
});

test('the cookie is Secure only behind https, when the proxy is trusted', async (t) => {
  const secured = async (options, headers) => {
    const { client, close } = await withSite(t, options);
    const res = await client().call('POST', '/api/auth/register', { username: 'proxied', password: 'password1' }, headers);
    const login = await client().call('POST', '/api/auth/login', { username: 'proxied', password: 'password1' }, headers);
    await close();
    return [setCookie(res).includes('; Secure'), setCookie(login).includes('; Secure'), setCookie(res)];
  };
  const https = { 'x-forwarded-proto': 'https' };
  const [registered, loggedIn, cookie] = await secured({ env: { TRUST_PROXY: '1' } }, https);
  assert.ok(registered && loggedIn, 'trusted proxy plus https gives Secure');
  assert.ok(cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax') && cookie.includes('Path=/'));
  assert.deepEqual((await secured({ env: { TRUST_PROXY: '1' } }, { 'x-forwarded-proto': 'http' })).slice(0, 2), [false, false]);
  assert.deepEqual((await secured({ env: { TRUST_PROXY: '1' } }, {})).slice(0, 2), [false, false], 'no header, no Secure');
  assert.deepEqual((await secured({}, https)).slice(0, 2), [false, false], 'without TRUST_PROXY the header cannot be believed');
});

test('logout clears the cookie, ends only that session and is harmless without one', async (t) => {
  const { client } = await withSite(t);
  const laptop = client();
  await register(laptop);
  const phone = client();
  await phone.post('/api/auth/login', { username: 'alice', password: 'correct horse' });
  const other = client();
  await register(other, 'bob12', 'password1');

  const out = await laptop.call('POST', '/api/auth/logout', {});
  assert.equal(out.status, 200);
  assert.match(setCookie(out), /^sid=;.*Max-Age=0/);
  assert.equal((await laptop.get('/api/me')).data.user, null);
  assert.equal((await phone.get('/api/me')).data.user.username, 'alice', 'the phone stays signed in');
  assert.equal((await other.get('/api/me')).data.user.username, 'bob12');

  assert.equal((await client().post('/api/auth/logout', {})).status, 200, 'with no cookie at all');
  const junk = client();
  junk.setCookie('sid=not-a-real-session');
  assert.equal((await junk.post('/api/auth/logout', {})).status, 200);
  assert.equal((await phone.get('/api/me')).data.user.username, 'alice');
});

test('a garbage or duplicated session cookie is just "not signed in", never an error', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const good = c.cookie();
  for (const cookie of ['sid=%', 'sid=%E0%A4%A', 'sid', 'sid=', ';;;', 'sid=' + 'a'.repeat(5000), 'other=1; sid=nope']) {
    const anon = client();
    anon.setCookie(cookie);
    assert.deepEqual((await anon.get('/api/me')).data, { user: null }, cookie.slice(0, 20));
  }
  const dup = client();
  dup.setCookie(`${good}; sid=bogus`);
  assert.equal((await dup.get('/api/me')).data.user, null, 'the last duplicate wins');
  dup.setCookie(`sid=bogus; ${good}`);
  assert.equal((await dup.get('/api/me')).data.user.username, 'alice');
  dup.setCookie(`sid=${encodeURIComponent(good.slice(4))}`);
  assert.equal((await dup.get('/api/me')).data.user.username, 'alice', 'percent-encoding is decoded');
});

test('every state-changing endpoint insists on JSON', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const endpoints = [
    ['POST', '/api/auth/register'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/me/password'],
    ['PATCH', '/api/me'],
    ['PUT', '/api/me'],
    ['DELETE', '/api/me'],
    ['POST', '/api/anything-else'],
  ];
  const bodies = [
    ['form', 'username=x&password=password1', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['plain text', '{"displayName":"Hacked"}', { 'content-type': 'text/plain' }],
    ['multipart', '--x\r\n\r\n--x--', { 'content-type': 'multipart/form-data; boundary=x' }],
    ['no type', undefined, {}],
    ['JSON-looking text with no type', '{"displayName":"Hacked"}', { 'content-type': '' }],
    ['almost JSON', '{"displayName":"Hacked"}', { 'content-type': 'application/jsonx' }],
    ['text/json', '{"displayName":"Hacked"}', { 'content-type': 'text/json' }],
  ];
  for (const [method, url] of endpoints) {
    for (const [label, body, headers] of bodies) {
      const res = await c.call(method, url, body, headers);
      assert.equal(res.status, 415, `${method} ${url} with ${label}`);
      assert.deepEqual(res.data, { error: 'Send JSON.' });
    }
  }
  assert.equal((await c.get('/api/me')).data.user.displayName, 'alice', 'nothing was changed');
  assert.equal((await c.get('/api/me')).data.user.username, 'alice', 'and we are still signed in');
});

test('JSON with a charset or a +json suffix is accepted', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  const body = JSON.stringify({ username: 'charset', password: 'password1' });
  const res = await c.call('POST', '/api/auth/register', body, { 'content-type': 'application/json; charset=utf-8' });
  assert.equal(res.status, 200);
  const other = client();
  assert.equal((await other.call('POST', '/api/auth/login', JSON.stringify({ username: 'charset', password: 'password1' }), { 'content-type': 'APPLICATION/JSON' })).status, 200);
});

test('reading endpoints do not need JSON', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  assert.equal((await c.get('/api/config')).status, 200);
  assert.equal((await c.get('/api/me')).status, 200);
  assert.equal((await c.call('HEAD', '/api/config')).status, 200);
});

test('the JSON body limit is 20 kB: exactly at it is accepted, one byte over is a 413', async (t) => {
  const { client } = await withSite(t);
  const limit = 20 * 1024;
  const bodyOfSize = (size, username) => {
    const head = `{"username":"${username}","password":"password1","displayName":"`;
    const tail = '"}';
    return head + 'p'.repeat(size - head.length - tail.length) + tail;
  };
  const exact = bodyOfSize(limit, 'limit-ok');
  assert.equal(Buffer.byteLength(exact), limit);
  const ok = await client().call('POST', '/api/auth/register', exact, { 'content-type': 'application/json' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.displayName, 'p'.repeat(20));

  const over = bodyOfSize(limit + 1, 'limit-over');
  const refusedBody = await client().call('POST', '/api/auth/register', over, { 'content-type': 'application/json' });
  assert.equal(refusedBody.status, 413);
  assert.deepEqual(refusedBody.data, { error: 'That is too large.' });
  const huge = await client().call('POST', '/api/auth/login', JSON.stringify({ username: 'x', password: 'y'.repeat(1_000_000) }), { 'content-type': 'application/json' });
  assert.equal(huge.status, 413);
  assert.equal((await client().post('/api/auth/login', { username: 'limit-over', password: 'password1' })).status, 401, 'the refused registration made no account');
});

test('invalid JSON is a 400 with a JSON error, never a 500', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const json = { 'content-type': 'application/json' };
  for (const body of ['{bad', '{"a":', '{"a":1,}', "{'a':1}", 'undefined', '{"a":1}}', '\u0000', 'null', '"just a string"', '42', 'true']) {
    for (const [method, url] of [['POST', '/api/auth/register'], ['POST', '/api/auth/login'], ['PATCH', '/api/me'], ['POST', '/api/me/password']]) {
      const res = await c.call(method, url, body, json);
      assert.equal(res.status, 400, `${method} ${url} ${JSON.stringify(body)}`);
      assert.equal(typeof res.data.error, 'string');
    }
  }
  assert.match((await c.call('POST', '/api/auth/login', '{bad', json)).data.error, /JSON/);
});

test('an empty or odd-shaped (but valid) JSON body is handled as missing fields', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const json = { 'content-type': 'application/json' };
  for (const body of ['', '[]', '[1,2]', '{}', '{"username":null,"password":null}']) {
    assert.equal((await client().call('POST', '/api/auth/register', body, json)).status, 400, `register ${body}`);
    assert.equal((await client().call('POST', '/api/auth/login', body, json)).status, 401, `login ${body}`);
  }
  assert.equal((await c.call('PATCH', '/api/me', '', json)).status, 200, 'an empty patch changes nothing');
  assert.equal((await c.call('POST', '/api/me/password', '[]', json)).status, 401);
});

test('background settings over HTTP: colours, gradient angles and bad inputs', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const set = (background) => c.patch('/api/me', { background });
  assert.deepEqual((await set({ type: 'colour', value: '#ABCDEF' })).data.user.background, { type: 'colour', value: '#abcdef' });
  for (const [angle, expected] of [[-50, 0], [0, 0], [180.6, 181], [360, 360], [9999, 360], [undefined, 160], ['abc', 160]]) {
    const res = await set({ type: 'gradient', from: '#000000', to: '#FFFFFF', angle });
    assert.equal(res.data.user.background.angle, expected, `angle ${angle}`);
  }
  for (const bad of ['#abc', '#abcdeg', 'red', '#abcdef;', ['#abcdef'], 5, null]) {
    assert.equal((await set({ type: 'colour', value: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await set({ type: 'gradient', from: '#000000', to: 'nope' })).status, 400);
  assert.equal((await set({ type: 'gradient', from: ['#000000'], to: '#ffffff' })).status, 400);
  assert.equal((await set({ type: 'preset', value: ['night'] })).status, 400, 'an array is not a preset name');
  assert.equal((await set({ type: 'preset', value: '__proto__' })).status, 400);
  assert.equal((await set(null)).status, 400);
  assert.equal((await set('night')).status, 400);
  assert.equal((await set([])).status, 400);
  for (const file of ['../bg-1-aaaaaaaaaaaa.png', 'bg-1-aaaaaaaaaaaa.gif', 'BG-1-aaaaaaaaaaaa.png', 'bg-1-aaaaaaaaaaaa.png/..', '..%2fbg-1-aaaaaaaaaaaa.png', 'cb-1-aaaaaaaaaaaa.png', 'bg-1-AAAAAAAAAAAA.png']) {
    assert.equal((await set({ type: 'image', file })).status, 400, file);
  }
  assert.equal((await c.get('/api/me')).data.user.background.type, 'gradient', 'refused changes left it as it was');
});

test('card-back settings over HTTP', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const set = (cardBack) => c.patch('/api/me', { cardBack });
  assert.equal((await set({ type: 'preset', value: 'mono' })).data.user.cardBack.value, 'mono');
  for (const bad of [{ type: 'preset', value: 'dusk' }, { type: 'preset', value: ['navy'] }, { type: 'colour', value: '#ffffff' }, { type: 'image', file: 'bg-1-aaaaaaaaaaaa.png' }, { type: 'image', file: '../cb-1-aaaaaaaaaaaa.png' }, { type: 'image', file: 'cb-1-aaaaaaaaaaaa.bmp' }, null, 'navy']) {
    assert.equal((await set(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await c.get('/api/me')).data.user.cardBack.value, 'mono');
});

test('a profile update with one bad part changes none of it', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const res = await c.patch('/api/me', { displayName: 'Renamed', background: { type: 'preset', value: 'nope' } });
  assert.equal(res.status, 400);
  assert.equal((await c.get('/api/me')).data.user.displayName, 'alice');
});

test('profile and stats endpoints need a signed-in user', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  assert.equal((await c.patch('/api/me', { displayName: 'x' })).status, 401);
  assert.equal((await c.post('/api/me/password', { currentPassword: 'a', newPassword: 'bbbbbbbb' })).status, 401);
  assert.equal((await c.get('/api/stats/me')).status, 401);
  assert.equal((await c.get('/api/stats/leaderboard/coin')).status, 401);
  assert.equal((await c.get('/api/games/coin/rules')).status, 401);
  assert.equal((await c.raw('/api/me/background-image', Buffer.from('x'), 'image/png')).status, 401);
});

test('an expired session is signed out everywhere: pages, API and sockets', async (t) => {
  const { client, site } = await withSite(t);
  const c = client();
  await register(c);
  const socket = c.socket('/coin');
  await connected(socket);
  socket.close();

  site.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000);
  assert.equal((await c.get('/api/me')).data.user, null);
  assert.equal((await c.get('/api/stats/me')).status, 401);
  assert.equal((await c.patch('/api/me', { displayName: 'late' })).status, 401);
  const error = await refused(c.socket('/coin'));
  assert.match(error.message, /sign in/i);

  // Logging in again makes a fresh, working session.
  assert.equal((await c.post('/api/auth/login', { username: 'alice', password: 'correct horse' })).status, 200);
  assert.equal((await c.get('/api/me')).data.user.username, 'alice');
  await connected(c.socket('/coin'));
});

test('changing the password signs out other devices only (and their sockets cannot come back)', async (t) => {
  const { client } = await withSite(t);
  const laptop = client();
  await register(laptop);
  const phone = client();
  await phone.post('/api/auth/login', { username: 'alice', password: 'correct horse' });
  const bystander = client();
  await register(bystander, 'bob12', 'password1');

  assert.equal((await laptop.post('/api/me/password', { currentPassword: 'wrong wrong', newPassword: 'a brand new one' })).status, 401);
  assert.equal((await phone.get('/api/me')).data.user.username, 'alice', 'a refused change signs nobody out');
  assert.equal((await laptop.post('/api/me/password', { currentPassword: 'correct horse', newPassword: 'x'.repeat(201) })).status, 400);
  assert.equal((await laptop.post('/api/me/password', { currentPassword: 'correct horse', newPassword: 'a brand new one' })).status, 200);
  assert.equal((await phone.get('/api/me')).data.user, null);
  await refused(phone.socket('/coin'));
  assert.equal((await laptop.get('/api/me')).data.user.username, 'alice');
  assert.equal((await bystander.get('/api/me')).data.user.username, 'bob12');
  await connected(laptop.socket('/coin'));
});

test('login throttling over HTTP: per address (as seen through a trusted proxy) and username', async (t) => {
  const { client } = await withSite(t, { env: { TRUST_PROXY: '1' } });
  await register(client(), 'victim1', 'right password');
  await register(client(), 'bystander', 'right password');
  const from = (ip) => ({ 'x-forwarded-for': ip });
  const c = client();
  const guess = (username, password, ip) => c.call('POST', '/api/auth/login', { username, password }, from(ip));
  for (let i = 0; i < 10; i++) assert.equal((await guess('victim1', `wrong ${i}`, '203.0.113.1')).status, 401);
  const blocked = await guess('victim1', 'right password', '203.0.113.1');
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.error, /too many/i);
  assert.equal((await guess('VICTIM1', 'right password', '203.0.113.1')).status, 429, 'the username case does not matter');
  assert.equal((await guess('victim1', 'right password', '203.0.113.2')).status, 200, 'another address is unaffected');
  assert.equal((await guess('bystander', 'right password', '203.0.113.1')).status, 200, 'so is another username');
});

test('without a trusted proxy a forged X-Forwarded-For does not dodge the throttle', async (t) => {
  const { client } = await withSite(t);
  await register(client(), 'victim1', 'right password');
  const c = client();
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await c.call('POST', '/api/auth/login', { username: 'victim1', password: `wrong ${i}` }, { 'x-forwarded-for': `198.51.100.${i}` })).status;
  assert.equal(last, 429);
});

test('a successful login resets the throttle over HTTP', async (t) => {
  const { client } = await withSite(t);
  await register(client(), 'victim1', 'right password');
  const c = client();
  const login = (password) => c.post('/api/auth/login', { username: 'victim1', password });
  for (let i = 0; i < 9; i++) assert.equal((await login(`wrong ${i}`)).status, 401);
  assert.equal((await login('right password')).status, 200);
  for (let i = 0; i < 10; i++) assert.equal((await login(`wrong ${i}`)).status, 401);
  assert.equal((await login('right password')).status, 429);
});

test('a socket whose session was logged out cannot reconnect, but a fresh login can', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const socket = c.socket('/coin');
  await connected(socket);
  assert.equal((await ask(socket, 'whoami')).user.name, 'alice');

  await c.post('/api/auth/logout', {});
  socket.disconnect();
  const again = refused(socket);
  socket.connect(); // the same handshake headers: the cookie it signed in with
  assert.match((await again).message, /sign in/i);
  socket.close();

  const fresh = client();
  await fresh.post('/api/auth/login', { username: 'alice', password: 'correct horse' });
  const ok = fresh.socket('/coin');
  await connected(ok);
  assert.equal((await ask(ok, 'whoami')).user.name, 'alice');
});
