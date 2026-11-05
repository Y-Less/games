// The leaderboard page's data: GET /api/leaderboard, which carries the top players of every game with enough in it
// for the page to sort itself (server/stats.js standings).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, connected, manifest, register, withSite, writeModules } from './fixtures/testkit.js';

// A game whose players can record whatever result they are told to, so a test can build a table by hand.
const SERVER = `export default function (ctx) {
  ctx.io.on('connection', (socket) => {
    socket.on('result', (payload, ack) => {
      ctx.stats.record({ players: [{ userId: socket.data.user.id, outcome: payload.outcome, score: payload.score, extras: {} }] });
      ack({ ok: true });
    });
  });
}`;

/**
 * A site with two games and however many accounts are asked for, each with a socket on each game.
 * @returns {{ site: object, people: Record<string, { client: object, id: number, play: Function }> }}
 */
async function site(t, names) {
  const modulesDir = writeModules(t, {
    coin: { 'module.json': manifest('coin', { name: 'Coin' }), 'server.js': SERVER },
    dice: { 'module.json': manifest('dice', { name: 'Dice' }), 'server.js': SERVER },
  });
  const made = await withSite(t, { modulesDir });
  const people = {};
  for (const name of names) {
    const client = made.client();
    await register(client, name, `correct horse ${name}`, { displayName: name });
    const id = (await client.get('/api/me')).data.user.id;
    const sockets = {};
    const play = async (game, outcome, score) => {
      sockets[game] ??= await connected(client.socket(`/${game}`));
      assert.deepEqual(await ask(sockets[game], 'result', { outcome, score }), { ok: true });
    };
    people[name] = { client, id, play };
  }
  return { site: made, people };
}

/** The board for one game out of a leaderboard reply. */
const boardOf = (data, game) => data.games.find((g) => g.game === game);

test('the leaderboard carries one board per game, in best-score order, with every row ranked three ways', async (t) => {
  const { people } = await site(t, ['ann', 'bea', 'cyd']);
  await people.ann.play('coin', 'win', 50);
  await people.ann.play('coin', 'win', 20); // 2 of 2, best 50
  for (const [outcome, score] of [['win', 90], ['loss', 1], ['loss', 1], ['loss', 1], ['loss', 1]]) await people.bea.play('coin', outcome, score); // 1 of 5, best 90
  for (const [outcome, score] of [['win', 10], ['win', 9], ['win', 8], ['loss', 0]]) await people.cyd.play('coin', outcome, score); // 3 of 4, best 10

  const res = await people.ann.client.get('/api/leaderboard');
  assert.equal(res.status, 200);
  assert.equal(res.data.top, 10, 'the page is told how many rows make up the top of the table');
  const coin = boardOf(res.data, 'coin');
  assert.equal(coin.name, 'Coin');
  assert.deepEqual(coin.players.map((p) => p.name), ['bea', 'ann', 'cyd'], 'best score first');
  assert.deepEqual(coin.players.map((p) => p.rank.wins), [3, 2, 1], 'and the rows know the other orders too');
  assert.deepEqual(coin.players.map((p) => p.rank.played), [1, 3, 2]);
  assert.deepEqual(coin.players.find((p) => p.name === 'ann'), { userId: people.ann.id, name: 'ann', played: 2, wins: 2, bestScore: 50, rank: { bestScore: 2, wins: 2, played: 3 } });
});

test('a game nobody has finished has no board at all', async (t) => {
  const { people } = await site(t, ['ann']);
  await people.ann.play('coin', 'win', 1);
  const data = (await people.ann.client.get('/api/leaderboard')).data;
  assert.deepEqual(data.games.map((g) => g.game), ['coin'], 'and Dice, which nobody has played, is left out');
  await people.ann.play('dice', 'loss', 0);
  assert.deepEqual((await people.ann.client.get('/api/leaderboard')).data.games.map((g) => g.game).sort(), ['coin', 'dice']);
});

test('the player looking is in the table wherever they come, and others outside the top are not', async (t) => {
  const names = Array.from({ length: 13 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
  const { people } = await site(t, names);
  for (const [i, name] of names.entries()) {
    for (let w = 0; w <= i; w++) await people[name].play('coin', 'win', i + 1); // p13 wins most and scores highest
  }
  const best = names.slice().reverse().slice(0, 10);

  const fromTheTop = boardOf((await people.p13.client.get('/api/leaderboard')).data, 'coin');
  assert.deepEqual(fromTheTop.players.map((p) => p.name), best, 'ten rows for somebody already in the top ten');

  const fromBelow = boardOf((await people.p01.client.get('/api/leaderboard')).data, 'coin');
  assert.deepEqual(fromBelow.players.map((p) => p.name), [...best, 'p01'], 'and eleven for somebody who is not');
  assert.equal(fromBelow.players.at(-1).rank.bestScore, 13, 'who is told where they really stand');
  assert.equal(fromBelow.players.some((p) => p.name === 'p02'), false, 'the next one up is still left out');
});

test('signing in is needed to see a leaderboard', async (t) => {
  const { site: made } = await site(t, ['ann']);
  assert.equal((await made.client().get('/api/leaderboard')).status, 401);
});
