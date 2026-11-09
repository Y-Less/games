// The host-only, lobby-only "kick": at the rules level (game.js) and over real sockets against the real site.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as game from './game.js';
import { launchModule, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function lobby() {
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'ann' });
  game.addHuman(room, 2, 'bob');
  game.addHuman(room, 3, 'cat');
  return room;
}

test('rules: the host removes a person from a lobby seat and the seat becomes empty', () => {
  const room = lobby();
  assert.deepEqual(game.kick(room, 1, 's1', Math.random), { ok: true, userId: 2, replaced: false });
  assert.equal(room.seats[1], null);
  assert.equal(game.hasPlayer(room, 2), false);
  assert.equal(room.hostId, 1);
  assert.equal(game.hasPlayer(room, 3), true);
  assert.deepEqual(game.addHuman(room, 2, 'bob'), { ok: false, error: 'removedFromGame' }, 'and not by the one who was put out');
  assert.deepEqual(game.addHuman(room, 9, 'zoe'), { ok: true, seat: 1 }, 'though the seat is free for anybody else');
});

test('rules: only the host can kick, and never themselves', () => {
  const room = lobby();
  const before = JSON.stringify(room);
  for (const [by, seat] of [[2, 2], [3, 1], [2, 0], [99, 1], [null, 1], [undefined, 1]]) {
    const result = game.kick(room, by, `s${seat}`, Math.random);
    assert.equal(result.ok, false);
    assert.match(result.error, /host/i);
  }
  assert.equal(game.kick(room, 1, 's0', Math.random).ok, false);
  assert.equal(JSON.stringify(room), before);
});

test('rules: the host can remove a person in any phase but the last: a computer player takes the seat mid-game', () => {
  for (const phase of ['playing', 'finished']) {
    const room = lobby();
    game.fillWithBots(room, 1);
    assert.equal(game.start(room, 1, Math.random).ok, true);
    room.phase = phase;
    const before = JSON.stringify(room);
    const at = room.seats.findIndex((x) => x.id === 2); // the seats are shuffled when the game starts
    const result = game.kick(room, 1, `s${at}`, Math.random);
    if (phase === 'finished') {
      assert.equal(result.ok, false, phase);
      assert.equal(result.error, 'gameOverNobodyToRemove');
      assert.equal(JSON.stringify(room), before);
    } else {
      assert.equal(result.ok, true, phase);
      assert.equal(result.userId, 2);
      assert.equal(result.replaced, true);
      assert.equal(room.seats[at].kind, 'bot', phase);
      assert.equal(room.hostId, 1);
    }
  }
});

test('rules: a computer player, an empty seat or a nonsense seat cannot be kicked', () => {
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'ann' });
  game.addHuman(room, 2, 'bob');
  game.addBot(room, 1, 2);
  const before = JSON.stringify(room);
  // Both the slots that name nobody and the things that are not slots at all.
  for (const seat of ['s2', 's3', 's-1', 's4', 's99', 2, 3, -1, 1.5, NaN, Infinity, '1', '0', 's', 's1.5', undefined, null, {}, [], [1], true, 'bot:1', 2 ** 40]) {
    const result = game.kick(room, 1, seat, Math.random);
    assert.equal(result.ok, false, `seat ${String(seat)}`);
    assert.equal(typeof result.error, 'string');
  }
  assert.equal(JSON.stringify(room), before);
});

test('sockets: the kicked person is sent out, cannot come back, and the others are told', async (t) => {
  process.env.SPLENDOUR_BOT_DELAY = '0-2';
  const site = await launchModule(t, { id: 'splendour', moduleDir: here });
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', {});
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state?.seats.filter(Boolean).length === 3, 'three seated');
  const bobTwo = await bob.twin();
  await bobTwo.call('resume', { code });

  assert.equal((await bob.call('kick', { slot: 's2' })).ok, false, 'a guest cannot kick');
  assert.equal((await ann.call('kick', { slot: 's0' })).ok, false, 'the host cannot kick themselves');
  assert.equal((await ann.call('kick', { slot: 's3' })).ok, false, 'an empty seat');
  for (const slot of [undefined, null, -1, 1.5, '1', {}, [1], 's99', 's-1', 's']) assert.equal((await ann.call('kick', { slot })).ok, false);
  assert.equal(ann.state.seats.filter(Boolean).length, 3);

  assert.equal((await ann.call('kick', { slot: 's1' })).ok, true);
  await until(() => bob.state === null && bobTwo.state === null, 'every socket of bob sent out');
  await until(() => ann.state.seats[1] === null && cat.state.seats[1] === null, 'the others told');
  assert.equal((await bob.call('create', {})).ok, true, 'bob is not in any game now');
  await bob.call('leave');
  assert.equal((await bob.call('join', { code })).error, 'removedFromGame', 'but the code is no way back');

  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'started');
  const at = ann.state.seats.findIndex((x) => x.name === 'cat');
  assert.equal((await ann.call('kick', { slot: `s${at}` })).ok, true, 'a computer player takes over mid-game');
  await until(() => cat.state === null && ann.state.seats[at].bot === true, 'cat out, a computer in');
  const botAt = ann.state.seats.findIndex((x, i) => x.bot && i !== at);
  assert.equal((await ann.call('removeBot', { slot: `s${botAt}` })).ok, false, 'a computer player stays for the game');
});
