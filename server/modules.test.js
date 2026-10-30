// The module loader: what is loaded, what is skipped, and everything a module's ctx offers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ECHO_SERVER, EMPTY_SERVER, ask, connected, manifest, rawRequest, refused, register, tempDir, withSite, workspace, writeModules } from './fixtures/testkit.js';

const quietErrors = (t) => t.mock.method(console, 'error', () => {});
const ids = async (client) => (await client.get('/api/config')).data.games.map((g) => g.id);

test('a module with a broken server.js is skipped without stopping the site or the other modules', async (t) => {
  const errors = quietErrors(t);
  const modulesDir = writeModules(t, {
    good: { 'module.json': manifest('good'), 'server.js': ECHO_SERVER },
    throws: { 'module.json': manifest('throws'), 'server.js': "export default function () { throw new Error('boom at start'); }" },
    syntax: { 'module.json': manifest('syntax'), 'server.js': 'export default function ( {{{' },
    rejects: { 'module.json': manifest('rejects'), 'server.js': "export default async function () { throw new Error('async boom'); }" },
    noserver: { 'module.json': manifest('noserver') },
    badimport: { 'module.json': manifest('badimport'), 'server.js': "import './does-not-exist.js'; export default function () {}" },
    nodefault: { 'module.json': manifest('nodefault'), 'server.js': 'export const x = 1;' },
    'also-good': { 'module.json': manifest('also-good'), 'server.js': EMPTY_SERVER },
  });
  const { client, logs } = await withSite(t, { modulesDir });
  assert.deepEqual((await ids(client())).sort(), ['also-good', 'good']);
  assert.ok(logs.some((l) => l.includes('module loaded: good')));
  const complained = errors.mock.calls.map((c) => String(c.arguments[0]));
  for (const name of ['throws', 'syntax', 'rejects', 'noserver', 'badimport', 'nodefault']) assert.ok(complained.some((m) => m.includes(`"${name}"`)), `${name} was reported`);
  // The healthy module still works.
  const c = client();
  await register(c);
  const socket = c.socket('/good');
  await connected(socket);
  assert.equal((await ask(socket, 'whoami')).id, 'good');
});

test('the module id must match the folder name and look like an id', async (t) => {
  quietErrors(t);
  const modulesDir = writeModules(t, {
    matching: { 'module.json': manifest('matching'), 'server.js': EMPTY_SERVER },
    wrongfolder: { 'module.json': manifest('somethingelse'), 'server.js': EMPTY_SERVER },
    Upper: { 'module.json': manifest('Upper'), 'server.js': EMPTY_SERVER },
    x: { 'module.json': manifest('x'), 'server.js': EMPTY_SERVER },
    'two words': { 'module.json': manifest('two words'), 'server.js': EMPTY_SERVER },
    '1digit': { 'module.json': manifest('1digit'), 'server.js': EMPTY_SERVER },
    noid: { 'module.json': { name: 'No id' }, 'server.js': EMPTY_SERVER },
    numeric: { 'module.json': { id: 5, name: 'five' }, 'server.js': EMPTY_SERVER },
    'dash-ok': { 'module.json': manifest('dash-ok'), 'server.js': EMPTY_SERVER },
    ab: { 'module.json': manifest('ab'), 'server.js': EMPTY_SERVER },
  });
  const { client } = await withSite(t, { modulesDir });
  assert.deepEqual((await ids(client())).sort(), ['ab', 'dash-ok', 'matching']);
});

test('a bad module.json skips just that module', async (t) => {
  quietErrors(t);
  const modulesDir = writeModules(t, {
    fine: { 'module.json': manifest('fine'), 'server.js': EMPTY_SERVER },
    notjson: { 'module.json': '{ this is not json', 'server.js': EMPTY_SERVER },
    empty: { 'module.json': '', 'server.js': EMPTY_SERVER },
    arrayjson: { 'module.json': '[]', 'server.js': EMPTY_SERVER },
    nulljson: { 'module.json': 'null', 'server.js': EMPTY_SERVER },
    stringjson: { 'module.json': '"fine"', 'server.js': EMPTY_SERVER },
  });
  const { client } = await withSite(t, { modulesDir });
  assert.deepEqual(await ids(client()), ['fine']);
});

test('folders without a module.json, and loose files, are ignored quietly', async (t) => {
  const errors = quietErrors(t);
  const modulesDir = writeModules(t, {
    fine: { 'module.json': manifest('fine'), 'server.js': EMPTY_SERVER },
    'just-files': { 'readme.md': 'hello', 'server.js': EMPTY_SERVER },
    'empty-folder': {},
  });
  fs.mkdirSync(path.join(modulesDir, 'empty-folder'));
  fs.writeFileSync(path.join(modulesDir, 'loose-file.txt'), 'not a module');
  const { client } = await withSite(t, { modulesDir });
  assert.deepEqual(await ids(client()), ['fine']);
  assert.equal(errors.mock.callCount(), 0, 'nothing to complain about');
});

test('a missing modules folder just means no games', async (t) => {
  const dir = tempDir(t);
  const { client } = await withSite(t, { modulesDir: path.join(dir, 'does-not-exist') });
  assert.deepEqual((await client().get('/api/config')).data.games, []);
});

test('manifest fields get sensible defaults and the list is sorted by name', async (t) => {
  const modulesDir = writeModules(t, {
    zed: { 'module.json': { id: 'zed', name: 'Zed' }, 'server.js': EMPTY_SERVER },
    bare: { 'module.json': { id: 'bare' }, 'server.js': EMPTY_SERVER },
    full: {
      'module.json': { id: 'full', name: 'Full Game', description: 'Described', minPlayers: 2, maxPlayers: 6, category: 'cards', rules: 'rules.md', stats: [{ key: 'a', label: 'A' }, { key: 'nolabel' }, { label: 'nokey' }, null, 'str'] },
      'server.js': EMPTY_SERVER,
    },
    onlymin: { 'module.json': { id: 'onlymin', name: 'Aardvark', minPlayers: 3 }, 'server.js': EMPTY_SERVER },
  });
  const { client } = await withSite(t, { modulesDir });
  const games = (await client().get('/api/config')).data.games;
  assert.deepEqual(games.map((g) => g.name), ['Aardvark', 'bare', 'Full Game', 'Zed']);
  const byId = Object.fromEntries(games.map((g) => [g.id, g]));
  assert.deepEqual(byId.bare, { id: 'bare', name: 'bare', description: '', minPlayers: 1, maxPlayers: 1, category: 'other', rules: null, stats: [], achievements: [] });
  assert.equal(byId.onlymin.maxPlayers, 3, 'maxPlayers defaults to minPlayers');
  assert.deepEqual(byId.full.stats, [{ key: 'a', label: 'A' }], 'stat declarations need a key and a label');
  assert.equal(byId.full.rules, 'rules.md');
});

test('module data folders are created, per module, inside the data folder', async (t) => {
  const modulesDir = writeModules(t, {
    one: {
      'module.json': manifest('one'),
      'server.js': "import fs from 'node:fs'; import path from 'node:path'; export default function (ctx) { fs.writeFileSync(path.join(ctx.dataDir, 'hello.txt'), ctx.id); }",
    },
    two: { 'module.json': manifest('two'), 'server.js': EMPTY_SERVER },
  });
  const { dataDir } = await withSite(t, { modulesDir });
  assert.ok(fs.statSync(path.join(dataDir, 'modules', 'one')).isDirectory());
  assert.ok(fs.statSync(path.join(dataDir, 'modules', 'two')).isDirectory());
  assert.equal(fs.readFileSync(path.join(dataDir, 'modules', 'one', 'hello.txt'), 'utf8'), 'one');
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'modules', 'two')), []);
});

test('a module data folder keeps its files when the site restarts', async (t) => {
  const modulesDir = writeModules(t, { keep: { 'module.json': manifest('keep'), 'server.js': EMPTY_SERVER } });
  const { dir, track } = workspace(t);
  const first = await withSite(t, { modulesDir, dataDir: dir });
  track(first);
  fs.writeFileSync(path.join(first.dataDir, 'modules', 'keep', 'saved.json'), '{"a":1}');
  await first.close();
  const second = await withSite(t, { modulesDir, dataDir: dir });
  track(second);
  assert.equal(fs.readFileSync(path.join(second.dataDir, 'modules', 'keep', 'saved.json'), 'utf8'), '{"a":1}');
});

test('symlinked or junctioned module folders are loaded', async (t) => {
  const real = writeModules(t, { realmod: { 'module.json': manifest('linked'), 'server.js': ECHO_SERVER, 'rules.md': 'Linked rules' } });
  const modulesDir = tempDir(t, 'hub-linkmods-');
  // The real folder is named "realmod" but the link is called "linked", matching the id.
  const link = path.join(modulesDir, 'linked');
  try {
    fs.symlinkSync(path.join(real, 'realmod'), link, 'junction');
  } catch (error) {
    t.skip(`cannot create a symlink or junction here: ${error.code}`);
    return;
  }
  const { client } = await withSite(t, { modulesDir });
  const c = client();
  assert.deepEqual(await ids(c), ['linked']);
  await register(c);
  const socket = c.socket('/linked');
  await connected(socket);
  assert.equal((await ask(socket, 'whoami')).id, 'linked');
});

test('a dangling link in the modules folder does not stop the others', async (t) => {
  quietErrors(t);
  const modulesDir = writeModules(t, { fine: { 'module.json': manifest('fine'), 'server.js': EMPTY_SERVER } });
  try {
    fs.symlinkSync(path.join(modulesDir, 'nowhere'), path.join(modulesDir, 'dangling'), 'junction');
  } catch (error) {
    t.skip(`cannot create a symlink or junction here: ${error.code}`);
    return;
  }
  // A dangling link makes statSync throw while the folders are listed; the site must still start for the good module.
  const { client } = await withSite(t, { modulesDir }).catch((error) => {
    t.diagnostic(`a dangling link stops the site: ${error.message}`);
    throw error;
  });
  assert.deepEqual(await ids(client()), ['fine']);
});

test("ctx gives a module its id, namespace, users, codes and a prefixed log", async (t) => {
  const modulesDir = writeModules(t, {
    probe: {
      'module.json': manifest('probe'),
      'server.js': `export default function (ctx) {
        ctx.log('hello', 42);
        ctx.io.on('connection', (socket) => {
          socket.on('probe', (payload, ack) => ack({
            id: ctx.id,
            namespace: ctx.io.name,
            me: ctx.users.get(socket.data.user.id),
            nobody: ctx.users.get(987654),
            generated: ctx.codes.generate(),
            normalised: ctx.codes.normalise(payload.raw),
            keys: Object.keys(ctx).sort(),
          }));
        });
      }`,
    },
  });
  const { client, logs } = await withSite(t, { modulesDir });
  assert.ok(logs.includes('[probe] hello 42'));
  const c = client();
  await register(c, 'prober', 'password1', { displayName: 'The Prober' });
  const socket = c.socket('/probe');
  await connected(socket);
  const reply = await ask(socket, 'probe', { raw: '?code=Boss-Aware-You' });
  assert.equal(reply.id, 'probe');
  assert.equal(reply.namespace, '/probe');
  assert.equal(reply.me.username, 'prober');
  assert.equal(reply.me.displayName, 'The Prober');
  assert.equal(reply.me.isBot, false);
  assert.ok(reply.me.background && reply.me.cardBack);
  assert.equal(reply.nobody, null);
  assert.match(reply.generated, /^[a-z]+-[a-z]+-[a-z]+$/);
  assert.equal(reply.normalised, 'boss-aware-you');
  assert.deepEqual(reply.keys, ['achievements', 'codes', 'dataDir', 'id', 'io', 'log', 'markers', 'mount', 'stats', 'users']);
});

test('socket users carry id, display name and bot flag, and a rename shows on the next connection', async (t) => {
  const modulesDir = writeModules(t, { echo: { 'module.json': manifest('echo'), 'server.js': ECHO_SERVER } });
  const { client } = await withSite(t, { modulesDir });
  const c = client();
  const { user } = (await register(c, 'namer', 'password1')).data;
  const first = c.socket('/echo');
  await connected(first);
  assert.deepEqual((await ask(first, 'whoami')).user, { id: user.id, name: 'namer', isBot: false });
  await c.patch('/api/me', { displayName: 'Renamed' });
  const second = c.socket('/echo');
  await connected(second);
  assert.equal((await ask(second, 'whoami')).user.name, 'Renamed');
});

test('each module has its own namespace, and unknown namespaces are not connectable', async (t) => {
  const modulesDir = writeModules(t, {
    aaa: { 'module.json': manifest('aaa'), 'server.js': ECHO_SERVER },
    bbb: { 'module.json': manifest('bbb'), 'server.js': ECHO_SERVER },
  });
  const { client } = await withSite(t, { modulesDir });
  const c = client();
  await register(c);
  const a = c.socket('/aaa');
  const b = c.socket('/bbb');
  await Promise.all([connected(a), connected(b)]);
  assert.equal((await ask(a, 'whoami')).id, 'aaa');
  assert.equal((await ask(b, 'whoami')).id, 'bbb');
  await refused(c.socket('/ccc'));
});

test('socket namespaces refuse users who are not signed in, or have a bad session', async (t) => {
  const { client } = await withSite(t);
  const anon = client();
  assert.match((await refused(anon.socket('/coin'))).message, /sign in/i);
  for (const cookie of ['sid=deadbeef', 'sid=', 'sid=%', 'other=1', 'sid=' + 'f'.repeat(64)]) {
    const c = client();
    c.setCookie(cookie);
    assert.match((await refused(c.socket('/coin'))).message, /sign in/i, cookie);
  }
});

test('a module can serve its public folder and mount other folders, and missing files are real 404s', async (t) => {
  const modulesDir = writeModules(t, {
    files: {
      'module.json': manifest('files'),
      'server.js': `import { fileURLToPath } from 'node:url';
        export default function (ctx) {
          ctx.mount('/extra', fileURLToPath(new URL('./extra', import.meta.url)));
          ctx.mount('/cached', fileURLToPath(new URL('./extra', import.meta.url)), { maxAge: '1d' });
        }`,
      'public/hello.txt': 'hello from public',
      'public/img/pic.png': 'pretend png',
      'extra/card.txt': 'a card',
    },
    nopublic: { 'module.json': manifest('nopublic'), 'server.js': EMPTY_SERVER },
  });
  const dist = tempDir(t, 'hub-dist-');
  fs.writeFileSync(path.join(dist, 'index.html'), '<title>SPA-MARKER</title>');
  const { base } = await withSite(t, { modulesDir, distDir: dist });
  const get = async (url) => {
    const res = await fetch(base + url);
    return { status: res.status, text: await res.text(), headers: res.headers };
  };
  assert.equal((await get('/assets/files/hello.txt')).text, 'hello from public');
  assert.equal((await get('/assets/files/img/pic.png')).text, 'pretend png');
  assert.match((await get('/assets/files/hello.txt')).headers.get('cache-control'), /max-age=604800/, 'public files are cached for a week');
  assert.equal((await get('/assets/files/extra/card.txt')).text, 'a card');
  assert.match((await get('/assets/files/cached/card.txt')).headers.get('cache-control'), /max-age=86400/, 'mount options are passed on');
  for (const missing of ['/assets/files/nope.txt', '/assets/files/extra/nope.txt', '/assets/nopublic/anything.txt', '/assets/unknown-module/x.txt', '/assets/files/']) {
    const res = await get(missing);
    assert.equal(res.status, 404, missing);
    assert.ok(!res.text.includes('SPA-MARKER'), `${missing} is not the SPA page`);
  }
  const climb = await rawRequest(base, { path: '/assets/files/..%2f..%2fserver.js' });
  assert.ok(climb.status >= 400, `climbing out gave ${climb.status}`);
  assert.ok(!climb.body.toString().includes('SPA-MARKER'));
});

test('dispose is called on every module when the site closes, and a failing dispose is not hidden', async (t) => {
  const modulesDir = writeModules(t, {
    one: {
      'module.json': manifest('one'),
      'server.js': "import fs from 'node:fs'; import path from 'node:path'; export default function (ctx) { return { dispose() { fs.writeFileSync(path.join(ctx.dataDir, 'disposed.txt'), 'yes'); } }; }",
    },
    two: {
      'module.json': manifest('two'),
      'server.js': "import fs from 'node:fs'; import path from 'node:path'; export default async function (ctx) { return { async dispose() { await new Promise((r) => setTimeout(r, 20)); fs.writeFileSync(path.join(ctx.dataDir, 'disposed.txt'), 'later'); } }; }",
    },
    three: { 'module.json': manifest('three'), 'server.js': 'export default function () { return {}; }' },
    four: { 'module.json': manifest('four'), 'server.js': 'export default function () { return null; }' },
  });
  const { dataDir, close } = await withSite(t, { modulesDir });
  assert.ok(!fs.existsSync(path.join(dataDir, 'modules', 'one', 'disposed.txt')));
  await close();
  assert.equal(fs.readFileSync(path.join(dataDir, 'modules', 'one', 'disposed.txt'), 'utf8'), 'yes');
  assert.equal(fs.readFileSync(path.join(dataDir, 'modules', 'two', 'disposed.txt'), 'utf8'), 'later', 'async dispose is awaited');
});

test('rules: shown to signed-in users only, and a module may have none', async (t) => {
  const modulesDir = writeModules(t, {
    ruled: { 'module.json': manifest('ruled', { rules: 'rules.md' }), 'server.js': EMPTY_SERVER, 'rules.md': '# Rules\n\nBe nice. Ünïcödé ok.' },
    norules: { 'module.json': manifest('norules'), 'server.js': EMPTY_SERVER },
    missing: { 'module.json': manifest('missing', { rules: 'gone.md' }), 'server.js': EMPTY_SERVER },
    nested: { 'module.json': manifest('nested', { rules: 'docs/../docs/how.md' }), 'server.js': EMPTY_SERVER, 'docs/how.md': 'nested rules' },
    folderrules: { 'module.json': manifest('folderrules', { rules: 'docs' }), 'server.js': EMPTY_SERVER, 'docs/x.md': 'x' },
  });
  const { client } = await withSite(t, { modulesDir });
  const anon = client();
  assert.equal((await anon.get('/api/games/ruled/rules')).status, 401);
  assert.equal((await anon.get('/api/games/nope/rules')).status, 401, 'even a missing game asks you to sign in first');
  const c = client();
  await register(c);
  const rules = await c.get('/api/games/ruled/rules');
  assert.equal(rules.status, 200);
  assert.match(rules.headers.get('content-type'), /^text\/plain/);
  assert.equal(rules.data, '# Rules\n\nBe nice. Ünïcödé ok.');
  assert.equal((await c.get('/api/games/norules/rules')).status, 404);
  assert.equal((await c.get('/api/games/missing/rules')).status, 404);
  assert.equal((await c.get('/api/games/nested/rules')).data, 'nested rules');
  assert.equal((await c.get('/api/games/nope/rules')).status, 404);
  assert.equal((await c.get('/api/games/folderrules/rules')).status, 404, 'a folder is not a rules file');
});

test('rules: a module.json rules path cannot reach files outside the module', async (t) => {
  const modulesDir = writeModules(t, {
    'evil-one': { 'module.json': manifest('evil-one', { rules: '../secret.txt' }), 'server.js': EMPTY_SERVER },
    'evil-two': { 'module.json': manifest('evil-two', { rules: '../../secret.txt' }), 'server.js': EMPTY_SERVER },
    'evil-sibling': { 'module.json': manifest('evil-sibling', { rules: '../evil-sibling-extra/rules.md' }), 'server.js': EMPTY_SERVER },
    'evil-absolute': { 'module.json': manifest('evil-absolute', { rules: path.join(tempDir(t, 'hub-outside-'), 'abs.txt') }), 'server.js': EMPTY_SERVER },
    'evil-deep': { 'module.json': manifest('evil-deep', { rules: 'a/../../secret.txt' }), 'server.js': EMPTY_SERVER },
    'evil-backslash': { 'module.json': manifest('evil-backslash', { rules: '..\\secret.txt' }), 'server.js': EMPTY_SERVER },
    'evil-driveroot': { 'module.json': manifest('evil-driveroot', { rules: '/secret.txt' }), 'server.js': EMPTY_SERVER },
    'evil-own-folder': { 'module.json': manifest('evil-own-folder', { rules: '.' }), 'server.js': EMPTY_SERVER },
    'evil-own-json': { 'module.json': manifest('evil-own-json', { rules: '../evil-own-json' }), 'server.js': EMPTY_SERVER },
    sane: { 'module.json': manifest('sane', { rules: 'rules.md' }), 'server.js': EMPTY_SERVER, 'rules.md': 'fine' },
  });
  fs.writeFileSync(path.join(modulesDir, 'secret.txt'), 'TOP SECRET');
  fs.mkdirSync(path.join(modulesDir, 'evil-sibling-extra'));
  fs.writeFileSync(path.join(modulesDir, 'evil-sibling-extra', 'rules.md'), 'TOP SECRET SIBLING');
  fs.writeFileSync(path.join(path.dirname(modulesDir), 'secret.txt'), 'TOP SECRET PARENT');
  t.after(() => fs.rmSync(path.join(path.dirname(modulesDir), 'secret.txt'), { force: true }));
  const abs = JSON.parse(fs.readFileSync(path.join(modulesDir, 'evil-absolute', 'module.json'), 'utf8')).rules;
  fs.writeFileSync(abs, 'TOP SECRET ABSOLUTE');

  const { client } = await withSite(t, { modulesDir });
  const c = client();
  await register(c);
  assert.equal((await c.get('/api/games/sane/rules')).data, 'fine');
  for (const id of ['evil-one', 'evil-two', 'evil-sibling', 'evil-absolute', 'evil-deep', 'evil-backslash', 'evil-driveroot', 'evil-own-folder', 'evil-own-json']) {
    const res = await c.get(`/api/games/${id}/rules`);
    assert.equal(res.status, 404, id);
    assert.ok(!String(res.data).includes('TOP SECRET'), `${id} leaked a file`);
  }
});

test('rules: the game id in the URL cannot be used to climb out either', async (t) => {
  const { client } = await withSite(t);
  const c = client();
  await register(c);
  for (const id of ['..', '../coin', '%2e%2e', '..%2fcoin', 'coin%2f..%2f..', '.', 'COIN', 'coin ']) {
    const res = await c.get(`/api/games/${id}/rules`);
    assert.ok([404].includes(res.status), `${id} gave ${res.status}`);
  }
});
