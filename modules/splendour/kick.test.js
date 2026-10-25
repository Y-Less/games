// The host-only, lobby-only "kick": at the rules level (game.js) and over real sockets against the real site.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as game from './game.js';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function lobby() {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  game.addHuman(room, 2, 'bob');
  game.addHuman(room, 3, 'cat');
  return room;
}

test('rules: the host removes a person from a lobby seat and the seat becomes empty', () => {
  const room = lobby();
  assert.deepEqual(game.kick(room, 1, 1), { ok: true, userId: 2 });
  assert.equal(room.seats[1], null);
  assert.equal(game.hasPlayer(room, 2), false);
  assert.equal(room.hostId, 1);
  assert.equal(game.hasPlayer(room, 3), true);
  assert.deepEqual(game.addHuman(room, 2, 'bob'), { ok: true, seat: 1 });
});

test('rules: only the host can kick, and never themselves', () => {
  const room = lobby();
  const before = JSON.stringify(room);
  for (const [by, seat] of [[2, 2], [3, 1], [2, 0], [99, 1], [null, 1], [undefined, 1]]) {
    const result = game.kick(room, by, seat);
    assert.equal(result.ok, false);
    assert.match(result.error, /host/i);
  }
  assert.equal(game.kick(room, 1, 0).ok, false);
  assert.equal(JSON.stringify(room), before);
});

test('rules: kicking is refused once the game has started or finished', () => {
  for (const phase of ['playing', 'finished']) {
    const room = lobby();
    game.fillWithBots(room, 1);
    game.start(room, 1);
    room.phase = phase;
    const before = JSON.stringify(room);
    const result = game.kick(room, 1, 1);
    assert.equal(result.ok, false, phase);
    assert.match(result.error, /before the game starts/);
    assert.equal(JSON.stringify(room), before);
  }
});

test('rules: a computer player, an empty seat or a nonsense seat cannot be kicked', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  game.addHuman(room, 2, 'bob');
  game.addBot(room, 1, 2);
  const before = JSON.stringify(room);
  for (const seat of [2, 3, -1, 4, 99, 1.5, NaN, Infinity, '1', '0', undefined, null, {}, [], [1], true, 'bot:1', 2 ** 40]) {
    const result = game.kick(room, 1, seat);
    assert.equal(result.ok, false, `seat ${String(seat)}`);
    assert.equal(typeof result.error, 'string');
  }
  assert.equal(JSON.stringify(room), before);
});

test('sockets: the kicked person is sent out, can rejoin, and the others are told', async (t) => {
  process.env.SPLENDOUR_BOT_DELAY = '0-2';
  const site = await launchModule(t, { id: 'splendour', moduleDir: here });
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', {});
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state?.seats.filter(Boolean).length === 3, 'three seated');
  const bobTwo = await bob.twin();
  await bobTwo.call('resume', { code });

  assert.equal((await bob.call('kick', { seat: 2 })).ok, false, 'a guest cannot kick');
  assert.equal((await ann.call('kick', { seat: 0 })).ok, false, 'the host cannot kick themselves');
  assert.equal((await ann.call('kick', { seat: 3 })).ok, false, 'an empty seat');
  for (const seat of [undefined, null, -1, 1.5, '1', {}, [1], 99]) assert.equal((await ann.call('kick', { seat })).ok, false);
  assert.equal(ann.state.seats.filter(Boolean).length, 3);

  assert.equal((await ann.call('kick', { seat: 1 })).ok, true);
  await until(() => bob.state === null && bobTwo.state === null, 'every socket of bob sent out');
  await until(() => ann.state.seats[1] === null && cat.state.seats[1] === null, 'the others told');
  assert.equal((await bob.call('create', {})).ok, true, 'bob is not in any game now');
  await bob.call('leave');
  assert.equal((await bob.call('join', { code })).ok, true, 'and may rejoin');
  await until(() => ann.state.seats[1]?.name === 'bob', 'bob back');

  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'started');
  const at = ann.state.seats.findIndex((x) => x.name === 'bob');
  assert.equal((await ann.call('kick', { seat: at })).ok, false, 'not after the start');
  assert.equal(ann.state.seats[at].name, 'bob');
});
