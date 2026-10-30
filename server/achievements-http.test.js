// Achievements through the whole site: a module declares them in its module.json, saves progress with ctx.achievements, and
// the Achievements page's API shows the result for the signed-in player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, connected, manifest, register, withSite, writeModules } from './fixtures/testkit.js';

const SERVER = `export default function (ctx) {
  ctx.io.on('connection', (socket) => {
    const id = socket.data.user.id;
    socket.on('lap', (payload, ack) => ack(ctx.achievements.add(id, 'laps', payload?.n)));
    socket.on('best', (payload, ack) => ack(ctx.achievements.raise(id, 'best', payload.value)));
    socket.on('win', (payload, ack) => {
      ctx.stats.record({ players: [{ userId: id, outcome: 'win', score: 7, extras: { jumps: 3 } }] });
      ack({ ok: true });
    });
    socket.on('cards', (payload, ack) => ack(ctx.achievements.add(id, 'global.cards', payload.n)));
    socket.on('look', (payload, ack) => ack({ games: ctx.achievements.get(id, 'global.games'), level: ctx.achievements.level(id, 'global.games') }));
    socket.on('bad', (payload, ack) => {
      try {
        ctx.achievements.add(id, payload.key);
        ack({ ok: true });
      } catch (error) {
        ack({ error: error.message });
      }
    });
  });
}`;

const PAD = manifest('pad', {
  stats: [{ key: 'jumps', label: 'Jumps' }],
  achievements: [
    { key: 'laps', name: 'Laps', text: 'Run {n} laps', levels: [2, 4] },
    { key: 'best', name: 'Best run', text: 'Run {n} metres in one go', levels: [10] },
    { key: 'tiered', name: 'Tiered', text: 'Do {n}', levels: 'veryHard' },
    { key: 'jumper', name: 'Jumper', text: 'Jump {n} times', levels: [3, 30], stat: 'jumps' },
    { key: 'broken', name: 'Broken', text: 'No levels', levels: [] },
  ],
});

async function setup(t) {
  const modulesDir = writeModules(t, { pad: { 'module.json': PAD, 'server.js': SERVER }, quiet: { 'module.json': manifest('quiet'), 'server.js': 'export default function () {}' } });
  const { client, base } = await withSite(t, { modulesDir, shopLocked: true }); // (an account that owns the whole shop has already unlocked "Customised")
  const c = client();
  await register(c, 'runner', 'password1');
  const socket = c.socket('/pad');
  await connected(socket);
  const sections = async () => (await c.get('/api/achievements')).data.sections;
  const find = async (id) => (await sections()).flatMap((s) => s.achievements).find((a) => a.id === id);
  return { c, socket, sections, find, base };
}

test('the page lists the global achievements, then the games that have some, and drops unusable definitions', async (t) => {
  const { sections } = await setup(t);
  const list = await sections();
  assert.deepEqual(list.map((s) => s.id), ['global', 'pad', 'quiet'], 'a game that defines none still has the two every game has');
  assert.deepEqual(list[1].achievements.map((a) => a.key), ['played', 'won', 'laps', 'best', 'tiered', 'jumper'], 'the played and won ones first; the one with no levels is dropped');
  assert.deepEqual(list[2].achievements.map((a) => a.key), ['played', 'won']);
  assert.deepEqual(list[1].achievements[0].levels.map((l) => l.n), [1, 10, 25, 50, 150], 'played is medium');
  assert.deepEqual(list[1].achievements[1].levels.map((l) => l.n), [1, 5, 10, 25, 50], 'won is hard');
  assert.deepEqual(list[0].achievements.map((a) => a.key), ['games', 'wins', 'cards', 'slow', 'pieces', 'spent', 'indecisive', 'customised', 'everygame']);
});

test('it needs a signed-in player', async (t) => {
  const { base } = await withSite(t, {});
  assert.equal((await fetch(`${base}/api/achievements`)).status, 401);
});

test('progress a game saves is added to, raised, and shown with its levels', async (t) => {
  const { socket, find } = await setup(t);
  assert.equal((await find('pad.laps')).level, 0);
  assert.equal((await ask(socket, 'lap', { n: 1 })).unlocked, false);
  assert.equal((await ask(socket, 'lap', { n: 1 })).unlocked, true);
  const laps = await find('pad.laps');
  assert.deepEqual([laps.value, laps.level, laps.next.n, laps.progress], [2, 1, 4, 0.5]);
  assert.equal((await ask(socket, 'best', { value: 25 })).level, 1);
  await ask(socket, 'best', { value: 5 });
  assert.equal((await find('pad.best')).value, 25, 'raise keeps the best');
  assert.equal((await find('pad.best')).next, null);
});

test('an achievement with a stat is worked out from the recorded results', async (t) => {
  const { socket, find } = await setup(t);
  assert.equal((await find('pad.jumper')).value, 0);
  await ask(socket, 'win');
  assert.deepEqual([(await find('pad.jumper')).value, (await find('pad.jumper')).level], [3, 1]);
  assert.equal((await find('global.games')).value, 1, 'played games is counted from the results');
  assert.equal((await find('global.wins')).value, 1);
  assert.deepEqual([(await find('pad.played')).value, (await find('pad.won')).level], [1, 1], 'the standard played and won achievements count too');
  const reply = await ask(socket, 'bad', { key: 'jumper' });
  assert.match(reply.error, /cannot be set/);
});

test('a module can add to the global played cards and look at the global achievements', async (t) => {
  const { socket, find } = await setup(t);
  await ask(socket, 'cards', { n: 150 });
  const cards = await find('global.cards');
  assert.deepEqual([cards.value, cards.level, cards.next.n], [150, 1, 1000]);
  await ask(socket, 'win');
  assert.deepEqual(await ask(socket, 'look'), { games: 1, level: 1 }, 'one game: the first level of played games (1)');
  assert.match((await ask(socket, 'bad', { key: 'nope' })).error, /Unknown achievement/);
});

const balanceOf = async (c) => (await c.get('/api/shop')).data.balance;

test('unlocking a level pays 200 times its number, and the unlock is waiting until it has been shown', async (t) => {
  const { c, socket, find } = await setup(t);
  const before = await balanceOf(c);
  await ask(socket, 'lap', { n: 2 });
  assert.equal((await balanceOf(c)) - before, 200, 'laps level 1 of 2');
  const pending = (await c.get('/api/achievements/pending')).data.unlocks;
  assert.deepEqual(pending, [{ id: 'pad.laps', level: 1, levels: 2, game: 'PAD', name: 'Laps', text: 'Run 2 laps', coins: 200 }]);
  assert.equal((await find('pad.laps')).level, 1);
  assert.equal((await c.get('/api/achievements/pending')).data.unlocks.length, 1, 'still waiting: it has not been shown');
  assert.equal((await c.post('/api/achievements/seen', { items: [{ id: 'pad.laps', level: 1 }] })).status, 200);
  assert.deepEqual((await c.get('/api/achievements/pending')).data.unlocks, []);
  assert.equal((await balanceOf(c)) - before, 200, 'seeing it pays nothing more');
});

test('a finished game pays what it unlocked, and the page and the pending list settle levels that were earned earlier', async (t) => {
  const { c, socket } = await setup(t);
  const before = await balanceOf(c);
  await ask(socket, 'win'); // played and won level 1, global games and wins level 1, jumper level 1 (3 jumps) and the placement prize; played and global games start at 1 now
  const unlocks = (await c.get('/api/achievements/pending')).data.unlocks.map((u) => `${u.id}:${u.level}`).sort();
  for (const id of ['pad.played:1', 'pad.won:1', 'global.games:1', 'global.wins:1', 'pad.jumper:1']) assert.ok(unlocks.includes(id), id);
  const coins = (await c.get('/api/achievements/pending')).data.unlocks.reduce((sum, u) => sum + u.coins, 0);
  assert.equal((await balanceOf(c)) - before, 500 + coins, 'the first-place prize and each unlocked level');
});

test('the site socket tells a player when there is something to show, and refuses a stranger', async (t) => {
  const { c, socket, base } = await setup(t);
  const site = c.socket('/');
  await connected(site);
  const told = new Promise((resolve) => site.once('achievements', resolve));
  await ask(socket, 'lap', { n: 2 });
  await told;
  const { io } = await import('socket.io-client');
  const stranger = io(base, { reconnection: false });
  await new Promise((resolve) => stranger.once('connect_error', resolve));
  stranger.close();
});
