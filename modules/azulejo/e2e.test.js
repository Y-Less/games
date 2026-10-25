// Azulejo against the real site: accounts over HTTP, sockets, computer players on timers, statistics and restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { checkFinal, extrasOf, fast, playToEnd, step } from './e2e-support.js';
import { completeColumns, completeRows, completeSets } from './rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t, options = {}) => launchModule(t, { id: 'azulejo', moduleDir: here, ...options });
const named = (site, names) => Promise.all(names.map((n) => site.person(n).open()));
const gameStats = (stats) => stats.perGame.find((g) => g.name === 'Azulejo');

/** Every state a person ever received: the bag never, history always, the tiles always accounted for. */
function assertViews(person) {
  let previous = 0;
  for (const s of person.states) {
    if (!s) continue;
    assert.ok(s.scoreboard && Array.isArray(s.scoreboard.rounds), `${person.name}: a scoreboard in every view`);
    assert.ok(s.scoreboard.rounds.length >= previous || s.phase === 'lobby', `${person.name}: the history only grows`);
    previous = s.phase === 'lobby' ? 0 : s.scoreboard.rounds.length;
    const text = JSON.stringify(s);
    assert.ok(!/"bag":/.test(text), `${person.name}: no bag`);
    if (s.phase === 'playing' || s.phase === 'tiling' || s.phase === 'finished') {
      assert.equal(s.lid.length, 5, 'the lid is a list of counts');
      const onBoards = s.seats.reduce((n, seat) => n + seat.lines.reduce((a, l) => a + l.count, 0) + seat.wall.flat().filter((c) => c !== null).length + seat.floor.filter((c) => c >= 0).length, 0);
      const total = s.bagCount + s.lid.reduce((a, b) => a + b, 0) + s.factories.flat().length + s.centre.length + onBoards;
      assert.equal(total, 100, `${person.name}: every tile is accounted for in the view (round ${s.round}, ${s.phase})`);
      for (const p of s.scoreboard.players) assert.equal(p.score, s.seats[p.id].score);
      for (const p of s.scoreboard.players) {
        // After the last entry the history sums to the score.
        assert.equal(s.scoreboard.rounds.reduce((sum, r) => sum + r.deltas[p.id], 0), p.score, `${person.name}: the history sums to the score`);
      }
    }
  }
}

for (const seats of [2, 3, 4, 5]) {
  test(`one person and ${seats - 1} computer players play a whole game; recorded once (${seats} seats)`, async (t) => {
    fast();
    const site = await launch(t);
    const [ann] = await named(site, ['ann']);
    assert.equal((await ann.call('resume')).ok, true);
    assert.equal(ann.state, null, 'nothing to resume yet');
    const created = await ann.call('create', { seats });
    assert.equal(created.ok, true, created.error);
    assert.match(created.code, /^[a-z]+-[a-z]+-[a-z]+$/);
    await until(() => ann.state?.phase === 'lobby', 'the lobby');
    assert.equal(ann.state.size, seats);
    assert.equal(ann.state.seats.length, seats);
    assert.equal((await ann.call('start')).ok, false, 'seats are empty');
    assert.equal((await ann.call('fillBots')).ok, true);
    await until(() => ann.state.seats.every(Boolean), 'every seat filled');
    assert.equal((await ann.call('start')).ok, true);
    await until(() => ann.state.phase === 'playing', 'the game');
    assert.equal(ann.state.factories.length, 2 * seats + 1);
    await playToEnd([ann]);
    const final = ann.state;
    checkFinal(final);
    assertViews(ann);
    assert.equal(final.bagCount + final.lid.reduce((a, b) => a + b, 0) + final.factories.flat().length + final.centre.length > 0, true);

    await sleep(120);
    const stats = await ann.stats();
    const game = gameStats(stats);
    assert.equal(game.played, 1, 'recorded exactly once');
    const mine = final.final.players[final.you];
    assert.equal(game.totalScore, mine.total);
    assert.equal(game.wins, final.winners.includes(final.you) ? 1 : 0);
    assert.equal(game.losses, final.winners.includes(final.you) ? 0 : 1);
    const extras = extrasOf(stats);
    const wall = final.seats[final.you].wall;
    assert.equal(extras.rowsCompleted, completeRows(wall));
    assert.equal(extras.columnsCompleted, completeColumns(wall));
    assert.equal(extras.colourSetsCompleted, completeSets(wall));
    assert.ok(extras.floorPenalties >= 0);
    assert.equal(extras.roundsPlayed, final.scoreboard.rounds.length - 1);
    assert.equal(stats.recent[0].players, 1, 'computer players are not recorded');
    assert.equal(stats.recent[0].placement, mine.placement);

    assert.equal((await ann.call('again')).ok, true, 'back to the lobby');
    await until(() => ann.state.phase === 'lobby', 'the lobby again');
    assert.deepEqual(ann.state.scoreboard.rounds, []);
    assert.equal(ann.state.seats.length, seats);
    await sleep(120);
    assert.equal(gameStats(await ann.stats()).played, 1, 'going back does not record it again');
  });
}

test('the free wall option plays through over sockets with people choosing columns, and the extras are right', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await named(site, ['ann', 'bob']);
  assert.equal((await ann.call('create', { seats: 3, freeWall: 'yes' })).ok, false);
  assert.equal((await ann.call('create', { seats: 3, freeWall: true })).ok, true);
  await until(() => ann.state?.settings.freeWall === true, 'the lobby with the option');
  await bob.call('join', { code: ann.state.code });
  await until(() => bob.state?.settings.freeWall === true, 'bob sees the option');
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'play');
  assert.ok(ann.state.seats.every((s) => s.wall.flat().every((c) => c === null)), 'blank walls');
  let choices = 0;
  const started = Date.now();
  while (!(ann.state.phase === 'finished' && bob.state.phase === 'finished')) {
    assert.ok(Date.now() - started < 60000, 'finishes');
    for (const p of [ann, bob]) {
      if (p.state.phase === 'tiling' && p.state.choice) {
        assert.ok(p.state.choice.columns.length > 1);
        assert.ok(p.state.choosing.includes(p.state.you));
        choices++;
      }
      await step(p).catch(() => {});
    }
    await sleep(3);
  }
  assert.ok(choices > 0, 'a person had a column to choose');
  checkFinal(ann.state);
  checkFinal(bob.state);
  assertViews(ann);
  for (const seat of ann.state.seats) {
    seat.wall.forEach((row) => assert.equal(new Set(row.filter((c) => c !== null)).size, row.filter((c) => c !== null).length, 'no repeated colour in a row'));
  }
  await sleep(120);
  assert.equal(gameStats(await ann.stats()).played, 1);
  assert.equal(gameStats(await bob.stats()).played, 1);
});

test('the lobby: codes, seat counts, hosting, kicking, the free wall option and one room per account', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob, cat, dan, eve] = await named(site, ['ann', 'bob', 'cat', 'dan', 'eve']);
  for (const bad of [1, 6, 'x', 2.5, null]) assert.equal((await ann.call('create', { seats: bad })).ok, false, `seats ${bad}`);
  await ann.call('create', {});
  assert.equal(ann.state.size, 4, 'four by default');
  assert.equal(ann.state.settings.freeWall, false, 'the free wall is off by default');
  assert.equal((await bob.call('join', { code: 'nonsense' })).ok, false);
  assert.equal((await bob.call('join', { code: 'boss-aware-you' })).ok, false, 'no such game');
  assert.equal((await bob.call('join', { code: ann.state.code })).ok, true);
  await until(() => ann.state.seats.filter(Boolean).length === 2, 'bob in the lobby');
  assert.equal(bob.state.you, 1);
  assert.equal(bob.state.hostSeat, 0);

  assert.equal((await bob.call('size', { seats: 5 })).ok, false, 'only the host');
  assert.equal((await bob.call('addBot')).ok, false);
  assert.equal((await bob.call('settings', { freeWall: true })).ok, false, 'only the host');
  assert.equal(bob.state.settings.freeWall, false);
  assert.equal((await ann.call('settings', { freeWall: 'true' })).ok, false);
  assert.equal((await ann.call('settings', { freeWall: true })).ok, true);
  await until(() => bob.state.settings.freeWall === true, 'the option shown to everyone');
  assert.equal((await ann.call('settings', { freeWall: false })).ok, true);
  await until(() => bob.state.settings.freeWall === false, 'and switched off again');
  assert.equal((await ann.call('size', { seats: 2 })).ok, true);
  await until(() => bob.state.size === 2 && bob.state.seats.length === 2, 'two seats');
  assert.equal((await cat.call('join', { code: ann.state.code })).ok, false, 'the room is full');
  assert.equal((await ann.call('size', { seats: 1 })).ok, false);
  assert.equal((await ann.call('size', { seats: 5 })).ok, true);
  assert.equal((await ann.call('create', {})).ok, false, 'one game per account');
  assert.equal((await bob.call('create', {})).ok, false);

  assert.equal((await cat.call('join', { code: ann.state.code })).ok, true);
  assert.equal((await ann.call('size', { seats: 2 })).ok, false, 'three people are seated');
  assert.equal((await ann.call('kick', { seat: 2 })).ok, true);
  await until(() => cat.state === null, 'cat removed');
  assert.equal((await cat.call('kick', { seat: 1 })).ok, false, 'not in a game');
  assert.equal((await bob.call('kick', { seat: 0 })).ok, false, 'not the host');
  assert.equal((await ann.call('kick', { seat: 0 })).ok, false, 'not yourself');
  assert.equal((await ann.call('kick', { seat: 'x' })).ok, false);
  assert.equal((await cat.call('join', { code: ann.state.code })).ok, true, 'a removed player may rejoin');

  assert.equal((await ann.call('addBot')).ok, true);
  assert.equal((await ann.call('addBot')).ok, true);
  await until(() => ann.state.seats.every(Boolean), 'five seats');
  assert.equal((await dan.call('join', { code: ann.state.code })).ok, false, 'full');
  assert.equal((await ann.call('removeBot', { seat: 1 })).ok, false, 'a person');
  assert.equal((await ann.call('removeBot', { seat: 3 })).ok, true);
  assert.equal(new Set(ann.state.seats.filter(Boolean).map((s) => s.name)).size, ann.state.seats.filter(Boolean).length, 'names are distinct');
  assert.equal((await dan.call('join', { code: ann.state.code })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state.phase === 'playing', 'the game');
  assert.equal((await eve.call('join', { code: ann.state.code })).ok, false, 'a started game cannot be joined');
  assert.equal((await ann.call('size', { seats: 3 })).ok, false);
  assert.equal((await ann.call('settings', { freeWall: true })).ok, false);
  assert.equal((await ann.call('kick', { seat: 1 })).ok, false, 'kick is lobby only');
  assert.equal((await ann.call('addBot')).ok, false);
});

test('duplicate display names are told apart: Sam, Sam (2), Sam (3)', async (t) => {
  fast();
  const site = await launch(t);
  const people = [];
  for (const username of ['sam1', 'sam2', 'sam3']) {
    const p = site.person(username);
    const registered = await p.http('POST', '/api/auth/register', { username, password: `${username} password`, displayName: 'Sam' });
    assert.equal(registered.status, 200);
    p.id = registered.data.user.id;
    await p.connect();
    people.push(p);
  }
  await people[0].call('create', { seats: 3 });
  for (const p of people.slice(1)) assert.equal((await p.call('join', { code: people[0].state.code })).ok, true);
  await until(() => people[0].state.seats.every(Boolean), 'all seated');
  assert.deepEqual(people[0].state.seats.map((s) => s.name), ['Sam', 'Sam (2)', 'Sam (3)']);
  assert.deepEqual(people[2].state.scoreboard.players.map((p) => p.name), ['Sam', 'Sam (2)', 'Sam (3)']);
});

test('everything is public except the bag: views never contain it, and the lid is only counts', async (t) => {
  fast();
  const site = await launch(t);
  const people = await named(site, ['ann', 'bob']);
  const [ann, bob] = people;
  await ann.call('create', { seats: 4 });
  await bob.call('join', { code: ann.state.code });
  await until(() => ann.state.seats[1], 'bob');
  await ann.call('fillBots');
  await ann.call('start');
  await playToEnd(people);
  for (const p of people) assertViews(p);
  // Both people see exactly the same table, apart from who "you" are.
  const strip = (s) => JSON.stringify({ ...s, you: 0, scoreboard: { ...s.scoreboard, players: s.scoreboard.players.map((x) => ({ ...x, isMe: false })) }, choice: null });
  assert.equal(strip(ann.state), strip(bob.state));
  const stats = await Promise.all(people.map((p) => p.stats()));
  for (const s of stats) assert.equal(gameStats(s).played, 1);
  assert.equal(stats[0].recent[0].players, 2);
});

test('the scoreboard history grows by one entry per round in every person\'s views, and totals equal the scores', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await named(site, ['ann', 'bob']);
  await ann.call('create', { seats: 3 });
  await bob.call('join', { code: ann.state.code });
  await until(() => ann.state.seats[1], 'bob');
  await ann.call('fillBots');
  await ann.call('start');
  await playToEnd([ann, bob]);
  for (const p of [ann, bob]) {
    const lengths = p.states.filter((s) => s?.phase === 'playing' || s?.phase === 'tiling').map((s) => s.scoreboard.rounds.length);
    assert.deepEqual(lengths, [...lengths].sort((a, b) => a - b));
    assert.equal(Math.max(...lengths), p.state.scoreboard.rounds.length - 2, 'the last round and the bonuses arrive together in the final view');
    assert.deepEqual(lengths.slice(1).map((n, i) => n - lengths[i]).filter((d) => d > 1), [], 'one entry per round while playing');
    assertViews(p);
    checkFinal(p.state);
  }
});

test('reconnects: a second socket, a new socket and a resume all find the same game', async (t) => {
  fast('5-10');
  const site = await launch(t);
  const [ann] = await named(site, ['ann']);
  await ann.call('create', { seats: 3 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'play');
  const phone = await ann.twin();
  assert.equal((await phone.call('resume')).ok, true);
  await until(() => phone.state?.phase === 'playing', 'the phone to see the game');
  assert.equal(phone.state.you, ann.state.seats.findIndex((s) => !s.bot));
  assert.equal((await phone.call('resume', { code: 'boss-aware-you' })).ok, false, 'one game per account, whatever code is asked for');
  ann.socket.close();
  await sleep(50);
  assert.equal(phone.state.seats[phone.state.you].online, true, 'still online through the phone');
  const back = await ann.twin();
  await back.call('resume', { code: ann.state.code });
  await until(() => back.state?.phase, 'the state after resuming');
  assert.equal(back.state.code, phone.state.code);
  for (let i = 0; i < 6000 && back.state.phase !== 'finished'; i++) {
    // Both sockets try to act: whichever is first wins and the other is told off politely.
    const [x, y] = await Promise.all([step(back).catch(() => false), step(phone).catch(() => false)]);
    if (!x && !y) await sleep(3);
  }
  assert.equal(back.state.phase, 'finished');
  await sleep(120);
  assert.equal(gameStats(await back.stats()).played, 1);
});

test('a person who disconnects is shown as away and the game waits for them', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await named(site, ['ann', 'bob']);
  await ann.call('create', { seats: 2 });
  await bob.call('join', { code: ann.state.code });
  await until(() => ann.state.seats.every(Boolean), 'seated');
  bob.socket.close();
  await until(() => ann.state.seats[1].online === false, 'bob shown as away');
  assert.equal(ann.state.scoreboard.players[1].away, true);
  const back = await bob.twin();
  await back.call('resume');
  await until(() => ann.state.seats[1].online === true, 'bob back');
});

test('concurrent rooms do not interfere', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob, cat, dan] = await named(site, ['ann', 'bob', 'cat', 'dan']);
  await ann.call('create', { seats: 2 });
  await cat.call('create', { seats: 3 });
  assert.notEqual(ann.state.code, cat.state.code);
  await bob.call('join', { code: ann.state.code });
  await dan.call('join', { code: cat.state.code });
  await until(() => ann.state.seats.every(Boolean), 'ann and bob');
  await cat.call('fillBots');
  await until(() => cat.state.seats.every(Boolean), 'cat and dan and a computer');
  assert.deepEqual(ann.state.seats.map((s) => s.name), ['ann', 'bob']);
  assert.ok(!cat.state.seats.some((s) => ['ann', 'bob'].includes(s.name)));
  await ann.call('start');
  await sleep(30);
  assert.equal(cat.state.phase, 'lobby', 'the other room has not started');
  await cat.call('start');
  await Promise.all([playToEnd([ann, bob]), playToEnd([cat, dan])]);
  assert.equal(ann.state.size, 2);
  assert.equal(cat.state.size, 3);
  checkFinal(ann.state);
  checkFinal(cat.state);
  await sleep(120);
  for (const p of [ann, bob, cat, dan]) assert.equal(gameStats(await p.stats()).played, 1);
  assert.equal((await ann.stats()).recent[0].players, 2);
});

test('a human who leaves mid-game is replaced by a computer, is not recorded, and the game goes on', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob, cat] = await named(site, ['ann', 'bob', 'cat']);
  await ann.call('create', { seats: 4 });
  await bob.call('join', { code: ann.state.code });
  await cat.call('join', { code: ann.state.code });
  await until(() => ann.state.seats[2], 'cat');
  await ann.call('addBot');
  await ann.call('start');
  for (let i = 0; i < 12; i++) for (const p of [ann, bob, cat]) await step(p).catch(() => {});
  assert.equal((await cat.call('leave')).ok, true);
  await until(() => cat.state === null, 'cat to be out');
  await until(() => ann.state.seats[2].bot, "a computer in cat's seat");
  assert.notEqual(ann.state.seats[2].name, 'cat');
  assert.equal((await cat.call('resume')).ok, true);
  assert.equal(cat.state, null, 'there is nothing to go back to');
  assert.equal((await cat.call('join', { code: ann.state.code })).ok, false);
  await playToEnd([ann, bob]);
  await sleep(120);
  assert.equal(gameStats(await ann.stats()).played, 1);
  assert.equal(gameStats(await bob.stats()).played, 1);
  assert.equal((await cat.stats()).perGame.length, 0, 'the leaver is not recorded');
  assert.equal((await ann.stats()).recent[0].players, 2);
});

test('when the last human leaves the room is dropped and nothing is recorded', async (t) => {
  fast('5-10');
  const site = await launch(t);
  const [ann, bob] = await named(site, ['ann', 'bob']);
  await ann.call('create', { seats: 3 });
  await bob.call('join', { code: ann.state.code });
  await until(() => ann.state.seats[1], 'bob');
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'the game');
  const code = ann.state.code;
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => ann.state.seats[1].bot, 'a computer for bob');
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => ann.state === null, 'ann to be out');
  await sleep(150);
  assert.equal((await bob.call('join', { code })).ok, false, 'the room is gone');
  assert.equal((await ann.stats()).perGame.length, 0);
  assert.equal((await bob.stats()).perGame.length, 0);
  assert.equal((await ann.call('create', {})).ok, true, 'free to start another');
});

test('a restart loses nothing: the room, its setting and the computer players carry on', async (t) => {
  fast('15-25');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azulejo-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { seats: 3, freeWall: true });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state?.phase === 'playing', 'the play to begin');
  for (let i = 0; i < 120 && ann.state.round < 2; i++) {
    await step(ann).catch(() => {});
    await sleep(15);
  }
  const code = ann.state.code;
  const before = ann.state;
  const cookie = ann.cookie;
  await sleep(150);
  await first.stop();

  const second = await launch(t, { dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  assert.equal((await again.call('resume')).ok, true);
  await until(() => again.state?.phase, 'the saved game');
  assert.equal(again.state.code, code);
  assert.equal(again.state.settings.freeWall, true, 'the free wall option survived');
  assert.equal(again.state.size, 3);
  assert.ok(again.state.seats.filter((s) => s.bot).length === 2);
  assert.ok(again.state.scoreboard.rounds.length >= before.scoreboard.rounds.length - 1);
  assert.equal(again.state.round >= before.round, true);
  fast('0-3');
  await playToEnd([again]);
  checkFinal(again.state);
  await sleep(120);
  assert.equal(gameStats(await again.stats()).played, 1);
});

test('a restart resumes the computer players even when only computers are left to move', async (t) => {
  fast('40-60');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azulejo-restart3-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { seats: 2 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state?.phase === 'playing', 'the play to begin');
  // Make a move so it is the computer's turn, then restart while it is thinking.
  await until(() => ann.state.turn === ann.state.you, 'the first player to be ann', { timeout: 3000 }).catch(() => {});
  await step(ann).catch(() => {});
  const cookie = ann.cookie;
  const movesBefore = JSON.stringify(ann.state.factories) + JSON.stringify(ann.state.centre);
  await sleep(30);
  await first.stop();
  const second = await launch(t, { dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  await again.call('resume');
  await until(() => again.state?.phase === 'playing', 'the saved game');
  await until(() => again.state.turn === again.state.you && JSON.stringify(again.state.factories) + JSON.stringify(again.state.centre) !== movesBefore, 'the computer to move again after the restart');
});

test('a restart after the game has finished does not record it a second time', async (t) => {
  fast();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azulejo-restart2-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { seats: 2 });
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
  assert.equal(gameStats(await again.stats()).played, 1);
  checkFinal(again.state);
});
