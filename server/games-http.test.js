// The game routes over real HTTP (server/routes/games.js): /api/config, which tells the browser the games and the
// presets it may offer, and /api/games/:id/rules with its ?lang=, which had no test at this level.  What is protected:
// a translation of the rules is preferred when there is one, the original is what everybody else gets, and a `lang`
// that is not a language tag can never be used to name some other file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_SERVER, manifest, rawRequest, register, withSite, writeModules } from './fixtures/testkit.js';
import { BACKGROUND_PRESETS, CARD_BACK_PRESETS } from './profileSettings.js';

const ORIGINAL = '# Rules\n\nThe original.';
const FRENCH = '# Règles\n\nEn français.';
const BRAZILIAN = '# Regras\n\nEm português do Brasil.';

/** A site with a game whose rules have two translations, one with none, and a signed-in client. */
async function ruledSite(t) {
  const modulesDir = writeModules(t, {
    ruled: {
      'module.json': manifest('ruled', { rules: 'rules.md' }),
      'server.js': EMPTY_SERVER,
      'rules.md': ORIGINAL,
      'rules.fr.md': FRENCH,
      'rules.pt-BR.md': BRAZILIAN,
      // Files a careless join of `lang` into the path could reach.
      'secret.md': 'SECRET-IN-MODULE',
      'rules.md.bak': 'SECRET-BACKUP',
    },
    plain: { 'module.json': manifest('plain', { rules: 'rules.md' }), 'server.js': EMPTY_SERVER, 'rules.md': 'Only the original.' },
    'secret.md': { 'x.md': 'SECRET-OUTSIDE' },
  });
  const made = await withSite(t, { modulesDir });
  const c = made.client();
  await register(c);
  return { ...made, c };
}

test('rules: a translation is preferred when there is one for the language asked for', async (t) => {
  const { c } = await ruledSite(t);
  const french = await c.get('/api/games/ruled/rules?lang=fr');
  assert.equal(french.status, 200);
  assert.match(french.headers.get('content-type'), /^text\/plain/);
  assert.equal(french.data, FRENCH);
  assert.equal((await c.get('/api/games/ruled/rules?lang=pt-BR')).data, BRAZILIAN, 'a tag with a region names its own file');
});

test('rules: no language, or one with no translation, gets the original', async (t) => {
  const { c } = await ruledSite(t);
  for (const query of ['', '?lang=', '?lang=de', '?lang=pt', '?lang=pt-PT', '?other=fr']) {
    const res = await c.get(`/api/games/ruled/rules${query}`);
    assert.equal(res.status, 200, query);
    assert.equal(res.data, ORIGINAL, query);
  }
  assert.equal((await c.get('/api/games/plain/rules?lang=fr')).data, 'Only the original.', 'a game with no translations at all');
});

test('rules: a lang that is not a language tag is ignored, and cannot be used to name another file', async (t) => {
  const { c, base } = await ruledSite(t);
  const cookie = c.cookie();
  const langs = [
    '..', '../secret', '..%2Fsecret', '..%5Csecret', '/secret', 'fr/../../secret', 'fr%2F..%2F..%2Fsecret', '.', 'bak', 'md.bak', 'fr.md',
    'fr%00', '%00', 'FR', 'f', 'french-language-of-france', 'fr-', '-fr', 'fr_FR', '%20fr', 'fr%20', 'fr+', '*', '__proto__', 'constructor',
  ];
  for (const lang of langs) {
    // Sent raw, so that nothing between the test and the server tidies the address first.
    const res = await rawRequest(base, { path: `/api/games/ruled/rules?lang=${lang}`, headers: { cookie } });
    const text = res.body.toString();
    assert.equal(res.status, 200, `lang=${lang}`);
    assert.equal(text, ORIGINAL, `lang=${lang}`);
  }
  // A repeated or structured `lang` is not one language either, and nor is one that cannot be decoded.  Which rules
  // these get is left open; that they get no other file, and that the server does not fall over, is not.
  for (const query of ['lang=fr&lang=de', 'lang=fr&lang=fr', 'lang[]=fr', 'lang[a]=fr', 'lang=%', 'lang=%E0%A4%A']) {
    const res = await rawRequest(base, { path: `/api/games/ruled/rules?${query}`, headers: { cookie } });
    assert.ok(res.status < 500, `${query} gave ${res.status}`);
    assert.ok(!res.body.toString().includes('SECRET'), query);
  }
});

test('rules: a translation is no more public than the original, and a game that is not there has neither', async (t) => {
  const { c, client } = await ruledSite(t);
  const stranger = await client().get('/api/games/ruled/rules?lang=fr');
  assert.equal(stranger.status, 401);
  assert.deepEqual(stranger.data, { error: 'signIn' });
  for (const id of ['nope', 'secret.md', '__proto__', 'constructor', 'RULED']) {
    const res = await c.get(`/api/games/${id}/rules?lang=fr`);
    assert.equal(res.status, 404, id);
    assert.deepEqual(res.data, { error: 'noRules' }, id);
  }
});

test('config: anybody may read it, and it carries exactly the presets the server will accept', async (t) => {
  const { client, c } = await ruledSite(t);
  const stranger = await client().get('/api/config');
  assert.equal(stranger.status, 200, 'the sign-in page needs it before anybody is signed in');
  assert.deepEqual(stranger.data.backgrounds, BACKGROUND_PRESETS);
  assert.deepEqual(stranger.data.cardBacks, CARD_BACK_PRESETS);
  assert.deepEqual(stranger.data.games.map((g) => g.id).sort(), ['plain', 'ruled'], 'the games that loaded, and only those');
  assert.deepEqual((await c.get('/api/config')).data, stranger.data, 'signed in or not, it is the same');
});

/** A module that answers with one game of the given vintage, as a room-based game's server half does. */
const roomServer = (code, updatedAt) =>
  `export default function () {
  return { gamesOf: () => [{ kind: 'game', code: '${code}', others: ['Bob'], updatedAt: ${updatedAt} }] };
}`;

test('my games: every module is asked, each row says which game it is, and the newest news comes first', async (t) => {
  // The list is what somebody picks a game up through, days after they set it aside, so it is gathered across the
  // whole site rather than belonging to any one game.
  const modulesDir = writeModules(t, {
    older: { 'module.json': manifest('older', { name: 'Older Game' }), 'server.js': roomServer('aaa-bbb-ccc', 10) },
    newer: { 'module.json': manifest('newer', { name: 'Newer Game' }), 'server.js': roomServer('ddd-eee-fff', 20) },
    quiet: { 'module.json': manifest('quiet'), 'server.js': EMPTY_SERVER },
  });
  const made = await withSite(t, { modulesDir });
  const c = made.client();
  await register(c);

  const res = await c.get('/api/my/games');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.games.map((row) => row.code), ['ddd-eee-fff', 'aaa-bbb-ccc'], 'the newest first');
  assert.deepEqual(res.data.games.map((row) => row.game), ['newer', 'older'], 'each knows the game it belongs to');
  assert.equal(res.data.games[0].name, 'Newer Game', 'and names it, for a site that has not loaded the menu yet');
  assert.deepEqual(res.data.games[0].others, ['Bob'], 'with who else is at it');
  // A module with no rooms at all is simply not in the answer, rather than an error.
  assert.equal(res.data.games.some((row) => row.game === 'quiet'), false);
  assert.equal((await made.client().get('/api/my/games')).status, 401, 'and it is nobody else\'s business');
});

test('my games: a module that will not answer is left out and the others are still listed', async (t) => {
  const modulesDir = writeModules(t, {
    cross: { 'module.json': manifest('cross'), 'server.js': 'export default function () {\n  return { gamesOf: () => { throw new Error(\'no\'); } };\n}' },
    calm: { 'module.json': manifest('calm'), 'server.js': roomServer('aaa-bbb-ccc', 10) },
  });
  const made = await withSite(t, { modulesDir });
  const c = made.client();
  await register(c);

  const res = await c.get('/api/my/games');
  assert.equal(res.status, 200, 'one module throwing does not take the page down');
  assert.deepEqual(res.data.games.map((row) => row.game), ['calm']);
});
