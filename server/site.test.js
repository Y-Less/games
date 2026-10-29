// Site-level behaviour: the client app fallback, unknown routes, shutdown and running several sites side by side.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ask, connected, register, tempDir, withSite, workspace } from './fixtures/testkit.js';

function distFolder(t) {
  const dir = tempDir(t, 'hub-dist-');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>SPA-MARKER</title>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("app");');
  fs.mkdirSync(path.join(dir, 'static'));
  fs.writeFileSync(path.join(dir, 'static', 'logo.svg'), '<svg/>');
  return dir;
}

test('client routes fall back to the app page, and real files are served as they are', async (t) => {
  const { base } = await withSite(t, { distDir: distFolder(t) });
  const get = async (url) => {
    const res = await fetch(base + url);
    return { status: res.status, text: await res.text(), type: res.headers.get('content-type') ?? '' };
  };
  for (const route of ['/', '/play/coin', '/play/coin?boss-aware-you', '/profile', '/some/deep/route/that/does/not/exist', '/login', '/index.html']) {
    const res = await get(route);
    assert.equal(res.status, 200, route);
    assert.match(res.text, /SPA-MARKER/, route);
    assert.match(res.type, /text\/html/);
  }
  assert.equal((await get('/app.js')).text, 'console.log("app");');
  assert.match((await get('/static/logo.svg')).type, /svg/);
});

test('unknown API routes are JSON 404s, never the app page', async (t) => {
  const { base, client } = await withSite(t, { distDir: distFolder(t) });
  const c = client();
  for (const url of ['/api/nothing', '/api', '/api/', '/api/me/nothing', '/api/auth/register', '/api/auth/login', '/api/stats/nothing', '/api/games']) {
    const res = await fetch(base + url);
    assert.equal(res.status, 404, `GET ${url}`);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await res.json(), { error: 'Not found.' });
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await c.call(method, '/api/does-not-exist', {});
    assert.equal(res.status, 404, method);
    assert.deepEqual(res.data, { error: 'Not found.' });
  }
  assert.equal((await c.get('/api/stats/leaderboard/nope')).status, 401, 'protected routes check sign-in first');
});

test('missing files under /uploads, /assets and /socket.io are 404s, not the app page', async (t) => {
  const { base } = await withSite(t, { distDir: distFolder(t) });
  for (const url of ['/uploads/missing.png', '/assets/coin/missing.png', '/assets/nothing/at-all', '/socket.io/nothing/', '/uploads/a/b/c']) {
    const res = await fetch(base + url);
    assert.ok(res.status >= 400 && res.status < 500, `${url} gave ${res.status}`);
    assert.ok(!(await res.text()).includes('SPA-MARKER'), url);
  }
});

test('without a built client the site still answers (404 for pages, API unaffected)', async (t) => {
  const { base } = await withSite(t); // its dist folder does not exist
  assert.equal((await fetch(base + '/')).status, 404);
  assert.equal((await fetch(base + '/play/coin')).status, 404);
  assert.equal((await fetch(base + '/api/config')).status, 200);
});

test('the config lists the games, backgrounds and card backs', async (t) => {
  const { client } = await withSite(t);
  const config = (await client().get('/api/config')).data;
  assert.deepEqual(Object.keys(config).sort(), ['backgrounds', 'cardBacks', 'games']);
  assert.deepEqual(Object.keys(config.backgrounds).sort(), ['dusk', 'ember', 'forest', 'lagoon', 'night', 'ocean', 'pine', 'slate', 'violet', 'wine']);
  assert.deepEqual(Object.keys(config.cardBacks).sort(), ['amber', 'carbon', 'chequer', 'crimson', 'emerald', 'forest', 'gingham', 'gold', 'ice', 'lavender', 'midnight', 'mint', 'mono', 'navy', 'ocean', 'plum', 'rose', 'ruby', 'sunset', 'teal']);
});

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

test('close() releases the port, so another site can take it straight away', async (t) => {
  const first = await withSite(t);
  const { port } = first.site;
  assert.equal(await canConnect(port), true);
  await first.close();
  assert.equal(await canConnect(port), false, 'nothing listens any more');
  const second = await withSite(t, { port });
  assert.equal(second.site.port, port);
  assert.equal((await fetch(second.base + '/api/config')).status, 200);
});

test('close() releases the data folder files, even with clients still connected', async (t) => {
  const { dir, track } = workspace(t);
  const site = await withSite(t, { dataDir: dir });
  track(site);
  const c = site.client();
  await register(c);
  const socket = c.socket('/coin');
  await connected(socket);
  await ask(socket, 'finish', { outcome: 'win', score: 1 });
  await (await fetch(site.base + '/api/me', { headers: { cookie: c.cookie(), connection: 'keep-alive' } })).text();

  const disconnected = new Promise((resolve) => socket.on('disconnect', resolve));
  await site.close();
  await disconnected;
  assert.equal(socket.connected, false, 'connected sockets are dropped');
  // Windows refuses to delete a file that is still open, so deleting the folder proves they were released.
  fs.rmSync(dir, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 });
  assert.ok(!fs.existsSync(dir));
});

test('data survives a restart on the same data folder', async (t) => {
  const { dir, track } = workspace(t);
  const first = await withSite(t, { dataDir: dir });
  track(first);
  const c = first.client();
  await register(c, 'persistent', 'password1');
  const socket = c.socket('/coin');
  await connected(socket);
  await ask(socket, 'finish', { outcome: 'win', score: 7 });
  await first.close();

  const second = await withSite(t, { dataDir: dir });
  track(second);
  const back = second.client();
  assert.equal((await back.post('/api/auth/login', { username: 'persistent', password: 'password1' })).status, 200);
  assert.equal((await back.get('/api/stats/me')).data.summary.wins, 1);
  const old = second.client();
  old.setCookie(c.cookie());
  assert.equal((await old.get('/api/me')).data.user.username, 'persistent', 'sessions survive a restart too');
});

test('two sites with different data folders and ports run together without sharing anything', async (t) => {
  const one = await withSite(t);
  const two = await withSite(t);
  assert.notEqual(one.site.port, two.site.port);
  assert.notEqual(one.dataDir, two.dataDir);

  const a = one.client();
  const b = two.client();
  assert.equal((await register(a, 'samename', 'password one')).status, 200);
  assert.equal((await register(b, 'samename', 'password two')).status, 200, 'the same username is free on the other site');
  assert.equal((await register(one.client(), 'samename', 'whatever else')).status, 409);

  // A session from one site means nothing to the other.
  const crossed = two.client();
  crossed.setCookie(a.cookie());
  assert.equal((await crossed.get('/api/me')).data.user, null);
  await assert.rejects(connected(crossed.socket('/coin')));

  // Results and settings stay on their own site.
  const sa = a.socket('/coin');
  await connected(sa);
  await ask(sa, 'finish', { outcome: 'win', score: 5 });
  assert.equal((await a.get('/api/stats/me')).data.summary.played, 1);
  assert.equal((await b.get('/api/stats/me')).data.summary.played, 0);
  await a.patch('/api/me', { displayName: 'Site One' });
  assert.equal((await b.get('/api/me')).data.user.displayName, 'samename');

  // Closing one leaves the other running.
  await one.close();
  assert.equal((await b.get('/api/me')).data.user.username, 'samename');
  assert.equal(fs.existsSync(path.join(two.dataDir, 'hub.sqlite')), true);
});

test('the site reports how many games it loaded when it starts', async (t) => {
  const { logs } = await withSite(t);
  assert.ok(logs.some((l) => /listening on http:\/\/localhost:\d+ with 1 game\(s\): coin/.test(l)), logs.join('\n'));
});
