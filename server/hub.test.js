// Tests the site end to end: a real server on a spare port, real HTTP calls and real sockets, using a fixture game module.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { startSite } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const modulesDir = path.join(here, 'fixtures', 'modules');

async function withSite(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
  const site = await startSite({ port: 0, dataDir, modulesDir, log: () => {} });
  const base = `http://127.0.0.1:${site.port}`;
  t.after(async () => {
    await site.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  /** A tiny cookie-keeping HTTP client. */
  function client() {
    let cookie = '';
    const call = async (method, url, body, headers = {}) => {
      const isJson = body !== undefined && !Buffer.isBuffer(body);
      const res = await fetch(base + url, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(isJson ? { 'content-type': 'application/json' } : {}), ...headers },
        body: isJson ? JSON.stringify(body) : body,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data };
    };
    return {
      get: (url) => call('GET', url),
      post: (url, body = {}) => call('POST', url, body),
      patch: (url, body) => call('PATCH', url, body),
      raw: (url, buffer, type) => call('POST', url, buffer, { 'content-type': type }),
      cookie: () => cookie,
      socket: (namespace) => connect(base + namespace, { forceNew: true, extraHeaders: { cookie } }),
    };
  }
  return { site, base, client };
}

const register = (c, username = 'alice', password = 'correct horse') => c.post('/api/auth/register', { username, password });

test('registering signs you in, and a bad registration is refused', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  assert.equal((await c.get('/api/me')).data.user, null, 'not signed in yet');

  assert.equal((await register(c, 'ab')).status, 400, 'username too short');
  assert.equal((await register(c, 'alice', 'short')).status, 400, 'password too short');
  const ok = await register(c);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.username, 'alice');
  assert.equal(ok.data.user.displayName, 'alice');
  assert.equal(ok.data.user.password_hash, undefined, 'the hash is never sent');
  assert.match(c.cookie(), /^sid=[0-9a-f]{64}$/);
  assert.equal((await c.get('/api/me')).data.user.username, 'alice');

  const other = client();
  assert.equal((await register(other, 'ALICE', 'another password')).status, 409, 'usernames are unique, ignoring case');
});

test('login, logout and wrong passwords', async (t) => {
  const { client } = await withSite(t);
  const first = client();
  await register(first);
  assert.equal((await first.post('/api/auth/logout')).status, 200);
  assert.equal((await first.get('/api/me')).data.user, null, 'logged out');

  const c = client();
  assert.equal((await c.post('/api/auth/login', { username: 'alice', password: 'wrong password' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { username: 'nobody', password: 'whatever it is' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { username: 'Alice', password: 'correct horse' })).status, 200);
  assert.equal((await c.get('/api/me')).data.user.username, 'alice');
});

test('repeated wrong passwords are slowed down', async (t) => {
  const { client } = await withSite(t);
  await register(client());
  const c = client();
  let status = 0;
  for (let i = 0; i < 12; i++) status = (await c.post('/api/auth/login', { username: 'alice', password: `wrong guess ${i}` })).status;
  assert.equal(status, 429);
});

test('changes must be sent as JSON (so other websites cannot make them)', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  const bad = await c.raw('/api/auth/register', Buffer.from('username=bob&password=password1'), 'application/x-www-form-urlencoded');
  assert.equal(bad.status, 415);
});

test('profile: display name, background settings and password change', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  assert.equal((await c.patch('/api/me', { displayName: 'Alice A.' })).data.user.displayName, 'Alice A.');
  assert.equal((await c.patch('/api/me', { displayName: '   ' })).status, 400);
  assert.equal((await c.patch('/api/me', { displayName: 'x'.repeat(21) })).status, 400);

  assert.deepEqual((await c.patch('/api/me', { background: { type: 'preset', value: 'forest' } })).data.user.background, { type: 'preset', value: 'forest' });
  assert.deepEqual((await c.patch('/api/me', { background: { type: 'colour', value: '#AABBCC' } })).data.user.background, { type: 'colour', value: '#aabbcc' });
  const gradient = await c.patch('/api/me', { background: { type: 'gradient', from: '#112233', to: '#445566', angle: 90 } });
  assert.deepEqual(gradient.data.user.background, { type: 'gradient', from: '#112233', to: '#445566', angle: 90 });
  for (const bad of [{ type: 'preset', value: 'nope' }, { type: 'colour', value: 'red; background: url(x)' }, { type: 'image', file: '../../etc/passwd' }, { type: 'image', file: 'cb-1-aaaaaaaaaaaa.png' }, { type: 'css', value: 'x' }]) {
    assert.equal((await c.patch('/api/me', { background: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal((await c.get('/api/me')).data.user.background.type, 'gradient', 'refused changes changed nothing');

  assert.equal((await c.post('/api/me/password', { currentPassword: 'not it at all', newPassword: 'a brand new one' })).status, 401);
  assert.equal((await c.post('/api/me/password', { currentPassword: 'correct horse', newPassword: 'short' })).status, 400);

  const second = client(); // a second signed-in device
  await second.post('/api/auth/login', { username: 'alice', password: 'correct horse' });
  assert.equal((await c.post('/api/me/password', { currentPassword: 'correct horse', newPassword: 'a brand new one' })).status, 200);
  assert.equal((await second.get('/api/me')).data.user, null, 'other devices are signed out');
  assert.equal((await c.get('/api/me')).data.user.username, 'alice', 'this device stays signed in');
  assert.equal((await client().post('/api/auth/login', { username: 'alice', password: 'a brand new one' })).status, 200);
  assert.equal((await client().post('/api/auth/login', { username: 'alice', password: 'correct horse' })).status, 401);
});

test('an uploaded background image is checked, stored and replaced', async (t) => {
  const { client, base } = await withSite(t);
  const c = client();
  await register(c);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

  assert.equal((await c.raw('/api/me/background-image', Buffer.from('<script>alert(1)</script>'), 'image/png')).status, 415, 'not really a PNG');
  assert.equal((await c.raw('/api/me/background-image', Buffer.from('hello'), 'text/html')).status, 415);
  assert.equal((await client().raw('/api/me/background-image', png, 'image/png')).status, 401, 'signed-in users only');

  const first = await c.raw('/api/me/background-image', png, 'image/png');
  assert.equal(first.status, 200);
  const file = first.data.user.background.file;
  assert.match(file, /^bg-\d+-[0-9a-f]{12}\.png$/);
  const served = await fetch(`${base}/uploads/${file}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');

  const second = await c.raw('/api/me/background-image', png, 'image/png');
  assert.notEqual(second.data.user.background.file, file);
  assert.equal((await fetch(`${base}/uploads/${file}`)).status, 404, 'the old image is removed');

  await c.patch('/api/me', { background: { type: 'preset', value: 'dusk' } });
  assert.equal((await fetch(`${base}/uploads/${second.data.user.background.file}`)).status, 404, 'so is an unused one');
});

test('game modules: listed, with rules, and sockets need a signed-in user', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  const config = (await c.get('/api/config')).data;
  assert.deepEqual(config.games.map((g) => [g.id, g.name, g.minPlayers, g.maxPlayers]), [['coin', 'Coin Flip', 1, 2]]);
  assert.ok(config.backgrounds.night);

  assert.equal((await c.get('/api/games/coin/rules')).status, 401, 'rules need an account');
  await register(c);
  assert.match((await c.get('/api/games/coin/rules')).data, /Call it in the air/);
  assert.equal((await c.get('/api/games/nope/rules')).status, 404);

  const anonymous = client().socket('/coin');
  const error = await new Promise((resolve) => anonymous.on('connect_error', resolve));
  assert.match(error.message, /sign in/i);
  anonymous.close();

  const socket = c.socket('/coin');
  await new Promise((resolve) => socket.on('connect', resolve));
  const me = await new Promise((resolve) => socket.emit('whoami', {}, resolve));
  assert.equal(me.user.name, 'alice');
  socket.close();
});

test('statistics: modules report results and the profile shows totals and module-specific stats', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  const socket = c.socket('/coin');
  await new Promise((resolve) => socket.on('connect', resolve));
  const finish = (payload) => new Promise((resolve) => socket.emit('finish', payload, resolve));

  assert.deepEqual((await c.get('/api/stats/me')).data.summary, { played: 0, wins: 0, losses: 0, draws: 0, winRate: 0 });
  await finish({ outcome: 'win', score: 300, streak: 3 });
  await finish({ outcome: 'win', score: 150, streak: 5 });
  await finish({ outcome: 'loss', score: 50, streak: 1 });
  await finish({ outcome: 'draw', score: 100 });

  const stats = (await c.get('/api/stats/me')).data;
  assert.deepEqual(stats.summary, { played: 4, wins: 2, losses: 1, draws: 1, winRate: 0.5 });
  const [coin] = stats.perGame;
  assert.equal(coin.name, 'Coin Flip');
  assert.equal(coin.totalScore, 600);
  assert.equal(coin.bestScore, 300);
  assert.deepEqual(coin.extras, [
    { key: 'flips', label: 'Flips', value: 4 },
    { key: 'streak', label: 'Best streak', value: 5 },
  ]);
  assert.equal(stats.recent.length, 4);
  assert.equal(stats.recent[0].outcome, 'draw', 'most recent first');

  socket.close();
});

test('leaderboard ranks by wins and leaves bots out', async (t) => {
  const { client } = await withSite(t);
  const people = [];
  for (const [name, wins, losses] of [['ann', 3, 0], ['bea', 1, 2], ['cyd', 2, 0]]) {
    const c = client();
    await register(c, name, `${name} password`);
    people.push(c);
    const socket = c.socket('/coin');
    await new Promise((resolve) => socket.on('connect', resolve));
    for (let i = 0; i < wins; i++) await new Promise((resolve) => socket.emit('finish', { outcome: 'win', score: 1 }, resolve));
    for (let i = 0; i < losses; i++) await new Promise((resolve) => socket.emit('finish', { outcome: 'loss', score: 0 }, resolve));
    socket.close();
  }
  const botClient = client();
  const bot = await botClient.post('/api/auth/register', { username: 'botty', password: 'bot password', isBot: true });
  assert.equal(bot.data.user.isBot, false, 'a client cannot make itself a bot through the public API');

  const board = (await people[0].get('/api/stats/leaderboard/coin')).data.leaderboard;
  assert.deepEqual(board.map((r) => [r.name, r.wins]), [['ann', 3], ['cyd', 2], ['bea', 1]]);
  assert.equal((await people[0].get('/api/stats/leaderboard/nope')).status, 404);
});

test('card backs: presets, an uploaded picture, and checks like the background has', async (t) => {
  const { client, base } = await withSite(t);
  const c = client();
  await register(c);
  assert.deepEqual((await c.get('/api/me')).data.user.cardBack, { type: 'preset', value: 'crimson' }, 'a default');
  assert.ok((await c.get('/api/config')).data.cardBacks.navy);

  assert.deepEqual((await c.patch('/api/me', { cardBack: { type: 'preset', value: 'navy' } })).data.user.cardBack, { type: 'preset', value: 'navy' });
  for (const bad of [{ type: 'preset', value: 'nope' }, { type: 'image', file: 'bg-1-aaaaaaaaaaaa.png' }, { type: 'colour', value: '#ffffff' }]) {
    assert.equal((await c.patch('/api/me', { cardBack: bad })).status, 400, `rejects ${JSON.stringify(bad)}`);
  }

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  assert.equal((await c.raw('/api/me/card-back-image', Buffer.from('not an image'), 'image/png')).status, 415);
  const back = await c.raw('/api/me/card-back-image', png, 'image/png');
  assert.equal(back.status, 200);
  const file = back.data.user.cardBack.file;
  assert.match(file, /^cb-\d+-[0-9a-f]{12}\.png$/);
  assert.equal((await fetch(`${base}/uploads/${file}`)).status, 200);

  // The two kinds of picture are independent.
  const bg = await c.raw('/api/me/background-image', png, 'image/png');
  assert.equal((await fetch(`${base}/uploads/${file}`)).status, 200, 'a new background leaves the card back alone');
  await c.patch('/api/me', { background: { type: 'preset', value: 'dusk' } });
  assert.equal((await fetch(`${base}/uploads/${file}`)).status, 200);
  assert.equal((await fetch(`${base}/uploads/${bg.data.user.background.file}`)).status, 404);

  await c.patch('/api/me', { cardBack: { type: 'preset', value: 'gold' } });
  assert.equal((await fetch(`${base}/uploads/${file}`)).status, 404, 'an unused card back picture is removed');
});

test('a picture can only be chosen by the user who uploaded it', async (t) => {
  const { client } = await withSite(t);
  const owner = client();
  const other = client();
  await register(owner, 'owner', 'owner password');
  await register(other, 'other', 'other password');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const bg = (await owner.raw('/api/me/background-image', png, 'image/png')).data.user.background.file;
  const back = (await owner.raw('/api/me/card-back-image', png, 'image/png')).data.user.cardBack.file;
  assert.equal((await other.patch('/api/me', { background: { type: 'image', file: bg } })).status, 400);
  assert.equal((await other.patch('/api/me', { cardBack: { type: 'image', file: back } })).status, 400);
  assert.equal((await other.get('/api/me')).data.user.background.type, 'preset', 'nothing changed');
  assert.equal((await owner.patch('/api/me', { background: { type: 'image', file: bg } })).status, 200, 'the owner can choose it again');
});
