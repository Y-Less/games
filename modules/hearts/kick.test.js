// The host-only, lobby-only "kick": at the rules level (game.js) and over real sockets against the real site.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as game from './game.js';
import { launchModule, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const snapshot = (room) => JSON.stringify(room);

function lobby() {
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: game.DEFAULT_SEATS } });
  game.addHuman(room, 2, 'bob');
  game.addHuman(room, 3, 'cat');
  return room;
}

test('rules: the host removes a person from a lobby seat and the seat becomes empty', () => {
  const room = lobby();
  const result = game.kick(room, 1, 's1', Math.random);
  assert.deepEqual(result, { ok: true, userId: 2, replaced: false });
  assert.equal(room.seats[1], null);
  assert.equal(game.hasPlayer(room, 2), false);
  assert.equal(room.hostId, 1, 'the host is unchanged');
  assert.equal(game.hasPlayer(room, 3), true, 'the others stay');
  // The seat can be filled again, but not by the person who was put out of it.
  assert.deepEqual(game.addHuman(room, 2, 'bob'), { ok: false, error: 'removedFromGame' });
  assert.deepEqual(game.addHuman(room, 9, 'zoe'), { ok: true, seat: 1 });
  assert.equal(room.seats[1].id, 9);
});

test('rules: only the host can kick, and never themselves', () => {
  const room = lobby();
  const before = snapshot(room);
  for (const [by, seat] of [[2, 2], [3, 1], [2, 0], [99, 1], [null, 1], [undefined, 1]]) {
    const result = game.kick(room, by, `s${seat}`, Math.random);
    assert.equal(result.ok, false, `${by} kicking seat ${seat}`);
    assert.match(result.error, /host/i);
  }
  const self = game.kick(room, 1, 's0', Math.random);
  assert.equal(self.ok, false);
  assert.ok(self.error);
  assert.equal(snapshot(room), before, 'nothing changed');
});

test('rules: the host can remove a person in any phase but the last: a computer player takes the seat mid-game', () => {
  for (const phase of ['passing', 'playing', 'handEnd', 'finished']) {
    const room = lobby();
    game.fillWithBots(room, 1, room.seats.length);
    assert.equal(game.start(room, 1, Math.random).ok, true);
    room.phase = phase;
    const before = snapshot(room);
    const result = game.kick(room, 1, 's1', Math.random);
    if (phase === 'finished') {
      assert.equal(result.ok, false, phase);
      assert.equal(result.error, 'gameOverNobodyToRemove');
      assert.equal(snapshot(room), before);
    } else {
      assert.equal(result.ok, true, phase);
      assert.equal(result.userId, 2);
      assert.equal(result.replaced, true);
      assert.equal(room.seats[1].kind, 'bot', phase);
      assert.equal(room.hostId, 1);
    }
  }
});

test('rules: a computer player, an empty seat or a nonsense seat cannot be kicked', () => {
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'ann', settings: { seats: game.DEFAULT_SEATS } });
  game.addHuman(room, 2, 'bob');
  game.addBot(room, 1, 2);
  const before = snapshot(room);
  // Both the slots that name nobody and the things that are not slots at all.
  for (const seat of ['s2', 's3', 's-1', 's4', 's99', 2, 3, -1, 1.5, NaN, Infinity, '1', '0', 's', 's1.5', undefined, null, {}, [], [1], true, 'bot:1', 2 ** 40]) {
    const result = game.kick(room, 1, seat, Math.random);
    assert.equal(result.ok, false, `seat ${String(seat)}`);
    assert.equal(typeof result.error, 'string');
  }
  assert.equal(snapshot(room), before, 'no seat was touched');
  assert.equal(room.seats[2].kind, 'bot');
});

test('rules: the kick result names the person so the server can send them home', () => {
  const room = lobby();
  assert.equal(game.kick(room, 1, 's2', Math.random).userId, 3);
  assert.equal(game.kick(room, 1, 's2', Math.random).ok, false, 'the seat is already empty');
  assert.equal(game.humanSeats(room).length, 2);
});

test('sockets: the host removes a person; they return to the entry screen, and the code is no way back', async (t) => {
  process.env.HEARTS_BOT_DELAY = '0-3';
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const created = await ann.call('create', {});
  assert.equal(created.ok, true);
  const code = created.code;
  assert.equal((await bob.call('join', { code })).ok, true);
  assert.equal((await cat.call('join', { code })).ok, true);
  await until(() => ann.state?.seats.filter(Boolean).length === 3, 'three people');
  const bobsSecondTab = await bob.twin();
  assert.equal((await bobsSecondTab.call('resume', { code })).ok, true);
  await until(() => bobsSecondTab.state?.you === 1, 'the second tab to be seated');

  assert.deepEqual(await cat.call('kick', { slot: 's1' }), { ok: false, error: 'hostOnly' });
  assert.equal(ann.state.seats[1].name, 'bob', 'a non-host cannot remove anyone');

  assert.deepEqual(await ann.call('kick', { slot: 's1' }), { ok: true });
  await until(() => bob.state === null && bobsSecondTab.state === null, 'both of bob\'s tabs to be sent to the entry screen');
  await until(() => ann.state.seats[1] === null && cat.state.seats[1] === null, 'the seat to be empty for everyone');
  assert.equal(ann.state.seats[2].name, 'cat');
  assert.equal(ann.state.hostSeat, 0);

  // The kicked person hears nothing more about the room, and cannot act in it.
  const heard = bob.states.length;
  assert.equal((await ann.call('addBot', { seat: 1 })).ok, true);
  await sleep(60);
  assert.equal(bob.states.length, heard, 'no further states for the kicked person');
  assert.equal((await ann.call('removeBot', { slot: 's1' })).ok, true);
  for (const [event, payload] of [['settings', { target: 50 }], ['start', {}], ['play', { card: '2C' }], ['kick', { slot: 's0' }], ['addBot', {}]]) {
    const reply = await bob.call(event, payload);
    assert.equal(reply.ok, false, event);
    assert.equal(reply.error, 'notInAnyGame');
  }
  assert.equal(ann.state.seats[1], null);

  // Resuming without a code finds nothing, and the code does not take them back: being put out is not leaving.
  assert.deepEqual(await bob.call('resume', {}), { ok: true, code: null });
  assert.equal(bob.state, null);
  assert.equal((await bob.call('join', { code })).error, 'removedFromGame');
  assert.equal(bob.state, null);
  assert.equal(ann.state.seats[1], null, 'and the seat is still free for somebody else');
});

test('sockets: nobody can kick themselves, a computer player, an empty or an unknown seat, and non-hosts cannot kick', async (t) => {
  process.env.HEARTS_BOT_DELAY = '0-3';
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', {});
  assert.equal((await bob.call('join', { code })).ok, true);
  assert.equal((await ann.call('addBot', { seat: 2 })).ok, true);
  await until(() => ann.state.seats[2]?.bot, 'a computer player');
  const botName = ann.state.seats[2].name;

  const refused = async (person, payload, why) => {
    const reply = await person.call('kick', payload);
    assert.equal(reply.ok, false, why);
    assert.equal(typeof reply.error, 'string', why);
    assert.ok(reply.error.length > 0, why);
  };
  await refused(ann, { slot: 's0' }, 'the host kicking themselves');
  await refused(ann, { slot: 's2' }, 'a computer player (use removeBot)');
  await refused(ann, { slot: 's3' }, 'an empty seat');
  for (const slot of ['s-1', 's4', 's99', 's1.5', 's', -1, 4, 1.5, '1', null, 'bot:1', {}, [], 2 ** 40]) await refused(ann, { slot }, `slot ${JSON.stringify(slot)}`);
  for (const payload of [undefined, null, 1, 'x', [], [1]]) await refused(ann, payload, `payload ${JSON.stringify(payload)}`);
  await refused(bob, { slot: 's0' }, 'a non-host kicking the host');
  await refused(bob, { slot: 's1' }, 'a non-host kicking themselves');
  await refused(eve, { slot: 's1' }, 'someone who is not in the room');

  await sleep(40);
  assert.equal(ann.state.seats[1].name, 'bob', 'bob is still there');
  assert.equal(ann.state.seats[2].name, botName, 'the computer player is still there');
  assert.equal(ann.state.seats[0].name, 'ann');
  assert.equal(bob.state.you, 1);
});

test('sockets: the host removes a person mid-game and a computer player takes their seat; a computer player cannot be removed', async (t) => {
  process.env.HEARTS_BOT_DELAY = '0-3';
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { target: 50, seats: 4 });
  assert.equal((await bob.call('join', { code })).ok, true);
  assert.equal((await ann.call('fillBots', { count: 4 })).ok, true);
  await until(() => ann.state.seats.every(Boolean), 'full table');
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => ann.state.phase !== 'lobby', 'started');
  const at = ann.state.seats.findIndex((x) => x.name === 'bob');
  assert.deepEqual(await bob.call('kick', { slot: 's0' }), { ok: false, error: 'hostOnly' });
  assert.deepEqual(await ann.call('kick', { slot: `s${at}` }), { ok: true });
  await until(() => bob.state === null, 'bob sent out');
  await until(() => ann.state.seats[at].bot === true, 'a computer player in the seat');
  assert.notEqual(ann.state.seats[at].name, 'bob');
  const botAt = ann.state.seats.findIndex((x, i) => x.bot && i !== at);
  assert.equal((await ann.call('kick', { slot: `s${botAt}` })).ok, false, 'a computer player is not a person');
  assert.equal((await ann.call('removeBot', { slot: `s${botAt}` })).ok, false, 'and cannot be taken out of a game that has started');
  assert.equal(ann.state.seats.every(Boolean), true, 'every seat is still filled');
});

test('sockets: a kicked person is free to start their own game, but not to come back to that one', async (t) => {
  process.env.HEARTS_BOT_DELAY = '0-3';
  const site = await launchModule(t, { id: 'hearts', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', {});
  assert.equal((await bob.call('join', { code })).ok, true);
  await until(() => ann.state.seats[1]?.name === 'bob', 'bob seated');
  assert.deepEqual(await ann.call('kick', { slot: 's1' }), { ok: true });
  await until(() => bob.state === null && ann.state.seats[1] === null, 'bob out');
  assert.equal((await bob.call('join', { code })).error, 'removedFromGame', 'the code is no way back in');
  const own = await bob.call('create', {});
  assert.equal(own.ok, true, 'not blocked from hosting');
  assert.notEqual(own.code, code);
  assert.equal(ann.state.seats.filter(Boolean).length, 1);
});
