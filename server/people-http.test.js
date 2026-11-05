// Looking at somebody else's pages: /api/stats/user/<who> and /api/achievements/user/<who>, where <who> is the name
// they sign in with or their account id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, connected, manifest, register, withSite, writeModules } from './fixtures/testkit.js';

const SERVER = `export default function (ctx) {
  ctx.io.on('connection', (socket) => {
    socket.on('win', (payload, ack) => {
      ctx.stats.record({ players: [{ userId: socket.data.user.id, outcome: 'win', score: 9, extras: {} }] });
      ack({ ok: true });
    });
  });
}`;

/** A site with one game, and two accounts: Tom, who has played, and Ann, who is looking. */
async function twoPlayers(t) {
  const modulesDir = writeModules(t, { coin: { 'module.json': manifest('coin', { name: 'Coin' }), 'server.js': SERVER } });
  const site = await withSite(t, { modulesDir });
  const tom = site.client();
  await register(tom, 'tom', 'correct horse tom', { displayName: 'Tom Thumb' });
  const tomSocket = await connected(tom.socket('/coin'));
  assert.deepEqual(await ask(tomSocket, 'win'), { ok: true });
  const tomId = (await tom.get('/api/me')).data.user.id;
  const ann = site.client();
  await register(ann, 'ann', 'correct horse ann', { displayName: 'Ann' });
  return { site, ann, tom, tomId };
}

test("another player's statistics are found by name and by id, and say whose they are", async (t) => {
  const { ann, tomId } = await twoPlayers(t);
  for (const who of ['tom', 'Tom', 'TOM', String(tomId)]) {
    const res = await ann.get(`/api/stats/user/${who}`);
    assert.equal(res.status, 200, `looked up by ${who}`);
    assert.deepEqual(res.data.who, { id: tomId, username: 'tom', displayName: 'Tom Thumb' }, `looked up by ${who}`);
    assert.equal(res.data.summary.played, 1);
    assert.equal(res.data.perGame[0].game, 'coin');
  }
});

test("another player's achievements are found the same way", async (t) => {
  const { ann, tomId } = await twoPlayers(t);
  const res = await ann.get(`/api/achievements/user/${tomId}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.who.displayName, 'Tom Thumb');
  const coin = res.data.sections.find((s) => s.id === 'coin');
  assert.ok(coin, 'the game he played has a section');
  assert.ok(coin.achievements.some((a) => a.key === 'played' && a.value === 1), 'and his one game is counted in it');
});

test('a name nobody has is a 404, not somebody else', async (t) => {
  const { ann } = await twoPlayers(t);
  for (const who of ['nobody', '999999', '0', '-1', 'tom%20thumb', 'Tom%20Thumb']) {
    for (const page of ['stats', 'achievements']) {
      const res = await ann.get(`/api/${page}/user/${who}`);
      assert.equal(res.status, 404, `${page}/${who}`);
      assert.equal(res.data.error, 'noSuchPlayer', `${page}/${who}`);
    }
  }
});

test('looking at somebody else leaves their account alone: nothing is settled and nothing is paid', async (t) => {
  const { site, ann, tom, tomId } = await twoPlayers(t);
  const before = (await tom.get('/api/shop')).data.balance;
  await ann.get(`/api/achievements/user/${tomId}`);
  await ann.get(`/api/stats/user/${tomId}`);
  assert.equal((await tom.get('/api/shop')).data.balance, before, 'his purse is untouched');
  assert.ok(site, 'the site is still up');
});

test('your own time on the site is yours: it is not in what somebody else is shown', async (t) => {
  const { ann, tomId } = await twoPlayers(t);
  const mine = await ann.get('/api/stats/me');
  assert.ok('onlineSeconds' in mine.data.summary, 'your own page has it');
  const theirs = await ann.get(`/api/stats/user/${tomId}`);
  assert.equal('onlineSeconds' in theirs.data.summary, false, "somebody else's does not");
});

test('signing in is still needed to look anybody up', async (t) => {
  const { site, tomId } = await twoPlayers(t);
  const stranger = site.client();
  for (const page of ['stats', 'achievements']) {
    assert.equal((await stranger.get(`/api/${page}/user/${tomId}`)).status, 401, page);
  }
});
