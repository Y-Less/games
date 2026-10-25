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
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  game.addHuman(room, 2, 'bob');
  game.addHuman(room, 3, 'cat');
  return room;
}

test('rules: the host removes a person from a lobby seat and the seat becomes empty', () => {
  const room = lobby();
  const result = game.kick(room, 1, 1);
  assert.deepEqual(result, { ok: true, userId: 2 });
  assert.equal(room.seats[1], null);
  assert.equal(game.hasPlayer(room, 2), false);
  assert.equal(room.hostId, 1, 'the host is unchanged');
  assert.equal(game.hasPlayer(room, 3), true, 'the others stay');
  // The seat can be filled again, by the same person or another.
  assert.deepEqual(game.addHuman(room, 2, 'bob'), { ok: true, seat: 1 });
  assert.equal(room.seats[1].id, 2);
});

test('rules: only the host can kick, and never themselves', () => {
  const room = lobby();
  const before = snapshot(room);
  for (const [by, seat] of [[2, 2], [3, 1], [2, 0], [99, 1], [null, 1], [undefined, 1]]) {
    const result = game.kick(room, by, seat);
    assert.equal(result.ok, false, `${by} kicking seat ${seat}`);
    assert.match(result.error, /host/i);
  }
  const self = game.kick(room, 1, 0);
  assert.equal(self.ok, false);
  assert.ok(self.error);
  assert.equal(snapshot(room), before, 'nothing changed');
});

test('rules: kicking is refused in every phase except the lobby', () => {
  for (const phase of ['nominating', 'playing', 'roundEnd', 'finished']) {
    const room = lobby();
    game.fillWithBots(room, 1);
    assert.equal(game.start(room, 1).ok, true);
    room.phase = phase;
    const before = snapshot(room);
    const result = game.kick(room, 1, 1);
    assert.equal(result.ok, false, phase);
    assert.match(result.error, /before the game starts/);
    assert.equal(snapshot(room), before);
  }
});

test('rules: a computer player, an empty seat or a nonsense seat cannot be kicked', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'ann' });
  game.addHuman(room, 2, 'bob');
  game.addBot(room, 1, 2);
  const before = snapshot(room);
  for (const seat of [2, 3, -1, 4, 99, 1.5, NaN, Infinity, '1', '0', undefined, null, {}, [], [1], true, 'bot:1', 2 ** 40]) {
    const result = game.kick(room, 1, seat);
    assert.equal(result.ok, false, `seat ${String(seat)}`);
    assert.equal(typeof result.error, 'string');
  }
  assert.equal(snapshot(room), before, 'no seat was touched');
  assert.equal(room.seats[2].kind, 'bot');
});

test('rules: the kick result names the person so the server can send them home', () => {
  const room = lobby();
  assert.equal(game.kick(room, 1, 2).userId, 3);
  assert.equal(game.kick(room, 1, 2).ok, false, 'the seat is already empty');
  assert.equal(game.humanSeats(room).length, 2);
});

test('sockets: the host removes a person; they return to the entry screen and can rejoin with the code', async (t) => {
  process.env.NOMINATION_WHIST_BOT_DELAY = '0-3';
  const site = await launchModule(t, { id: 'nomination-whist', moduleDir: here });
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

  assert.deepEqual(await cat.call('kick', { seat: 1 }), { ok: false, error: 'Only the host can do that.' });
  assert.equal(ann.state.seats[1].name, 'bob', 'a non-host cannot remove anyone');

  assert.deepEqual(await ann.call('kick', { seat: 1 }), { ok: true });
  await until(() => bob.state === null && bobsSecondTab.state === null, 'both of bob\'s tabs to be sent to the entry screen');
  await until(() => ann.state.seats[1] === null && cat.state.seats[1] === null, 'the seat to be empty for everyone');
  assert.equal(ann.state.seats[2].name, 'cat');
  assert.equal(ann.state.hostSeat, 0);

  // The kicked person hears nothing more about the room, and cannot act in it.
  const heard = bob.states.length;
  assert.equal((await ann.call('addBot', { seat: 1 })).ok, true);
  await sleep(60);
  assert.equal(bob.states.length, heard, 'no further states for the kicked person');
  assert.equal((await ann.call('removeBot', { seat: 1 })).ok, true);
  for (const [event, payload] of [['settings', { length: 'short' }], ['start', {}], ['play', { card: '2C' }], ['kick', { seat: 0 }], ['addBot', {}]]) {
    const reply = await bob.call(event, payload);
    assert.equal(reply.ok, false, event);
    assert.equal(reply.error, 'You are not in a game.');
  }
  assert.equal(ann.state.seats[1], null);

  // Resuming without a code finds nothing; the code takes them back in, into the first empty seat.
  assert.deepEqual(await bob.call('resume', {}), { ok: true, code: null });
  assert.equal(bob.state, null);
  assert.equal((await bob.call('join', { code })).ok, true);
  await until(() => bob.state?.you === 1, 'bob to be back in seat 1');
  assert.equal(ann.state.seats[1].name, 'bob');
  assert.equal(bob.state.phase, 'lobby');
});

test('sockets: nobody can kick themselves, a computer player, an empty or an unknown seat, and non-hosts cannot kick', async (t) => {
  process.env.NOMINATION_WHIST_BOT_DELAY = '0-3';
  const site = await launchModule(t, { id: 'nomination-whist', moduleDir: here });
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
  await refused(ann, { seat: 0 }, 'the host kicking themselves');
  await refused(ann, { seat: 2 }, 'a computer player (use removeBot)');
  await refused(ann, { seat: 3 }, 'an empty seat');
  for (const seat of [-1, 4, 99, 1.5, '1', null, 'bot:1', {}, [], 2 ** 40]) await refused(ann, { seat }, `seat ${JSON.stringify(seat)}`);
  for (const payload of [undefined, null, 1, 'x', [], [1]]) await refused(ann, payload, `payload ${JSON.stringify(payload)}`);
  await refused(bob, { seat: 0 }, 'a non-host kicking the host');
  await refused(bob, { seat: 1 }, 'a non-host kicking themselves');
  await refused(eve, { seat: 1 }, 'someone who is not in the room');

  await sleep(40);
  assert.equal(ann.state.seats[1].name, 'bob', 'bob is still there');
  assert.equal(ann.state.seats[2].name, botName, 'the computer player is still there');
  assert.equal(ann.state.seats[0].name, 'ann');
  assert.equal(bob.state.you, 1);
});

test('sockets: kicking is refused once the game has started, in every phase it passes through', async (t) => {
  process.env.NOMINATION_WHIST_BOT_DELAY = '0-3';
  process.env.NOMINATION_WHIST_TRICK_PAUSE = '0';
  const site = await launchModule(t, { id: 'nomination-whist', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { length: 'short' });
  assert.equal((await bob.call('join', { code })).ok, true);
  assert.equal((await ann.call('fillBots', {})).ok, true);
  await until(() => ann.state.seats.every(Boolean), 'full table');
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => ann.state.phase === 'nominating', 'nominating');
  const refusedNow = async (phase) => {
    const reply = await ann.call('kick', { seat: 1 });
    assert.equal(reply.ok, false, `${phase}: the game has started`);
    assert.match(reply.error, /before the game starts/);
    assert.equal(ann.state.seats[1].name, 'bob', phase);
    assert.equal(bob.state?.you, 1, phase);
  };
  await refusedNow('nominating');
  // Play on to the end of the game, kicking at every step the people take.
  const started = Date.now();
  let sawPlaying = false;
  while (ann.state.phase !== 'finished' && Date.now() - started < 60000) {
    for (const p of [ann, bob]) {
      const s = p.state;
      if (s.phase === 'playing' && !sawPlaying) {
        sawPlaying = true;
        await refusedNow('playing');
      }
      if (s.phase === 'nominating' && s.turn === s.you) await p.call('nominate', { number: s.forbidden === 0 ? 1 : 0 });
      else if (s.phase === 'playing' && s.legal) await p.call('play', { card: Object.keys(s.legal).find((c) => s.legal[c] === null) });
      else if (s.phase === 'roundEnd') {
        await refusedNow('roundEnd');
        await p.call('next', {});
      }
    }
    await sleep(2);
  }
  assert.equal(ann.state.phase, 'finished');
  assert.ok(sawPlaying);
  await refusedNow('finished');
  assert.equal((await ann.call('again', {})).ok, true);
  await until(() => bob.state?.phase === 'lobby', 'back in the lobby');
  assert.deepEqual(await ann.call('kick', { seat: 1 }), { ok: true }, 'kicking works again in the lobby');
  await until(() => bob.state === null, 'bob sent out');
});

test('sockets: a kicked person is free to start their own game, and may be kicked again after rejoining', async (t) => {
  process.env.NOMINATION_WHIST_BOT_DELAY = '0-3';
  const site = await launchModule(t, { id: 'nomination-whist', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', {});
  for (let round = 0; round < 3; round++) {
    assert.equal((await bob.call('join', { code })).ok, true, `round ${round}`);
    await until(() => ann.state.seats[1]?.name === 'bob', 'bob seated');
    assert.deepEqual(await ann.call('kick', { seat: 1 }), { ok: true });
    await until(() => bob.state === null && ann.state.seats[1] === null, 'bob out');
  }
  const own = await bob.call('create', {});
  assert.equal(own.ok, true, 'not blocked from hosting');
  assert.notEqual(own.code, code);
  assert.equal(ann.state.seats.filter(Boolean).length, 1);
});
