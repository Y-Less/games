// Gaudi against the real site: accounts over HTTP, sockets, computer players on timers, statistics and restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, sleep, until } from '../../shared/testkit.js';
import { checkFinal, extrasOf, fast, playToEnd, step } from './e2e-support.js';
import { bagSize, poolSize } from './rules.js';
import { viewLeaks } from './testing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t, options = {}) => launchModule(t, { id: 'gaudi', moduleDir: here, ...options });
const named = (site, names) => Promise.all(names.map((n) => site.person(n).open()));

/** Every state a person ever received: nothing hidden, history always present. */
function assertViews(person) {
  for (const s of person.states) {
    if (!s) continue;
    assert.ok(s.scoreboard && Array.isArray(s.scoreboard.rounds), `${person.name}: a scoreboard in every view`);
    assert.ok(!('bag' in s) && !('options' in s && s.phase !== 'windows'), 'no bag, no options after the windows');
    const text = JSON.stringify(s);
    assert.ok(!/"bag":/.test(text));
    if (s.phase !== 'finished' && s.phase !== 'lobby') assert.ok(!/privateColour/.test(text), `${person.name}: no private colours before the end`);
    if (s.phase === 'windows') assert.ok(s.options.length === 4 || s.you === -1);
    if (s.phase === 'playing') {
      assert.ok(s.privateObjective?.colour, 'my own private objective');
      assert.ok(s.pool.length <= poolSize(s.size));
      assert.ok(s.bagCount <= bagSize(s.size));
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
    await until(() => ann.state.phase === 'windows' || ann.state.phase === 'playing', 'the windows');
    assert.equal(ann.state.options?.length ?? 4, 4);
    await playToEnd([ann]);
    const final = ann.state;
    checkFinal(final);
    assert.equal(final.round, 10);
    assertViews(ann);
    // Every view had history; the scoreboard grew by one entry per round.
    const lengths = ann.states.filter((s) => s?.phase === 'playing').map((s) => s.scoreboard.rounds.length);
    assert.deepEqual(lengths, [...lengths].sort((a, b) => a - b));
    assert.equal(Math.max(...lengths), 9);
    assert.equal(final.track.length, 10);
    assert.equal(final.track.flat().length + final.seats.reduce((n, s) => n + s.window.grid.filter(Boolean).length, 0), bagSize(seats), 'every die of the bag is in the track or a window');
    assert.equal(final.bagCount, 0, 'the bag is used up exactly');

    await sleep(120);
    const stats = await ann.stats();
    const game = stats.perGame.find((g) => g.name === 'Gaudi');
    assert.equal(game.played, 1, 'recorded exactly once');
    const mine = final.final.players[final.you];
    assert.equal(game.totalScore, mine.total);
    assert.equal(game.wins, final.winners.includes(final.you) ? 1 : 0);
    assert.equal(game.losses, final.winners.includes(final.you) ? 0 : 1);
    const extras = extrasOf(stats);
    assert.equal(extras.dicePlaced, final.seats[final.you].window.grid.filter(Boolean).length);
    assert.ok(extras.toolsUsed >= 0);
    assert.equal(extras.perfectWindows, final.seats[final.you].empty === 0 ? 1 : 0);
    assert.equal(extras.bestPublicObjective, Math.max(0, ...mine.publics.map((p) => p.points)));
    assert.equal(stats.recent[0].players, 1);
    assert.equal(stats.recent[0].placement, mine.placement);

    assert.equal((await ann.call('again')).ok, true, 'back to the lobby');
    await until(() => ann.state.phase === 'lobby', 'the lobby again');
    assert.deepEqual(ann.state.scoreboard.rounds, []);
    assert.equal(ann.state.seats.length, seats);
    await sleep(120);
    assert.equal((await ann.stats()).perGame.find((g) => g.name === 'Gaudi').played, 1, 'going back does not record it again');
  });
}

test('the lobby: codes, seat counts, hosting, kicking, duplicate names and one room per account', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob, cat, dan, eve] = await named(site, ['ann', 'bob', 'cat', 'dan', 'eve']);
  for (const bad of [1, 6, 'x', 2.5, null]) assert.equal((await ann.call('create', { seats: bad })).ok, false, `seats ${bad}`);
  assert.equal((await ann.call('create', { badPrivate: 'yes' })).ok, false);
  await ann.call('create', {});
  assert.equal(ann.state.size, 4, 'four by default');
  assert.equal((await bob.call('join', { code: 'nonsense' })).ok, false);
  assert.equal((await bob.call('join', { code: 'boss-aware-you' })).ok, false, 'no such game');
  assert.equal((await bob.call('join', { code: ann.state.code })).ok, true);
  await until(() => ann.state.seats.filter(Boolean).length === 2, 'bob in the lobby');
  assert.equal(bob.state.you, 1);
  assert.equal(bob.state.hostSeat, 0);

  assert.equal((await bob.call('size', { seats: 5 })).ok, false, 'only the host');
  assert.equal((await bob.call('addBot')).ok, false);
  assert.equal((await bob.call('settings', { badPrivate: true })).ok, false, 'only the host');
  assert.equal(bob.state.settings.badPrivate, false);
  assert.equal((await ann.call('settings', { badPrivate: 'true' })).ok, false);
  assert.equal((await ann.call('settings', { badPrivate: true })).ok, true);
  await until(() => bob.state.settings.badPrivate === true, 'bad private scoring shown to everyone');
  assert.equal((await ann.call('settings', { badPrivate: false })).ok, true);
  await until(() => bob.state.settings.badPrivate === false, 'and switched off again');
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
  assert.equal((await cat.call('kick', { seat: 1 })).ok, false, 'not in a game / not the host');
  assert.equal((await bob.call('kick', { seat: 0 })).ok, false);
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
  await until(() => ann.state.phase === 'windows', 'the window phase');
  assert.equal((await eve.call('join', { code: ann.state.code })).ok, false, 'a started game cannot be joined');
  assert.equal((await ann.call('size', { seats: 3 })).ok, false);
  assert.equal((await ann.call('settings', { badPrivate: true })).ok, false);
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

test('windows are chosen at the same time and stay secret until everyone has chosen', async (t) => {
  fast();
  const site = await launch(t);
  const people = await named(site, ['ann', 'bob', 'cat']);
  const [ann, bob, cat] = people;
  await ann.call('create', { seats: 3 });
  await bob.call('join', { code: ann.state.code });
  await cat.call('join', { code: ann.state.code });
  await until(() => ann.state.seats.every(Boolean), 'three seated');
  await ann.call('start');
  await until(() => people.every((p) => p.state.phase === 'windows'), 'everyone choosing');
  const all = people.map((p) => p.state.options.map((o) => o.pid));
  assert.equal(new Set(all.flat()).size, 12, 'twelve different windows dealt');
  for (const [i, p] of people.entries()) {
    assert.equal(p.state.options.length, 4);
    for (const [j, others] of all.entries()) if (i !== j) for (const pid of others) assert.ok(!JSON.stringify(p.state).includes(`"${pid}"`), `${p.name} was sent ${pid}`);
  }
  assert.equal((await bob.call('window', { pid: all[0][0] })).ok, false, 'not one of your four');
  assert.equal((await bob.call('window', { pid: all[1][1] })).ok, true);
  await until(() => ann.state.seats[1].picked, 'ann sees that bob has chosen');
  assert.equal(ann.state.seats[1].window, null, 'but not what');
  assert.ok(!JSON.stringify(ann.state).includes(`"${all[1][1]}"`));
  assert.equal(ann.state.seats[0].picked, false, 'the waiting indicator for ann herself');
  assert.equal((await bob.call('window', { pid: all[1][2] })).ok, false, 'only once');
  assert.equal((await cat.call('window', { pid: all[2][3] })).ok, true);
  await sleep(30);
  assert.equal(ann.state.phase, 'windows', 'still waiting for ann');
  assert.equal((await ann.call('window', { pid: all[0][0] })).ok, true);
  await until(() => people.every((p) => p.state.phase === 'playing'), 'the game to begin');
  assert.equal(ann.state.seats[1].window.pid, all[1][1], 'windows are public once the game begins');
  assert.equal(ann.state.pool.length, poolSize(3));
  for (const p of people) assert.deepEqual(viewLeaks({ ...fakeRoom(p), phase: 'playing' }, p.state).filter((x) => !/not visible/.test(x)), []);
});

/** Just enough of a room for viewLeaks when only a client's view is known. */
function fakeRoom(person) {
  return { bag: [], pool: person.state.pool, track: person.state.track, grids: person.state.seats.map((s) => s.window.grid), privateColours: [], options: [], phase: 'playing', seats: person.state.seats };
}

test('hidden information over many views: only your own private colour, never the bag', async (t) => {
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
  const colours = people.map((p) => p.states.filter((s) => s?.phase === 'playing').map((s) => s.privateObjective.colour));
  for (const [i, p] of people.entries()) {
    assert.equal(new Set(colours[i]).size, 1, 'a stable private colour');
    assert.equal(colours[i][0], ann.state.final.players[p.state.you].privateColour, 'it is the colour revealed at the end');
  }
  assert.notEqual(colours[0][0], colours[1][0]);
  const stats = await Promise.all(people.map((p) => p.stats()));
  for (const s of stats) assert.equal(s.perGame.find((g) => g.name === 'Gaudi').played, 1);
  assert.equal(stats[0].recent[0].players, 2);
});

test('both private scoring rules play through and the final breakdown follows the chosen one', async (t) => {
  fast();
  const site = await launch(t);
  for (const bad of [false, true]) {
    const host = site.person(`host${bad}`);
    await host.open();
    await host.call('create', { seats: 3, badPrivate: bad });
    await until(() => host.state?.phase === 'lobby' && host.state.settings.badPrivate === bad, 'the lobby');
    assert.equal((await host.call('fillBots')).ok, true);
    await host.call('start');
    await playToEnd([host]);
    assert.equal(host.state.settings.badPrivate, bad);
    assert.equal(host.state.badPrivate, bad);
    checkFinal(host.state);
    await host.call('leave');
  }
});

test('the guided tools work over the socket: cost, tokens on the card, atomic failures', async (t) => {
  fast('2-5');
  const site = await launch(t);
  const [ann] = await named(site, ['ann']);
  const easy = ['lathe', 'mirror', 'refire', 'exchange', 'kiln', 'swift-hand'];
  for (let attempt = 0; attempt < 12; attempt++) {
    await ann.call('create', { seats: 2 });
    await ann.call('fillBots');
    await ann.call('start');
    await until(() => ann.state.phase === 'windows', 'windows');
    await step(ann);
    await until(() => ann.state.phase === 'playing', 'play');
    if (ann.state.tools.some((x) => easy.includes(x.id))) break;
    await ann.call('leave');
    await until(() => ann.state === null, 'out of the room');
  }
  const tried = { used: 0, refused: 0 };
  for (let guard = 0; guard < 3000 && ann.state.phase === 'playing'; guard++) {
    const s = ann.state;
    if (s.turn.seat === s.you && !s.turn.toolUsed) {
      const me = s.seats[s.you];
      for (const tool of s.tools) {
        const die = s.pool[0];
        const params = { die: die?.id, delta: die && die.v < 6 ? 1 : -1, trackDie: s.track.flat()[0]?.id };
        if (!easy.includes(tool.id)) continue;
        const beforeTokens = me.tokens;
        const reply = await ann.call('tool', { tool: tool.id, params });
        if (reply.ok) {
          tried.used++;
          await until(() => ann.state.seats[ann.state.you].tokens === beforeTokens - tool.cost, 'tokens spent');
          const card = ann.state.tools.find((x) => x.id === tool.id);
          assert.equal(card.spent, tool.spent + tool.cost, 'the tokens sit on the card');
          assert.equal(card.cost, 2, 'it costs two from now on');
          break;
        }
        tried.refused++;
        assert.equal(typeof reply.error, 'string');
        assert.equal(ann.state.seats[ann.state.you].tokens, beforeTokens, 'a refused tool costs nothing');
      }
    }
    if (!(await step(ann))) await sleep(4);
  }
  await until(() => ann.state.phase === 'finished', 'the end');
  assert.ok(tried.used >= 1, `a tool was used (${JSON.stringify(tried)})`);
  const stats = await ann.stats();
  assert.ok(extrasOf(stats).toolsUsed >= tried.used);
});

test('reconnects: a second socket, a new socket and a resume all find the same game', async (t) => {
  fast('5-10');
  const site = await launch(t);
  const [ann] = await named(site, ['ann']);
  await ann.call('create', { seats: 3 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state.phase === 'windows', 'windows');
  const phone = await ann.twin();
  assert.equal((await phone.call('resume')).ok, true);
  await until(() => phone.state?.phase === 'windows', 'the phone to see the game');
  assert.deepEqual(phone.state.options, ann.state.options);
  assert.equal(phone.state.you, 0);
  assert.equal((await phone.call('resume', { code: 'boss-aware-you' })).ok, false, 'one game per account, whatever code is asked for');
  assert.equal((await phone.call('window', { pid: phone.state.options[0].pid })).ok, true);
  await until(() => ann.state.chosen || ann.state.phase === 'playing', 'both sockets see the choice');
  ann.socket.close();
  await sleep(50);
  assert.equal(phone.state.seats[0].online, true, 'still online through the phone');
  const back = await ann.twin();
  await back.call('resume', { code: ann.state.code });
  await until(() => back.state?.phase, 'the state after resuming');
  assert.equal(back.state.code, phone.state.code);
  for (let i = 0; i < 3000 && back.state.phase !== 'finished'; i++) {
    for (const p of [back, phone]) await step(p).catch(() => {});
    await sleep(3);
  }
  assert.equal(back.state.phase, 'finished');
  await sleep(120);
  assert.equal((await back.stats()).perGame.find((g) => g.name === 'Gaudi').played, 1);
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
  for (const p of [ann, bob, cat, dan]) assert.equal((await p.stats()).perGame.find((g) => g.name === 'Gaudi').played, 1);
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
  for (let i = 0; i < 40; i++) for (const p of [ann, bob, cat]) await step(p);
  assert.equal((await cat.call('leave')).ok, true);
  await until(() => cat.state === null, 'cat to be out');
  await until(() => ann.state.seats[2].bot, "a computer in cat's seat");
  assert.notEqual(ann.state.seats[2].name, 'cat');
  assert.equal((await cat.call('resume')).ok, true);
  assert.equal(cat.state, null, 'there is nothing to go back to');
  assert.equal((await cat.call('join', { code: ann.state.code })).ok, false);
  await playToEnd([ann, bob]);
  await sleep(120);
  assert.equal((await ann.stats()).perGame.find((g) => g.name === 'Gaudi').played, 1);
  assert.equal((await bob.stats()).perGame.find((g) => g.name === 'Gaudi').played, 1);
  assert.equal((await cat.stats()).perGame.length, 0, 'the leaver is not recorded');
  assert.equal((await ann.stats()).recent[0].players, 2);
});

test('leaving during the window phase hands the choice to a computer', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await named(site, ['ann', 'bob']);
  await ann.call('create', { seats: 2 });
  await bob.call('join', { code: ann.state.code });
  await until(() => ann.state.seats.every(Boolean), 'seated');
  await ann.call('start');
  await until(() => ann.state.phase === 'windows', 'windows');
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => ann.state.seats[1].bot, 'a computer for bob');
  await step(ann);
  await until(() => ann.state.phase === 'playing', 'the game to begin without bob');
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
  await until(() => ann.state.phase === 'windows', 'the game');
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaudi-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { seats: 3, badPrivate: true });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state?.phase === 'windows', 'the windows');
  await step(ann);
  await until(() => ann.state.phase === 'playing', 'the play to begin');
  for (let i = 0; i < 60 && ann.state.round < 2; i++) {
    await step(ann);
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
  assert.equal(again.state.settings.badPrivate, true, 'the private scoring rule survived');
  assert.equal(again.state.size, 3);
  assert.ok(again.state.seats.slice(1).every((s) => s.bot));
  assert.equal(again.state.seats[0].window.pid, before.seats[0].window.pid);
  assert.equal(again.state.privateObjective.colour, before.privateObjective.colour);
  assert.ok(again.state.scoreboard.rounds.length >= before.scoreboard.rounds.length - 1);
  fast('0-3');
  await playToEnd([again]);
  checkFinal(again.state);
  await sleep(120);
  assert.equal((await again.stats()).perGame.find((g) => g.name === 'Gaudi').played, 1);
});

test('a restart after the game has finished does not record it a second time', async (t) => {
  fast();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaudi-restart2-'));
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
  assert.equal((await again.stats()).perGame.find((g) => g.name === 'Gaudi').played, 1);
  checkFinal(again.state);
});
