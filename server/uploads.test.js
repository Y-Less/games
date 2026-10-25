// Uploaded pictures (backgrounds and card backs): size limit, type checks, replacement, ownership and how they are served.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { jpeg, png, rawRequest, register, webp, withSite } from './fixtures/testkit.js';

const MB3 = 3 * 1024 * 1024;
const KINDS = [
  ['background', '/api/me/background-image', 'bg', 'background'],
  ['card back', '/api/me/card-back-image', 'cb', 'cardBack'],
];
const filesOf = (dataDir) => fs.readdirSync(path.join(dataDir, 'uploads')).sort();

for (const [label, route, prefix, field] of KINDS) {
  test(`${label} upload: exactly 3 MB is accepted, one byte more is refused with 413`, async (t) => {
    const { client, dataDir } = await withSite(t);
    const c = client();
    await register(c);
    const exact = await c.raw(route, png(MB3), 'image/png');
    assert.equal(exact.status, 200);
    assert.equal(fs.statSync(path.join(dataDir, 'uploads', exact.data.user[field].file)).size, MB3);
    const over = await c.raw(route, png(MB3 + 1), 'image/png');
    assert.equal(over.status, 413);
    assert.equal(typeof over.data.error, 'string');
    assert.equal(filesOf(dataDir).length, 1, 'the refused upload was not stored, and the earlier one stays');
    assert.equal((await c.get('/api/me')).data.user[field].file, exact.data.user[field].file);
  });

  test(`${label} upload: content types and magic bytes`, async (t) => {
    const { client, base, dataDir } = await withSite(t);
    const c = client();
    await register(c);
    const upload = (buffer, type) => c.raw(route, buffer, type);

    for (const [type, ext, buffer] of [['image/png', 'png', png()], ['image/jpeg', 'jpg', jpeg()], ['image/webp', 'webp', webp()]]) {
      const res = await upload(buffer, type);
      assert.equal(res.status, 200, type);
      assert.match(res.data.user[field].file, new RegExp(`^${prefix}-\\d+-[0-9a-f]{12}\\.${ext}$`));
      const served = Buffer.from(await (await fetch(`${base}/uploads/${res.data.user[field].file}`)).arrayBuffer());
      assert.deepEqual(served, buffer, 'what is stored is exactly what was sent');
    }
    assert.equal((await upload(png(), 'image/png; charset=binary')).status, 200, 'parameters on the type are ignored');

    const before = filesOf(dataDir);
    for (const [why, buffer, type] of [
      ['gif type', png(), 'image/gif'],
      ['svg type', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'],
      ['html type', png(), 'text/html'],
      ['octet-stream', png(), 'application/octet-stream'],
      ['text type', png(), 'text/plain'],
      ['jpeg bytes sent as png', jpeg(), 'image/png'],
      ['png bytes sent as jpeg', png(), 'image/jpeg'],
      ['webp bytes sent as png', webp(), 'image/png'],
      ['png bytes sent as webp', png(), 'image/webp'],
      ['RIFF without WEBP', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(32)]), 'image/webp'],
      ['script as png', Buffer.from('<script>alert(1)</script>'.repeat(5)), 'image/png'],
      ['script as jpeg', Buffer.from('<script>alert(1)</script>'.repeat(5)), 'image/jpeg'],
      ['truncated png signature', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png'],
      ['truncated jpeg signature', Buffer.from([0xff, 0xd8]), 'image/jpeg'],
      ['truncated webp header', Buffer.from('RIFF'), 'image/webp'],
      ['empty png', Buffer.alloc(0), 'image/png'],
      ['upper case type name', png(), 'IMAGE/PNG'],
    ]) {
      const res = await upload(buffer, type);
      assert.equal(res.status, 415, why);
    }
    assert.ok([400, 415].includes((await upload(png(), 'application/json')).status), 'png bytes labelled JSON are refused');
    assert.deepEqual(filesOf(dataDir), before, 'no refused upload left a file behind');
  });

  test(`${label} upload: needs a JSON-free image request from a signed-in user`, async (t) => {
    const { client } = await withSite(t);
    const anon = client();
    assert.equal((await anon.raw(route, png(), 'image/png')).status, 401);
    const c = client();
    await register(c);
    assert.equal((await c.post(route, { file: 'x' })).status, 415, 'a JSON body is not an image');
    assert.equal((await c.call('POST', route, undefined)).status, 415, 'no body, no type');
    assert.equal((await c.call('POST', route, 'plain text', { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await c.call('GET', route)).status, 404, 'only POST exists');
  });

  test(`${label} upload: one picture per user, replacing the old one and leaving other users alone`, async (t) => {
    const { client, base, dataDir, site } = await withSite(t);
    const alice = client();
    await register(alice, 'alice');
    // Give the second user id 10, so "bg-1-" must not be mistaken for the start of "bg-10-".
    site.db.prepare("INSERT INTO users (id, username, username_lower, password_hash, display_name, created_at) VALUES (9, 'filler', 'filler', 'x', 'filler', 0)").run();
    const bob = client();
    const bobUser = (await register(bob, 'bobby', 'password1')).data.user;
    assert.equal(bobUser.id, 10);
    const aliceId = (await alice.get('/api/me')).data.user.id;
    assert.equal(aliceId, 1);

    const a1 = (await alice.raw(route, png(), 'image/png')).data.user[field].file;
    const b1 = (await bob.raw(route, jpeg(), 'image/jpeg')).data.user[field].file;
    assert.ok(a1.startsWith(`${prefix}-1-`));
    assert.ok(b1.startsWith(`${prefix}-10-`));

    const a2 = (await alice.raw(route, webp(), 'image/webp')).data.user[field].file;
    assert.notEqual(a2, a1);
    assert.equal((await fetch(`${base}/uploads/${a1}`)).status, 404, "Alice's old picture is gone");
    assert.equal((await fetch(`${base}/uploads/${a2}`)).status, 200);
    assert.equal((await fetch(`${base}/uploads/${b1}`)).status, 200, "Bob's picture is untouched");

    const b2 = (await bob.raw(route, png(), 'image/png')).data.user[field].file;
    assert.equal((await fetch(`${base}/uploads/${a2}`)).status, 200, "Alice's picture is untouched");
    assert.equal((await fetch(`${base}/uploads/${b1}`)).status, 404);
    assert.deepEqual(filesOf(dataDir), [a2, b2].sort());
  });
}

test('the two kinds of picture are independent, including when settings change', async (t) => {
  const { client, base, dataDir } = await withSite(t);
  const c = client();
  await register(c);
  const bg = (await c.raw('/api/me/background-image', png(), 'image/png')).data.user.background.file;
  const cb = (await c.raw('/api/me/card-back-image', png(), 'image/png')).data.user.cardBack.file;
  assert.deepEqual(filesOf(dataDir), [bg, cb].sort());

  await c.patch('/api/me', { displayName: 'Renamed' });
  assert.deepEqual(filesOf(dataDir), [bg, cb].sort(), 'an unrelated change keeps both');
  await c.patch('/api/me', { cardBack: { type: 'preset', value: 'navy' } });
  assert.deepEqual(filesOf(dataDir), [bg], 'choosing a preset card back drops only the card back picture');
  await c.patch('/api/me', { background: { type: 'colour', value: '#123456' } });
  assert.deepEqual(filesOf(dataDir), []);
  assert.equal((await fetch(`${base}/uploads/${bg}`)).status, 404);
});

test('a refused settings change leaves the uploaded picture in place', async (t) => {
  const { client, dataDir } = await withSite(t);
  const c = client();
  await register(c);
  const bg = (await c.raw('/api/me/background-image', png(), 'image/png')).data.user.background.file;
  assert.equal((await c.patch('/api/me', { background: { type: 'preset', value: 'nope' } })).status, 400);
  assert.deepEqual(filesOf(dataDir), [bg]);
  assert.equal((await c.get('/api/me')).data.user.background.file, bg);
});

test('uploaded files are served with nosniff and long immutable caching, with the right type', async (t) => {
  const { client, base } = await withSite(t);
  const c = client();
  await register(c);
  for (const [buffer, type, ext, expectedType] of [[png(), 'image/png', 'png', 'image/png'], [jpeg(), 'image/jpeg', 'jpg', 'image/jpeg'], [webp(), 'image/webp', 'webp', 'image/webp']]) {
    const file = (await c.raw('/api/me/background-image', buffer, type)).data.user.background.file;
    assert.ok(file.endsWith(`.${ext}`));
    const res = await fetch(`${base}/uploads/${file}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-type'), expectedType);
    const cache = res.headers.get('cache-control');
    assert.match(cache, /max-age=2592000/);
    assert.match(cache, /immutable/);
    await res.arrayBuffer();
  }
});

test('unknown upload files are plain 404s, never the client app, and cannot escape the folder', async (t) => {
  const dist = (await import('./fixtures/testkit.js')).tempDir(t, 'hub-dist-');
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>SPA-MARKER</title>');
  const { base } = await withSite(t, { distDir: dist });
  for (const missing of ['/uploads/nope.png', '/uploads/bg-1-aaaaaaaaaaaa.png', '/uploads/', '/uploads/deep/er/nope.png']) {
    const res = await fetch(base + missing);
    assert.equal(res.status, 404, missing);
    assert.ok(!(await res.text()).includes('SPA-MARKER'), `${missing} is not the SPA page`);
  }
  for (const sneaky of ['/uploads/..%2fhub.sqlite', '/uploads/%2e%2e/hub.sqlite', '/uploads/../hub.sqlite', '/uploads/..%5chub.sqlite', '/uploads/%2e%2e%2f%2e%2e%2fhub.sqlite', '/uploads/bg-1-aaaaaaaaaaaa.png%00.png']) {
    const res = await rawRequest(base, { path: sneaky });
    assert.ok(res.status >= 400 && res.status < 500, `${sneaky} gave ${res.status}`);
    assert.ok(!res.body.toString('latin1').startsWith('SQLite format'), `${sneaky} did not leak the database`);
  }
});
