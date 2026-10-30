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
    { key: 'jumper', name: 'Jumper', text: 'Jump {n} times', levels: [3, 30], stat: 'jumps' },
    { key: 'broken', name: 'Broken', text: 'No levels', levels: [] },
  ],
});

async function setup(t) {
  const modulesDir = writeModules(t, { pad: { 'module.json': PAD, 'server.js': SERVER }, quiet: { 'module.json': manifest('quiet'), 'server.js': 'export default function () {}' } });
  const { client } = await withSite(t, { modulesDir });
  const c = client();
  await register(c, 'runner', 'password1');
  const socket = c.socket('/pad');
  await connected(socket);
  const sections = async () => (await c.get('/api/achievements')).data.sections;
  const find = async (id) => (await sections()).flatMap((s) => s.achievements).find((a) => a.id === id);
  return { c, socket, sections, find };
}

test('the page lists the global achievements, then the games that have some, and drops unusable definitions', async (t) => {
  const { sections } = await setup(t);
  const list = await sections();
  assert.deepEqual(list.map((s) => s.id), ['global', 'pad'], 'a game with none is left out');
  assert.deepEqual(list[1].achievements.map((a) => a.key), ['laps', 'best', 'jumper'], 'the one with no levels is dropped');
  assert.deepEqual(list[0].achievements.map((a) => a.key), ['games', 'wins', 'cards']);
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
  const reply = await ask(socket, 'bad', { key: 'jumper' });
  assert.match(reply.error, /cannot be set/);
});

test('a module can add to the global played cards and look at the global achievements', async (t) => {
  const { socket, find } = await setup(t);
  await ask(socket, 'cards', { n: 150 });
  const cards = await find('global.cards');
  assert.deepEqual([cards.value, cards.level, cards.next.n], [150, 1, 500]);
  await ask(socket, 'win');
  assert.deepEqual(await ask(socket, 'look'), { games: 1, level: 0 });
  assert.match((await ask(socket, 'bad', { key: 'nope' })).error, /Unknown achievement/);
});
