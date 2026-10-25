// Splendour against the real site: accounts over HTTP, sockets, computer players on timers, statistics and restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { assertNoLeaks, fast, playOn, playToEnd, step, validateView } from './playkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t, options = {}) => launchModule(t, { id: 'splendour', moduleDir: here, ...options });
const extrasOf = (stats) => Object.fromEntries(stats.perGame[0].extras.map((e) => [e.key, e.value]));

async function lobbyOf(people, host, settings = {}) {
  const reply = await host.call('create', settings);
  assert.equal(reply.ok, true, reply.error);
  host.code = reply.code;
  for (const p of people.filter((x) => x !== host)) assert.equal((await p.call('join', { code: reply.code })).ok, true);
  await until(() => host.state?.seats.filter(Boolean).length === people.length, 'everyone in the lobby');
  return reply.code;
}

test('one person and three computer players play a whole game; the result is recorded once', async (t) => {
  fast();
  const { person } = await launch(t);
  const ann = await person('ann').open();
  assert.equal((await ann.call('resume')).ok, true);
  assert.equal(ann.state, null, 'nothing to resume yet');
  assert.equal((await ann.call('create', { target: 10 })).ok, true);
  await until(() => ann.state?.phase === 'lobby', 'the lobby');
  assert.match(ann.state.code, /^[a-z]+-[a-z]+-[a-z]+$/);
  assert.deepEqual(ann.state.settings, { target: 10, seats: 4 });
  assert.equal((await ann.call('start')).ok, false, 'three seats are empty');
  assert.equal((await ann.call('fillBots')).ok, true);
  await until(() => ann.state.seats.every(Boolean), 'four seats');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase === 'playing', 'the deal');
  const first = ann.states.find((x) => x?.phase === 'playing');
  assert.deepEqual(first.supply, [7, 7, 7, 7, 7, 5]);
  assert.equal(first.nobles.length, 5);
  assert.deepEqual(Object.values(first.decks), [36, 26, 16]);

  await playToEnd([ann]);
  const final = ann.state;
  validateView(final, 'ann');
  assert.equal(final.phase, 'finished');
  assert.equal(final.scoreboard.lowIsBetter, false);
  assert.equal(final.scoreboard.target, 10);
  assert.ok(final.scoreboard.players.some((p) => p.score >= 10));
  assert.equal(final.scoreboard.rounds.length, final.round);
  for (const p of final.scoreboard.players) {
    assert.equal(final.scoreboard.rounds.reduce((total, r) => total + r.deltas[p.id], 0), p.score, 'the history sums to the final score');
  }
  const mine = final.scoreboard.players.find((p) => p.isMe);
  const best = Math.max(...final.scoreboard.players.map((p) => p.score));
  assert.ok(final.winners.length >= 1);
  for (const w of final.winners) assert.equal(final.scoreboard.players.find((p) => p.id === w).score, best);
  for (const state of ann.states) assertNoLeaks(state, 'ann');

  await sleep(100);
  const stats = await ann.stats();
  const [game] = stats.perGame;
  assert.equal(game.name, 'Splendour');
  assert.equal(game.played, 1, 'recorded exactly once');
  assert.equal(game.wins, final.winners.includes(final.you) ? 1 : 0);
  assert.equal(game.losses, final.winners.includes(final.you) ? 0 : 1);
  assert.equal(game.totalScore, mine.score);
  const extras = extrasOf(stats);
  assert.equal(extras.turnsTaken, final.round);
  assert.ok(extras.cardsBought >= 1);
  assert.ok(extras.reservedCards >= 0 && extras.noblesVisited >= 0);
  assert.equal(stats.recent[0].players, 1);

  assert.equal((await ann.call('again')).ok, true, 'back to the lobby');
  await until(() => ann.state.phase === 'lobby', 'the lobby again');
  assert.deepEqual(ann.state.scoreboard.rounds, []);
  assert.equal(ann.state.seats.filter(Boolean).length, 4, 'the seats are kept');
  await sleep(100);
  assert.equal((await ann.stats()).perGame[0].played, 1, 'going back does not record it again');
  assert.equal((await ann.call('start')).ok, true, 'and a second game can start');
});

for (const seats of [2, 3, 4]) {
  test(`${seats} seats: humans and computer players play to the end; both humans are recorded`, async (t) => {
    fast();
    const { person } = await launch(t);
    const ann = await person('ann').open();
    const bob = await person('bob').open();
    await lobbyOf([ann, bob], ann, { seats, target: 10 });
    await ann.call('fillBots');
    await until(() => ann.state.seats.every(Boolean), 'full');
    assert.equal(ann.state.seats.length, seats);
    assert.equal((await ann.call('start')).ok, true);
    await until(() => ann.state.phase === 'playing' && bob.state.phase === 'playing', 'the game');
    const each = { 2: 4, 3: 5, 4: 7 }[seats];
    const first = ann.states.find((x) => x?.phase === 'playing');
    assert.deepEqual(first.supply, [each, each, each, each, each, 5]);
    assert.equal(first.nobles.length, seats + 1);
    await playToEnd([ann, bob]);
    for (const p of [ann, bob]) {
      validateView(p.state, p.name);
      for (const s of p.states) assertNoLeaks(s, p.name);
      for (const pl of p.state.scoreboard.players) assert.equal(p.state.scoreboard.rounds.reduce((total, r) => total + r.deltas[pl.id], 0), pl.score);
    }
    assert.deepEqual(ann.state.scoreboard.rounds, bob.state.scoreboard.rounds, 'the same history in every view');
    await sleep(150);
    const [a, b] = [await ann.stats(), await bob.stats()];
    assert.equal(a.perGame[0].played, 1);
    assert.equal(b.perGame[0].played, 1);
    const winners = ann.state.winners;
    assert.equal(a.perGame[0].wins, winners.includes(ann.state.you) ? 1 : 0);
    assert.equal(b.perGame[0].wins, winners.includes(bob.state.you) ? 1 : 0);
    assert.equal(a.perGame[0].totalScore, ann.state.scoreboard.players.find((p) => p.isMe).score);
    assert.equal(a.recent[0].players, 2, 'two accounts, computer players are not recorded');
  });
}

test('the lobby: invite codes, settings, seats, hosting and one game per account', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob, cat, dan, eve] = await Promise.all(['ann', 'bob', 'cat', 'dan', 'eve'].map((n) => person(n).open()));
  assert.equal((await ann.call('create', { target: 99 })).ok, false, 'a bad option stops the room');
  assert.equal((await ann.call('create', { seats: 5 })).ok, false);
  await ann.call('create', { seats: 3 });
  const code = ann.state.code;
  assert.equal((await bob.call('join', { code: 'nonsense' })).ok, false);
  assert.equal((await bob.call('join', { code: 'boss-aware-you' })).ok, false, 'no such game');
  assert.equal((await bob.call('join', { code })).ok, true);
  await until(() => ann.state.seats.filter(Boolean).length === 2, 'bob in the lobby');
  assert.deepEqual(ann.state.seats.map((s) => s?.name), ['ann', 'bob', undefined]);
  assert.equal(bob.state.you, 1);
  assert.equal(bob.state.hostSeat, 0);

  assert.equal((await bob.call('settings', { target: 20 })).ok, false, 'only the host');
  assert.equal((await bob.call('addBot')).ok, false);
  assert.equal((await ann.call('settings', { target: 77 })).ok, false);
  assert.equal((await ann.call('settings', { seats: 1 })).ok, false);
  assert.equal((await ann.call('settings', { target: 20, hostId: 5, seats: 4 })).ok, true);
  await until(() => bob.state.settings.target === 20 && bob.state.seats.length === 4, 'the settings to reach bob');
  assert.deepEqual(bob.state.settings, { target: 20, seats: 4 });
  assert.equal((await ann.call('settings', { seats: 2 })).ok, true);
  assert.equal((await ann.call('settings', { seats: 3 })).ok, true);

  assert.equal((await ann.call('create')).ok, false, 'one game per account');
  assert.equal((await bob.call('create')).ok, false);

  assert.equal((await ann.call('addBot')).ok, true);
  await until(() => ann.state.seats[2]?.bot, 'a computer player');
  assert.equal((await cat.call('join', { code })).ok, false, 'a full room');
  assert.equal((await ann.call('removeBot', { seat: 1 })).ok, false, 'a person is not removed like a computer player');
  assert.equal((await ann.call('removeBot', { seat: 2 })).ok, true);
  assert.equal((await cat.call('join', { code })).ok, true, 'the freed seat');
  assert.equal((await dan.call('join', { code })).ok, false);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => cat.state.phase === 'playing', 'the game');
  assert.equal((await dan.call('join', { code })).ok, false, 'a started game cannot be joined');
  assert.equal((await eve.call('join', { code })).ok, false);
  assert.equal((await ann.call('settings', { target: 10 })).ok, false);
});

test('leaving the lobby passes the host on, and the room is dropped when everyone has left', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => person(n).open()));
  const code = await lobbyOf([ann, bob], ann);
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'ann to be out');
  await until(() => bob.state.hostSeat === bob.state.you && !bob.state.seats[0], 'bob to host');
  assert.equal((await ann.call('join', { code })).ok, true, 'ann may come back');
  await until(() => bob.state.seats[0]?.name === 'ann', 'ann seated again');
  await ann.call('leave');
  await bob.call('leave');
  await sleep(50);
  assert.equal((await ann.call('join', { code })).ok, false, 'the room is gone');
});

test('reconnects: a second socket, a new socket and a resume all find the same game', async (t) => {
  fast('40-60');
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const bob = await site.person('bob').open();
  const code = await lobbyOf([ann, bob], ann, { seats: 2 });
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'the game');
  const second = await ann.twin();
  assert.equal((await second.call('resume')).ok, true);
  await until(() => second.state?.code === code, 'the second socket to see the game');
  assert.equal(second.state.you, ann.state.you);
  // Either socket can act; both are told.
  const mover = ann.state.turn === ann.state.you ? ann : bob;
  const viaSecond = mover === ann ? second : mover;
  assert.equal((await viaSecond.call('take', { colours: [0, 1, 2] })).ok, true);
  await until(() => ann.state.log.length >= 1 && second.state.log.length >= 1, 'both sockets told');
  // Closing every socket leaves the player "away" but in the game.
  ann.closeAll();
  second.closeAll();
  await until(() => bob.state.scoreboard.players.some((p) => p.away), 'ann marked away');
  const back = await site.person('ann');
  back.cookie = ann.cookie;
  await back.connect();
  assert.equal((await back.call('resume', { code })).ok, true);
  await until(() => back.state?.code === code && back.state.log.length >= 1, 'the game after reconnecting');
  assert.deepEqual(back.state.seats.map((s) => s.name), ['ann', 'bob'].sort((x, y) => back.state.seats.findIndex((s) => s.name === x) - back.state.seats.findIndex((s) => s.name === y)));
  await until(() => !bob.state.scoreboard.players.some((p) => p.away), 'ann back');
  assert.equal((await back.call('resume', { code: 'boss-aware-you' })).ok, false, 'cannot switch game');
});

test('two rooms at once do not interfere', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob, cat, dan] = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((n) => person(n).open()));
  const c1 = await lobbyOf([ann, bob], ann, { seats: 2, target: 10 });
  const c2 = await lobbyOf([cat, dan], cat, { seats: 3, target: 10 });
  assert.notEqual(c1, c2);
  await cat.call('addBot');
  await Promise.all([ann.call('start'), cat.call('start')]);
  await playToEnd([ann, bob, cat, dan]);
  assert.equal(ann.state.code, c1);
  assert.equal(cat.state.code, c2);
  assert.equal(ann.state.seats.length, 2);
  assert.equal(cat.state.seats.length, 3);
  assert.ok(!ann.state.seats.some((s) => s && ['cat', 'dan'].includes(s.name)));
  await sleep(150);
  for (const p of [ann, bob, cat, dan]) assert.equal((await p.stats()).perGame[0].played, 1, p.name);
});

test('hidden information: nobody is ever sent a face-down card they may not see', async (t) => {
  fast();
  const { person } = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => person(n).open()));
  await lobbyOf([ann, bob], ann, { seats: 2, target: 10 });
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'the game');
  let blind = 0;
  const reserver = async (p) => {
    const s = p.state;
    if (s.turn !== s.you) return false;
    if (s.pending) return step(p);
    if (s.seats[s.you].reserved.length < 3 && blind < 6) {
      const reply = await p.call('reserve', { level: 1 + (blind % 3) });
      if (reply.ok) blind++;
      return reply.ok;
    }
    return step(p);
  };
  const started = Date.now();
  while (ann.state.phase !== 'finished' && Date.now() - started < 30000) {
    const moved = (await reserver(ann)) || (await reserver(bob));
    if (!moved) await sleep(3);
    if (ann.state.seats.some((s) => s?.reserved.some((r) => r.blind)) ) {
      for (const [viewer, other] of [[ann, bob], [bob, ann]]) {
        const theirs = viewer.state.seats[other.state.you].reserved;
        for (const r of theirs) if (r.blind) assert.equal(r.card, null);
        const mine = viewer.state.seats[viewer.state.you].reserved;
        for (const r of mine) assert.match(r.card, /^c\d\d$/);
      }
    }
  }
  assert.equal(ann.state.phase, 'finished');
  assert.ok(blind >= 3, 'blind reserves were made');
  for (const p of [ann, bob]) for (const s of p.states) assertNoLeaks(s, p.name);
});

test('a human who leaves mid-game is replaced by a computer, is not recorded, and the game goes on', async (t) => {
  fast('5-10');
  const { person } = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => person(n).open()));
  await lobbyOf([ann, bob], ann, { seats: 3, target: 10 });
  await ann.call('addBot');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing' && bob.state.phase === 'playing', 'the game');
  const bobSeat = bob.state.you;
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => bob.state === null, 'bob out');
  await until(() => ann.state.seats[bobSeat].bot, 'a computer for bob');
  assert.equal(ann.state.seats[bobSeat].name !== 'bob', true);
  assert.equal(ann.state.seats.length, 3);
  await playToEnd([ann]);
  await sleep(150);
  assert.equal((await ann.stats()).perGame[0].played, 1);
  assert.equal((await ann.stats()).recent[0].players, 1, 'only ann is recorded');
  assert.equal((await bob.stats()).perGame.length, 0, 'bob left, so no record');
  assert.equal((await bob.call('create', { seats: 2 })).ok, true, 'bob is free to start another game');
});

test('when a person leaves in the middle of a pending choice, the computer player completes the turn', async (t) => {
  fast('5-10');
  const { person } = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => person(n).open()));
  await lobbyOf([ann, bob], ann, { seats: 2, target: 10 });
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'the game');
  // Take gems until bob (a person) is over the limit, then bob leaves instead of returning.
  const started = Date.now();
  let left = false;
  while (!left && Date.now() - started < 30000) {
    if (bob.state.pending && bob.state.turn === bob.state.you) {
      assert.equal((await bob.call('leave')).ok, true);
      left = true;
      break;
    }
    const moved = (await step(ann)) || (await (async () => {
      const s = bob.state;
      if (s.turn !== s.you || s.pending) return false;
      const open = [0, 1, 2, 3, 4].filter((c) => s.supply[c] > 0);
      const reply = open.length ? await bob.call('take', { colours: open.slice(0, 3) }) : await bob.call('reserve', { level: 1 });
      return reply.ok;
    })());
    if (!moved) await sleep(3);
    if (ann.state.phase === 'finished') break;
  }
  assert.ok(left, 'bob was over the token limit and left');
  if (left) {
    await until(() => ann.state.seats.every((s) => s?.bot !== false || s.name === 'ann') && ann.state.pending === null, 'the computer finishes the turn');
  }
  await playToEnd([ann]);
});

test('a restart loses nothing: the room comes back and the computer players carry on', async (t) => {
  fast('15-25');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splendour-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { target: 10, seats: 3 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state?.phase === 'playing', 'the game');
  for (let i = 0; i < 25 && ann.state.phase === 'playing'; i++) {
    await step(ann);
    await sleep(30);
  }
  const code = ann.state.code;
  const before = ann.state;
  assert.equal(before.phase, 'playing');
  const cookie = ann.cookie;
  await first.stop();

  const second = await launch(t, { dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  assert.equal((await again.call('resume')).ok, true);
  await until(() => again.state?.phase, 'the saved game');
  assert.equal(again.state.code, code);
  assert.deepEqual(again.state.settings, before.settings);
  assert.equal(again.state.seats.length, 3);
  assert.ok(again.state.round >= before.round - 1);
  assert.ok(again.state.log.length >= before.log.length - 1);
  validateView(again.state, 'ann');
  fast('0-3');
  await playToEnd([again]);
  assert.equal(again.state.phase, 'finished');
  await sleep(100);
  assert.equal((await again.stats()).perGame[0].played, 1);
});

test('a restart after the game has finished does not record it a second time', async (t) => {
  fast();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splendour-restart2-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { target: 10, seats: 2 });
  await ann.call('fillBots');
  await ann.call('start');
  await playToEnd([ann]);
  await sleep(150);
  const cookie = ann.cookie;
  await first.stop();
  const second = await launch(t, { dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  await again.call('resume');
  await until(() => again.state?.phase === 'finished', 'the finished game');
  await sleep(150);
  assert.equal((await again.stats()).perGame[0].played, 1);
});

test('a bot-only continuation: when the only person goes away the room stays until they return', async (t) => {
  fast('5-10');
  const { person } = await launch(t);
  const ann = await person('ann').open();
  await ann.call('create', { seats: 2, target: 10 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'the game');
  const code = ann.state.code;
  ann.closeAll();
  await sleep(100);
  const back = person('ann');
  back.cookie = ann.cookie;
  await back.connect();
  assert.equal((await back.call('resume')).ok, true);
  await until(() => back.state?.code === code, 'the game');
  await playOn([back], () => back.state.phase === 'finished');
});
