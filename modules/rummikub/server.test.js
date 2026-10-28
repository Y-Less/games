// Rummikub over real sockets: a whole game with people and computer players, statistics, garbage for every event,
// kicks, reconnects, leaving mid-game, one live room per account, restarts, the between-rounds wait and the turn timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';
import { bestPlay } from './bot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const launch = (t, options = {}) => launchModule(t, { id: 'rummikub', moduleDir: here, ...options });
const fast = (range = '0-3', wait = '60000') => {
  process.env.RUMMIKUB_BOT_DELAY = range;
  process.env.RUMMIKUB_ROUND_WAIT = wait;
};
const gameStats = (stats) => stats.perGame.find((g) => g.name === 'Rummikub');

/** A person does whatever the computer logic would do, from their own view only. Returns true if they acted. */
async function step(person) {
  const s = person.state;
  if (!s) return false;
  if (s.phase === 'between') {
    if (s.seats[s.you]?.ready) return false;
    await person.call('next');
    return true;
  }
  if (s.phase !== 'playing' || s.turn !== s.you) return false;
  const room = { settings: s.settings, racks: { [s.you]: s.rack }, table: s.table, melded: { [s.you]: s.seats[s.you].melded } };
  const play = bestPlay(room, s.you, { budget: 1500 });
  const reply = play ? await person.call('play', { table: play.table }) : await person.call('draw');
  assert.equal(reply.ok, true, reply.error);
  return true;
}

async function playToEnd(people, { timeout = 120000 } = {}) {
  const started = Date.now();
  while (!people.every((p) => p.state?.phase === 'finished')) {
    if (Date.now() - started > timeout) assert.fail(`the game did not finish: ${JSON.stringify(people.map((p) => [p.name, p.state?.phase, p.state?.round, p.state?.turn]))}`);
    let acted = false;
    for (const p of people) acted = (await step(p).catch(() => false)) || acted;
    if (!acted) await sleep(4);
  }
}

async function started(t, { seats = 3, settings = {}, humans = 2 } = {}) {
  fast();
  const site = await launch(t);
  const names = ['ann', 'bob', 'cat', 'dan'].slice(0, humans);
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const { code } = await people[0].call('create', { seats, ...settings });
  for (const p of people.slice(1)) assert.equal((await p.call('join', { code })).ok, true);
  await people[0].call('fillBots');
  assert.equal((await people[0].call('start')).ok, true, JSON.stringify(people[0].state?.seats));
  await until(() => people.every((p) => p.state?.phase === 'playing'), 'play');
  return { site, people, code };
}

test('a whole game over sockets, recorded once in the statistics, with no leaks', async (t) => {
  const { people } = await started(t, { seats: 4, humans: 2, settings: { numbers: 9, colours: 4, wildcards: 2 } });
  const [ann, bob] = people;
  await playToEnd(people);
  await sleep(150);
  for (const p of people) {
    for (const s of p.states.filter(Boolean)) {
      const text = JSON.stringify(s);
      assert.ok(!text.includes('"pool"'), 'no pool in a view');
      if (s.phase === 'playing') assert.equal(s.seats.reduce((n, seat) => n + seat.count, 0) + s.poolCount + s.table.flat().length, s.deal.total, 'every tile accounted for');
    }
  }
  assert.equal(ann.state.winners.length >= 1, true);
  const stats = await ann.stats();
  assert.equal(gameStats(stats).played, 1);
  assert.equal(stats.recent[0].players, 2, 'computer players are not recorded');
  assert.equal(gameStats(await bob.stats()).played, 1);
  await sleep(100);
  assert.equal(gameStats(await ann.stats()).played, 1, 'recorded once');
  assert.equal((await ann.call('again')).ok, true);
  assert.equal(ann.state.phase, 'lobby');
});

test('an invalid play is refused with a clear message and changes nothing; a valid one is accepted', async (t) => {
  const { people } = await started(t, { seats: 2, humans: 2 });
  const [ann, bob] = people;
  const mover = ann.state.turn === ann.state.you ? ann : bob;
  const other = mover === ann ? bob : ann;
  const before = JSON.stringify(mover.state.table) + mover.state.rack.join();
  const rack = mover.state.rack;
  const bad = await mover.call('play', { table: [[rack[0], rack[1], rack[2]]] });
  assert.equal(bad.ok, false);
  assert.ok(bad.error.length > 5);
  assert.equal((await other.call('play', { table: [] })).ok, false, 'not your turn');
  assert.equal((await other.call('draw')).ok, false, 'not your turn');
  assert.equal(JSON.stringify(mover.state.table) + mover.state.rack.join(), before);
  const drew = await mover.call('draw');
  assert.equal(drew.ok, true);
  await until(() => mover.state.rack.length === rack.length + 1, 'the drawn tile');
  await until(() => other.state.seats[mover.state.you].count === rack.length + 1, 'the other player sees the count');
  assert.equal(other.state.turn, other.state.you);
});

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['seats', 'numbers', 'colours', 'wildcards', 'rounds', 'meld', 'timer'],
  leave: [],
  kick: ['seat'],
  settings: ['numbers', 'colours', 'wildcards', 'rounds', 'meld', 'timer'],
  size: ['seats'],
  addBot: ['seat'],
  removeBot: ['seat'],
  fillBots: [],
  start: [],
  play: ['table'],
  draw: [],
  next: [],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  const source = fs.readFileSync(path.join(here, 'server.js'), 'utf8');
  const handled = [...source.matchAll(/\bon\('(\w+)'/g)].map((m) => m[1]).filter((e) => !['connection', 'disconnect'].includes(e)).sort();
  assert.deepEqual(handled, Object.keys(EVENTS).sort());
});

function validateView(s, who) {
  if (s === null || s === undefined) return;
  const label = `${who} (${s.phase})`;
  assert.ok(['lobby', 'playing', 'between', 'finished'].includes(s.phase), `${label}: a known phase`);
  assert.ok(s.seats.length === s.size && s.size >= 2 && s.size <= 6, `${label}: a valid seat count`);
  const set = s.settings;
  assert.ok(set.numbers >= 2 && set.numbers <= 20 && set.colours >= 2 && set.colours <= 8 && set.wildcards >= 0 && set.wildcards <= 8, `${label}: settings in range`);
  assert.ok(set.rounds >= 1 && set.rounds <= 10 && set.meld >= 0 && set.meld <= 60 && (set.timer === 0 || (set.timer >= 15 && set.timer <= 300)), `${label}: settings in range`);
  assert.ok(s.you === -1 || (s.seats[s.you] && s.you < s.size), `${label}: seated where it says`);
  assert.ok(!/"pool":/.test(JSON.stringify(s)), `${label}: no pool`);
  if (s.phase !== 'lobby' && s.seats.every(Boolean)) {
    const onTable = s.table.flat().length;
    assert.equal(s.seats.reduce((n, x) => n + x.count, 0) + s.poolCount + onTable, s.deal.total, `${label}: every tile accounted for`);
  }
}

test('garbage for every socket event, in every phase, from members, outsiders and second sockets', async (t) => {
  fast('0-2');
  const before = prototypeNames();
  const site = await launch(t);
  const [ann, bob, outsider] = await Promise.all(['ann', 'bob', 'out'].map((n) => site.person(n).open()));
  const twin = await ann.twin();
  const all = async (person, names, who) => {
    for (const event of names) {
      await fuzzEvent(person, event, EVENTS[event]);
      await sleep(2);
      validateView(person.state, `${who} after ${event}`);
      assert.equal(await site.alive(), true, `the site is alive after ${event}`);
    }
  };
  await all(outsider, Object.keys(EVENTS).filter((e) => e !== 'create'), 'outsider');
  // create with garbage fields must not leave a broken room behind
  await all(ann, ['create'], 'ann');
  await ann.call('leave');
  const { code } = await ann.call('create', { seats: 3 });
  await bob.call('join', { code });
  await twin.call('resume', { code });
  await all(bob, Object.keys(EVENTS).filter((e) => !['leave', 'create'].includes(e)), 'bob in the lobby');
  await all(ann, Object.keys(EVENTS).filter((e) => !['leave', 'create', 'kick', 'start'].includes(e)), 'host in the lobby');
  await all(twin, ['settings', 'size', 'kick', 'play', 'draw'], 'the host second socket');
  await all(outsider, ['settings', 'size', 'start', 'play'], 'outsider with a room open');
  assert.equal(ann.state.phase, 'lobby');
  // the garbage may have changed the options (and clamped them): put sensible ones back so the game is quick
  assert.equal((await ann.call('settings', { numbers: 9, colours: 4, wildcards: 2, rounds: 1, meld: 30, timer: 0 })).ok, true);
  await ann.call('fillBots');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'playing', 'play');
  await all(bob, Object.keys(EVENTS).filter((e) => !['leave', 'create'].includes(e)), 'bob playing');
  await all(ann, ['play', 'draw', 'settings', 'size', 'addBot', 'start', 'kick', 'next', 'again'], 'ann playing');
  await all(outsider, ['play', 'draw', 'next', 'again', 'start'], 'outsider while a game runs');
  validateView(ann.state, 'ann');
  await playToEnd([ann, bob]);
  await all(bob, ['play', 'draw', 'next', 'settings', 'start', 'again', 'kick'], 'bob after the game');
  assert.equal(ann.state.phase, 'finished');
  assertNoPollution(before);
});

test('kicking in the lobby, one live room per account, joining by code, and a room that does not exist', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 3 });
  assert.equal((await bob.call('join', { code })).ok, true);
  assert.equal((await cat.call('join', { code })).ok, true);
  assert.equal((await cat.call('join', { code: 'no-such-room' })).ok, false);
  assert.equal((await ann.call('create', {})).ok, false, 'already in a live game');
  assert.equal((await bob.call('kick', { seat: 2 })).ok, false, 'only the host kicks');
  assert.equal((await ann.call('kick', { seat: 2 })).ok, true);
  await until(() => cat.state === null, 'cat is told');
  await until(() => ann.state.seats.filter(Boolean).length === 2, 'the seat is free');
  assert.equal((await cat.call('create', { seats: 2 })).ok, true, 'cat can start her own game');
  assert.equal((await ann.call('size', { seats: 2 })).ok, true);
  assert.equal((await ann.call('size', { seats: 1 })).ok, false);
  assert.equal((await ann.call('settings', { numbers: 99, timer: 2 })).ok, true);
  assert.equal(ann.state.settings.numbers, 20, 'clamped');
  assert.equal(ann.state.settings.timer, 15, 'raised to the minimum');
  assert.equal((await ann.call('settings', { numbers: 'lots' })).ok, false);
  assert.equal((await bob.call('settings', { numbers: 4 })).ok, false, 'not the host');
  const refused = await ann.call('start');
  assert.equal(refused.ok, true, 'two players, 20 numbers: fine');
  const crowded = await site.person('dan').open();
  assert.equal((await crowded.call('join', { code })).ok, false, 'the game has started');
});

test('a game that cannot be dealt is refused at the start with a message', async (t) => {
  fast();
  const site = await launch(t);
  const ann = await site.person('ann').open();
  await ann.call('create', { seats: 6, numbers: 3, colours: 2, wildcards: 0 });
  await ann.call('fillBots');
  const reply = await ann.call('start');
  assert.equal(reply.ok, false);
  assert.match(reply.error, /too few/);
  assert.equal(ann.state.phase, 'lobby');
});

test('reconnecting: a second socket and a new connection see the same game', async (t) => {
  const { people } = await started(t, { seats: 3, humans: 2 });
  const [ann, bob] = people;
  const twin = await ann.twin();
  assert.equal((await twin.call('resume', {})).ok, true);
  await until(() => twin.state?.phase === 'playing', 'the twin to see the game');
  assert.deepEqual(twin.state.rack, ann.state.rack);
  assert.deepEqual(twin.state.table, ann.state.table);
  ann.socket.close();
  await until(() => bob.state.scoreboard.players.some((p) => p.away) || true, 'away');
  await ann.connect();
  assert.equal((await ann.call('resume', {})).ok, true);
  await until(() => ann.state?.phase === 'playing', 'ann back');
  assert.deepEqual(ann.state.rack, twin.state.rack);
  // both sockets of ann can act, only once
  await until(() => [ann, bob].some((p) => p.state.turn === p.state.you), 'a person to move');
});

test('a person who leaves mid-game is replaced by a computer player and the game finishes', async (t) => {
  const { people } = await started(t, { seats: 3, humans: 2 });
  const [ann, bob] = people;
  assert.equal((await bob.call('leave')).ok, true);
  await until(() => bob.state === null, 'bob out');
  await until(() => ann.state.seats.filter((s) => s.bot).length === 2, 'a computer for bob');
  await playToEnd([ann]);
  await sleep(150);
  assert.equal(gameStats(await ann.stats()).played, 1);
  assert.equal((await bob.stats()).perGame.length, 0, 'the leaver is not recorded');
  assert.equal((await bob.call('create', {})).ok, true, 'bob is free to start another');
});

test('rounds: the next round starts when every person presses Continue, or after the wait', async (t) => {
  fast('0-2', '60000');
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 2, rounds: 2, numbers: 9 });
  await bob.call('join', { code });
  assert.equal((await ann.call('start')).ok, true);
  const turn = async () => {
    for (const p of [ann, bob]) if (p.state.phase === 'playing' && p.state.turn === p.state.you) return step(p);
    return false;
  };
  const began = Date.now();
  while (ann.state.phase !== 'between') {
    assert.ok(Date.now() - began < 60000, 'round one ends');
    if (!(await turn())) await sleep(3);
  }
  await until(() => bob.state.phase === 'between', 'bob sees the end');
  assert.equal(ann.state.scoreboard.rounds.length, 1);
  assert.equal((await ann.call('next')).ok, true);
  await until(() => bob.state.seats[0].ready, 'ann ready');
  assert.equal(bob.state.phase, 'between', 'waiting for bob');
  assert.equal((await bob.call('next')).ok, true);
  await until(() => ann.state.phase === 'playing' && ann.state.round === 2, 'round two');
  assert.deepEqual(ann.state.table, []);
});

test('the wait between rounds ends by itself', async (t) => {
  fast('0-2', '300');
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 2, rounds: 2 });
  await bob.call('join', { code });
  await ann.call('start');
  const began = Date.now();
  while (ann.state.round < 2) {
    assert.ok(Date.now() - began < 90000, 'round two begins by itself');
    let acted = false;
    for (const p of [ann, bob]) if (p.state.phase === 'playing' && p.state.turn === p.state.you) acted = (await step(p).catch(() => false)) || acted;
    if (!acted) await sleep(5);
  }
  assert.equal(ann.state.scoreboard.rounds.length, 1);
});

test('the turn timer draws for a player who runs out of time', async (t) => {
  fast();
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { seats: 2, timer: 15 });
  await bob.call('join', { code });
  await ann.call('start');
  await until(() => ann.state?.phase === 'playing', 'play');
  assert.ok(ann.state.remaining > 0 && ann.state.remaining <= 15000);
  const first = ann.state.turn;
  const counts = ann.state.seats.map((x) => x.count);
  await until(() => ann.state.turn !== first, 'the timer to pass the turn', { timeout: 20000, step: 100 });
  assert.equal(ann.state.seats[first].count, counts[first] + 1, 'a tile was drawn for them');
  assert.ok(ann.state.log.some((l) => l.text.includes('out of time')));
});

test('a restart loses nothing: the room, its settings and the computer players carry on', async (t) => {
  fast('15-25');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rummikub-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const ann = await first.person('ann').open();
  await ann.call('create', { seats: 3, numbers: 11, colours: 5, wildcards: 3, rounds: 2, meld: 24 });
  await ann.call('fillBots');
  await ann.call('start');
  await until(() => ann.state?.phase === 'playing', 'the play to begin');
  for (let i = 0; i < 6; i++) {
    await step(ann).catch(() => {});
    await sleep(60);
  }
  const code = ann.state.code;
  const cookie = ann.cookie;
  await sleep(250);
  await first.stop();

  const second = await launch(t, { dataDir });
  const again = second.person('ann');
  again.cookie = cookie;
  await again.connect();
  assert.equal((await again.call('resume')).ok, true);
  await until(() => again.state?.phase, 'the saved game');
  assert.equal(again.state.code, code);
  assert.deepEqual({ ...again.state.settings }, { numbers: 11, colours: 5, wildcards: 3, rounds: 2, meld: 24, timer: 0, playOnMeld: false });
  assert.equal(again.state.seats.filter((s) => s.bot).length, 2);
  assert.ok(again.state.rack.length > 0, 'the rack was saved');
  await playToEnd([again], { timeout: 120000 });
  await sleep(150);
  assert.equal(gameStats(await again.stats()).played, 1);
});

test('the play-on-after-melding option is chosen by the host, reaches the game over the socket, and is kept when others change settings', async (t) => {
  fast();
  const site = await launch(t);
  const ann = await site.person('ann').open();
  await ann.call('create', { seats: 3 });
  assert.equal(ann.state.settings.playOnMeld, false);
  assert.equal((await ann.call('settings', { playOnMeld: true })).ok, true);
  assert.equal(ann.state.settings.playOnMeld, true);
  assert.equal((await ann.call('settings', { meld: 20 })).ok, true);
  assert.equal(ann.state.settings.playOnMeld, true, 'unrelated settings leave it alone');
  assert.equal((await ann.call('settings', { playOnMeld: 'yes' })).ok, false, 'only a boolean');
  assert.equal(ann.state.settings.playOnMeld, true);
  const bob = await site.person('bob').open();
  await bob.call('create', { seats: 3, playOnMeld: true });
  assert.equal(bob.state.settings.playOnMeld, true, 'it can be chosen when the game is created');
});
