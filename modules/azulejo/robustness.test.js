// Garbage in: every socket event Azulejo handles gets malformed payloads (with and without an ack, from members,
// non-members and a second socket) in the lobby and in every phase of a game. The server must stay up, answer with a
// structured failure or a harmless success, keep the game state valid, never leak the bag and finish a normal game
// afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, garbageValues, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';
import { fast, playToEnd, simpleMove, step } from './e2e-support.js';
import { SIZES } from './game.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every socket event, with the payload fields it reads. */
const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['seats', 'freeWall'],
  leave: [],
  kick: ['seat'],
  settings: ['freeWall'],
  size: ['seats'],
  addBot: ['seat'],
  removeBot: ['seat'],
  fillBots: [],
  start: [],
  move: ['source', 'colour', 'line'],
  column: ['col'],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  const source = fs.readFileSync(path.join(here, 'server.js'), 'utf8');
  const handled = [...source.matchAll(/\bon\('(\w+)'/g)].map((m) => m[1]).filter((e) => !['connection', 'disconnect'].includes(e)).sort();
  assert.deepEqual(handled, Object.keys(EVENTS).sort());
});

/** Everything a client is shown must make sense, whatever has been thrown at the server. */
function validateView(s, who) {
  if (s === null || s === undefined) return;
  const label = `${who} (${s.phase})`;
  assert.ok(['lobby', 'playing', 'tiling', 'finished'].includes(s.phase), `${label}: a known phase`);
  assert.ok(SIZES.includes(s.size) && s.seats.length === s.size, `${label}: a valid seat count`);
  assert.equal(typeof s.settings.freeWall, 'boolean', label);
  assert.ok(s.you === -1 || (s.you >= 0 && s.you < s.size && s.seats[s.you]), `${label}: seated where it says`);
  assert.ok(s.hostSeat === -1 || s.seats[s.hostSeat]?.bot === false, `${label}: the host is a person`);
  assert.equal(s.scoreboard.players.length, s.seats.filter(Boolean).length, label);
  const text = JSON.stringify(s);
  assert.ok(!/"bag":/.test(text), `${label}: no bag`);
  if (s.phase === 'playing' || s.phase === 'tiling' || s.phase === 'finished') {
    const onBoards = s.seats.reduce((n, seat) => n + (seat ? seat.lines.reduce((a, l) => a + l.count, 0) + seat.wall.flat().filter((c) => c !== null).length + seat.floor.filter((c) => c >= 0).length : 0), 0);
    const total = s.bagCount + s.lid.reduce((a, b) => a + b, 0) + s.factories.flat().length + s.centre.length + onBoards;
    if (s.seats.every(Boolean)) assert.equal(total, 100, `${label}: every tile accounted for`);
    for (const seat of s.seats) if (seat) assert.ok(seat.score >= 0 && seat.floor.length <= 7 && seat.lines.length === 5, label);
  }
}

async function fuzzAll(person, names, { who = person.name, site, skip = [] } = {}) {
  let checked = 0;
  for (const event of names) {
    if (skip.includes(event)) continue;
    checked += await fuzzEvent(person, event, EVENTS[event]);
    await sleep(2);
    validateView(person.state, `${who} after ${event}`);
    assert.equal(await site.alive(), true, `the site is alive after fuzzing ${event}`);
  }
  return checked;
}

test('garbage for every socket event, in every phase, from members, outsiders and second sockets', async (t) => {
  fast('0-2');
  const before = prototypeNames();
  const site = await launchModule(t, { id: 'azulejo', moduleDir: here });
  const [ann, bob, outsider] = await Promise.all(['ann', 'bob', 'out'].map((n) => site.person(n).open()));
  const twin = await ann.twin();

  // Nobody is in a game: every event except the one that would legitimately start a room.
  let checked = await fuzzAll(outsider, Object.keys(EVENTS).filter((e) => e !== 'create'), { site, who: 'outsider' });
  assert.equal(outsider.state === null || outsider.state === undefined, true);

  // The lobby, as the host (events that would end it or start the game are exercised in the other phases).
  assert.equal((await ann.call('create', { seats: 5 })).ok, true);
  assert.equal((await bob.call('join', { code: ann.state.code })).ok, true);
  await until(() => ann.state.seats[1], 'bob');
  checked += await fuzzAll(ann, Object.keys(EVENTS), { site, skip: ['leave', 'start', 'fillBots', 'size'] });
  checked += await fuzzAll(twin, ['move', 'column', 'settings', 'size', 'kick'], { site, who: 'twin' });
  checked += await fuzzAll(bob, Object.keys(EVENTS), { site, who: 'bob (not host)', skip: ['leave', 'start', 'fillBots', 'again'] });
  checked += await fuzzAll(outsider, ['kick', 'settings', 'size', 'start', 'move', 'column', 'addBot', 'removeBot', 'fillBots', 'again'], { site, who: 'outsider in a lobby' });
  assert.equal(ann.state.phase, 'lobby', 'garbage did not start the game');
  assert.equal(bob.state.you, 1, 'garbage did not move anybody');
  assert.equal(outsider.state === null || outsider.state === undefined, true, 'an outsider is still outside');

  // Start the game and fuzz the play.
  assert.equal((await ann.call('size', { seats: 5 })).ok, true);
  assert.equal((await ann.call('fillBots')).ok, true);
  await until(() => ann.state.seats.every(Boolean), 'all seated');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.phase === 'playing' && bob.state?.phase === 'playing', 'the game to begin');
  checked += await fuzzAll(outsider, ['move', 'column', 'kick', 'settings', 'size'], { site, who: 'outsider in a game' });
  checked += await fuzzAll(bob, ['move', 'column', 'settings', 'size', 'kick', 'addBot', 'removeBot', 'fillBots', 'start', 'resume', 'join', 'create', 'again'], { site, who: 'bob playing' });
  checked += await fuzzAll(ann, ['move', 'column', 'settings', 'size', 'kick', 'addBot', 'removeBot', 'fillBots', 'start', 'resume', 'join', 'create', 'again'], { site, who: 'ann playing' });
  assert.ok(checked > 3000, `${checked} replies checked`);
  assert.equal(ann.state.phase === 'playing' || ann.state.phase === 'finished', true);
  assert.equal(ann.state.settings.freeWall, false);
  assert.equal(ann.state.size, 5);

  // Hostile move payloads on the player's own turn: every combination of garbage fields.
  const values = garbageValues();
  for (const p of [ann, bob]) {
    for (const [, source] of values.slice(0, 20)) {
      for (const [, colour] of values.slice(0, 14)) {
        const reply = await p.call('move', { source, colour, line: 'floor' });
        assert.ok(reply.ok === true || reply.ok === false, 'a structured reply');
        if (reply.ok === false) assert.equal(typeof reply.error, 'string');
      }
    }
    for (const [, line] of values) {
      const reply = await p.call('move', { source: 'centre', colour: 0, line });
      assert.ok(reply.ok === true || reply.ok === false);
    }
    validateView(p.state, `${p.name} after hostile moves`);
  }
  assert.equal(await site.alive(), true);

  // The game is still sound and finishes.
  await playToEnd([ann, bob]);
  validateView(ann.state, 'ann finished');
  validateView(bob.state, 'bob finished');
  checked += await fuzzAll(bob, ['move', 'column', 'settings', 'size', 'kick', 'start', 'addBot', 'removeBot', 'fillBots'], { site, who: 'bob finished' });
  assert.equal(ann.state.phase, 'finished');
  assert.equal((await bob.call('again')).ok, false, 'only the host');
  assert.equal((await ann.call('again')).ok, true);
  await until(() => ann.state.phase === 'lobby', 'the lobby again');
  assert.equal((await ann.call('leave')).ok, true);
  assert.equal(await site.alive(), true);
  assertNoPollution(before);
  await sleep(100);
  const stats = await ann.stats();
  assert.equal(stats.perGame.find((g) => g.name === 'Azulejo').played, 1, 'one game recorded after all that');
});

test('garbage while a free-wall player has a column to choose, and from the others', async (t) => {
  fast('0-2');
  const site = await launchModule(t, { id: 'azulejo', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  assert.equal((await ann.call('create', { seats: 2, freeWall: true })).ok, true);
  await bob.call('join', { code: ann.state.code });
  await until(() => ann.state.seats.every(Boolean), 'seated');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing', 'play');
  // Play on until somebody has a choice pending, then throw garbage at the column event from everyone.
  let fuzzed = false;
  for (let guard = 0; guard < 4000 && !fuzzed; guard++) {
    const chooser = [ann, bob].find((p) => p.state?.phase === 'tiling' && p.state.choice);
    if (chooser) {
      const other = chooser === ann ? bob : ann;
      const row = chooser.state.choice.row;
      await fuzzAll(other, ['column', 'move', 'start', 'size', 'settings'], { site, who: 'the other player during tiling' });
      const afterOther = chooser.state;
      assert.ok(afterOther.phase === 'tiling' || afterOther.phase === 'playing');
      if (afterOther.phase === 'tiling' && afterOther.choice) assert.equal(afterOther.choice.row, row, 'garbage from the other changed nothing');
      await fuzzEvent(chooser, 'column', ['col'], {});
      validateView(chooser.state, 'the chooser after garbage');
      fuzzed = true;
    } else {
      for (const p of [ann, bob]) await step(p).catch(() => {});
      await sleep(2);
    }
  }
  assert.equal(fuzzed, true, 'a column choice came up');
  await playToEnd([ann, bob]);
  validateView(ann.state, 'finished');
  assert.equal(await site.alive(), true);
});

test('hostile people cannot steal a turn, act out of turn or pick a source that is empty', async (t) => {
  fast('0-2');
  const site = await launchModule(t, { id: 'azulejo', moduleDir: here });
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  await ann.call('create', { seats: 2 });
  await bob.call('join', { code: ann.state.code });
  await until(() => ann.state.seats.every(Boolean), 'seated');
  await ann.call('start');
  await until(() => ann.state.phase === 'playing' && bob.state?.phase === 'playing', 'play');
  const mover = ann.state.turn === ann.state.you ? ann : bob;
  const other = mover === ann ? bob : ann;
  const move = simpleMove(mover.state);
  const stolen = await other.call('move', move);
  assert.equal(stolen.ok, false);
  assert.match(stolen.error, /not your turn/);
  const empty = await mover.call('move', { source: 'centre', colour: 0, line: 0 });
  assert.equal(empty.ok, false, 'the centre is empty at the start');
  const ok = await mover.call('move', move);
  assert.equal(ok.ok, true);
  const again = await mover.call('move', move);
  assert.equal(again.ok, false, 'not twice in a row');
});
