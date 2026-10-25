// Azulejo over real sockets: simultaneous actions, one account on two sockets, disconnects, hosts leaving, rooms
// disappearing under connected sockets, kicking, the one-game-per-account rule and leaving during the tiling phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { fast, playToEnd, simpleMove, step } from './e2e-support.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t) => launchModule(t, { id: 'azulejo', moduleDir: here });
const oks = (replies) => replies.filter((r) => r.ok === true).length;
const gameStats = (stats) => stats.perGame.find((g) => g.name === 'Azulejo');

/** Ann (host), Bob and one computer player, started. */
async function started(t, { seats = 3, freeWall = false } = {}) {
  fast();
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats, freeWall });
  assert.equal((await bob.call('join', { code })).ok, true);
  await ann.call('fillBots');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'playing' && bob.state?.phase === 'playing', 'play');
  return { site, ann, bob, code };
}

test('both pressing start in the same tick starts exactly one game', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const twin = await ann.twin();
  const { code } = await ann.call('create', { seats: 3 });
  await bob.call('join', { code });
  await twin.call('resume', { code });
  await ann.call('fillBots');
  const replies = await Promise.all([ann.call('start'), twin.call('start'), bob.call('start')]);
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  await until(() => ann.state.phase === 'playing', 'play');
  const factories = JSON.stringify(ann.state.factories);
  await sleep(30);
  assert.equal(JSON.stringify(ann.state.factories) === factories || ann.state.round >= 1, true);
  assert.equal(ann.state.round, 1, 'one game began');
  assert.deepEqual(twin.state.factories.length, ann.state.factories.length);
});

test('four people racing for the last seat: exactly one gets it and everybody agrees who', async (t) => {
  fast();
  const site = await launch(t);
  const names = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay'];
  const [ann, ...rest] = await Promise.all(names.map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 4 });
  await ann.call('addBot', { seat: 1 });
  await ann.call('addBot', { seat: 2 });
  const racers = rest.slice(0, 5);
  const replies = await Promise.all(racers.map((p) => p.call('join', { code })));
  assert.equal(oks(replies), 1, JSON.stringify(replies));
  await until(() => ann.state.seats.every(Boolean), 'full');
  const winner = racers[replies.findIndex((r) => r.ok)];
  assert.equal(ann.state.seats[3].name, winner.name);
  await sleep(30);
  for (const p of racers) assert.equal(p.state?.seats?.[3]?.name ?? null, p === winner ? winner.name : null, `${p.name} sees the right thing`);
});

test('the same move from two sockets of one account, and from the other player, at once: only the right one counts', async (t) => {
  const { ann, bob } = await started(t, { seats: 2 });
  const twin = await ann.twin();
  await twin.call('resume', {});
  await until(() => twin.state?.phase === 'playing', 'the twin to see the game');
  for (let round = 0; round < 3; round++) {
    await until(() => [ann, bob].some((p) => p.state.phase === 'playing' && p.state.turn === p.state.you), 'a person to move');
    const mover = ann.state.turn === ann.state.you ? ann : bob;
    const other = mover === ann ? bob : ann;
    const moverTwin = mover === ann ? twin : await bob.twin();
    if (mover === bob) await moverTwin.call('resume', {});
    await until(() => moverTwin.state?.phase === 'playing', 'the twin to be in the game');
    const move = simpleMove(mover.state);
    const centreBefore = mover.state.centre.length;
    const replies = await Promise.all([mover.call('move', move), moverTwin.call('move', move), other.call('move', move)]);
    assert.equal(oks(replies), 1, JSON.stringify(replies));
    await until(() => mover.state.turn !== mover.state.you || mover.state.phase !== 'playing', 'the turn to pass');
    assert.deepEqual(mover.state.factories, moverTwin.state.factories, 'both sockets agree');
    assert.ok(mover.state.centre.length >= 0 && centreBefore >= 0);
    // Let the other person move, so the loop can go round.
    await step(other).catch(() => {});
  }
  await playToEnd([ann, bob]);
  for (const s of ann.states.filter(Boolean)) {
    if (s.phase === 'playing') {
      const onBoards = s.seats.reduce((n, seat) => n + seat.lines.reduce((a, l) => a + l.count, 0) + seat.wall.flat().filter((c) => c !== null).length + seat.floor.filter((c) => c >= 0).length, 0);
      assert.equal(s.bagCount + s.lid.reduce((a, b) => a + b, 0) + s.factories.flat().length + s.centre.length + onBoards, 100, 'the tiles are never duplicated by a double move');
    }
  }
});

test('disconnecting and reconnecting keeps the seat and the game, whenever it happens', async (t) => {
  const { ann, bob } = await started(t);
  const drop = async (person) => {
    const seat = person.state.you;
    const walls = JSON.stringify(person.state.seats.map((s) => s.wall));
    person.socket.close();
    const watcher = person === ann ? bob : ann;
    await until(() => watcher.state.seats[seat].online === false, `${person.name} to show as away`);
    await person.connect();
    assert.equal((await person.call('resume', {})).ok, true);
    await until(() => person.state?.phase, 'the state after resuming');
    assert.equal(person.state.you, seat);
    assert.equal(JSON.stringify(person.state.seats.map((s) => s.wall)), walls);
    await until(() => [ann, bob].every((p) => p.state.seats.filter((s) => !s.bot).every((s) => s.online)), 'everyone online again');
  };
  await drop(bob);
  for (let i = 0; i < 6; i++) {
    for (const p of [ann, bob]) await step(p).catch(() => {});
    await sleep(8);
  }
  await drop(ann);
  await drop(bob);
  await playToEnd([ann, bob]);
  await sleep(120);
  assert.equal(gameStats(await ann.stats()).played, 1);
});

test('everybody disconnecting mid-game: the computers wait for the people, and the people can come back', async (t) => {
  const { ann, bob } = await started(t, { seats: 2 });
  const code = ann.state.code;
  ann.closeAll();
  bob.closeAll();
  await sleep(200);
  const again = await ann.twin();
  assert.equal((await again.call('resume', { code })).ok, true);
  await until(() => again.state?.phase === 'playing', 'the game is still there');
  assert.equal(again.state.seats.filter((s) => !s.bot).length, 2, 'nobody was replaced just for disconnecting');
  const back = await bob.twin();
  await back.call('resume', {});
  await playToEnd([again, back]);
});

test('the host leaving the lobby hands the game to another person; a disconnected host keeps it', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 4 });
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state.seats[2], 'cat');
  ann.socket.close();
  await until(() => bob.state.seats[0].online === false, 'ann away');
  assert.equal(bob.state.hostSeat, 0, 'a disconnected host is still the host');
  const back = await ann.twin();
  await back.call('resume', {});
  await until(() => bob.state.seats[0].online, 'ann back');
  assert.equal((await back.call('leave')).ok, true);
  await until(() => bob.state.seats[0] === null, 'the seat freed');
  assert.equal(bob.state.seats[bob.state.hostSeat].name, 'bob', 'bob hosts now');
  assert.equal((await bob.call('addBot')).ok, true);
  assert.equal((await cat.call('addBot')).ok, false, 'cat is not the host');
});

test('the host leaving mid-game: a computer takes the seat, the next person hosts and can play again', async (t) => {
  const { ann, bob } = await started(t, { seats: 2 });
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => bob.state.seats[0].bot, 'a computer in ann\'s seat');
  assert.equal(bob.state.seats[bob.state.hostSeat].name, 'bob');
  await playToEnd([bob]);
  assert.equal((await bob.call('again')).ok, true, 'bob, the host now, can play again');
  await until(() => bob.state.phase === 'lobby', 'lobby');
  assert.equal(bob.state.seats.filter(Boolean).length, 2);
});

test('a room that disappears under connected sockets leaves them cleanly out', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 3 });
  const second = await ann.twin();
  await second.call('resume', {});
  await bob.call('join', { code });
  await ann.call('leave');
  await bob.call('leave');
  await until(() => ann.state === null && second.state === null && bob.state === null, 'everybody out');
  assert.equal((await second.call('move', { source: 0, colour: 0, line: 0 })).ok, false);
  assert.equal((await second.call('start')).ok, false);
  assert.equal((await bob.call('join', { code })).ok, false, 'the room is gone');
});

test('one live game per account: creating or joining a second is refused, and leaving frees the account', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const first = (await ann.call('create', { seats: 3 })).code;
  const other = (await cat.call('create', { seats: 3 })).code;
  assert.equal((await ann.call('create', {})).ok, false);
  assert.equal((await ann.call('join', { code: other })).ok, false);
  assert.equal(ann.state.code, first, 'still in the first game');
  assert.equal((await bob.call('join', { code: first })).ok, true);
  assert.equal((await bob.call('join', { code: other })).ok, false);
  assert.equal((await bob.call('leave')).ok, true);
  assert.equal((await bob.call('join', { code: other })).ok, true);
  assert.equal(bob.state.code, other);
});

test('kicking over sockets: every socket of the person is sent out, and they can rejoin or start their own game', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 3 });
  await bob.call('join', { code });
  const phone = await bob.twin();
  await phone.call('resume', {});
  await until(() => phone.state?.code === code && ann.state.seats[1], 'bob on two sockets');
  assert.equal((await ann.call('kick', { seat: 1 })).ok, true);
  await until(() => bob.state === null && phone.state === null, 'both of bob\'s sockets sent out');
  assert.equal(ann.state.seats[1], null);
  assert.equal((await bob.call('create', { seats: 2 })).ok, true, 'free to start their own game');
  await bob.call('leave');
  assert.equal((await bob.call('join', { code })).ok, true, 'or to rejoin');
  await until(() => ann.state.seats[1]?.name === 'bob', 'bob back');
  assert.equal((await ann.call('kick', { seat: 1 })).ok, true, 'and be kicked again');
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'play');
  assert.equal((await ann.call('kick', { seat: 1 })).ok, false, 'kicking is for the lobby');
});

test('a finished game does not block joining another, and a finished seat can be left', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  await ann.call('create', { seats: 2 });
  await ann.call('fillBots');
  await ann.call('start');
  await playToEnd([ann]);
  const { code } = await bob.call('create', { seats: 2 });
  assert.equal((await ann.call('join', { code })).ok, true, 'a finished game is not live');
  assert.equal(ann.state.code, code);
  await until(() => bob.state.seats.filter(Boolean).length === 2, 'ann seated in the new game');
});

test('leaving during the free-wall tiling: a computer takes over the pending choice and the game goes on', async (t) => {
  const { ann, bob } = await started(t, { seats: 2, freeWall: true });
  let left = false;
  const began = Date.now();
  while (!left) {
    assert.ok(Date.now() - began < 60000, 'a choice came up');
    if (bob.state.phase === 'tiling' && bob.state.choice) {
      assert.equal((await bob.call('leave')).ok, true);
      left = true;
    } else {
      for (const p of [ann, bob]) await step(p).catch(() => {});
      await sleep(2);
    }
  }
  await until(() => ann.state.seats[ann.state.seats.findIndex((s) => s.bot)] !== undefined, 'a computer for bob');
  await playToEnd([ann]);
  await sleep(120);
  assert.equal(gameStats(await ann.stats()).played, 1);
  assert.equal((await bob.stats()).perGame.length, 0, 'the leaver is not recorded');
});
