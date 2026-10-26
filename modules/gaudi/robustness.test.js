// Garbage in: every socket event Gaudi handles gets malformed payloads (with and without an ack, from members,
// non-members and a second socket) in the lobby and in every phase of a game. The server must stay up, answer with a
// structured failure or a harmless success, keep the game state valid, never leak anything hidden and finish a
// normal game afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, garbageValues, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';
import { fast, playToEnd } from './e2e-support.js';
import { SIZES, TOOL_IDS } from './game.js';
import { PATTERN_IDS, bagSize, poolSize } from './rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every socket event, with the payload fields it reads. */
const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['seats', 'badPrivate'],
  leave: [],
  kick: ['seat'],
  settings: ['badPrivate'],
  size: ['seats'],
  addBot: ['seat'],
  removeBot: ['seat'],
  fillBots: [],
  start: [],
  window: ['pid'],
  place: ['die', 'cell'],
  tool: ['tool', 'params'],
  end: [],
  undo: [],
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
  assert.ok(['lobby', 'windows', 'playing', 'finished'].includes(s.phase), `${label}: a known phase`);
  assert.ok(SIZES.includes(s.size) && s.seats.length === s.size, `${label}: a valid seat count`);
  assert.equal(typeof s.settings.badPrivate, 'boolean', label);
  assert.ok(s.you === -1 || (s.you >= 0 && s.you < s.size && s.seats[s.you]), `${label}: seated where it says`);
  assert.ok(s.hostSeat === -1 || s.seats[s.hostSeat]?.bot === false, `${label}: the host is a person`);
  assert.equal(s.scoreboard.players.length, s.seats.filter(Boolean).length, label);
  const text = JSON.stringify(s);
  assert.ok(!/"bag":/.test(text), `${label}: no bag`);
  if (s.phase !== 'finished') assert.ok(!/privateColour/.test(text), `${label}: no private colours yet`);
  if (s.phase === 'windows') assert.ok(s.options.length === 4 && s.options.every((o) => PATTERN_IDS.includes(o.pid)), label);
  if (s.phase === 'playing' || s.phase === 'finished') {
    const dice = s.pool.length + s.track.flat().length + s.seats.reduce((n, seat) => n + (seat ? seat.window.grid.filter(Boolean).length : 0), 0) + s.bagCount;
    if (s.seats.every(Boolean)) assert.equal(dice, bagSize(s.size), `${label}: every die accounted for`);
    assert.ok(s.pool.length <= poolSize(s.size), label);
    assert.equal(s.tools.length, 3);
    assert.ok(s.tools.every((t) => TOOL_IDS.includes(t.id) && [1, 2].includes(t.cost)), label);
    assert.equal(s.publicObjectives.length, 3);
    for (const seat of s.seats) if (seat) assert.ok(seat.tokens >= 0 && seat.window.grid.length === 20, label);
  }
}

async function fuzzAll(person, names, { secrets = () => [], who = person.name, site, skip = [] } = {}) {
  let checked = 0;
  for (const event of names) {
    if (skip.includes(event)) continue;
    checked += await fuzzEvent(person, event, EVENTS[event], { secrets });
    await sleep(2);
    validateView(person.state, `${who} after ${event}`);
    assert.equal(await site.alive(), true, `the site is alive after fuzzing ${event}`);
  }
  return checked;
}

test('garbage for every socket event, in every phase, from members, outsiders and second sockets', async (t) => {
  fast('0-2');
  const before = prototypeNames();
  const site = await launchModule(t, { id: 'gaudi', moduleDir: here });
  const [ann, bob, outsider] = await Promise.all(['ann', 'bob', 'out'].map((n) => site.person(n).open()));
  const twin = await ann.twin();
  const secrets = () => {
    // Window options belonging to people other than the one being fuzzed must never come back in a reply.
    const other = bob.state?.options?.map((o) => `"${o.pid}"`) ?? [];
    return other;
  };

  // Nobody is in a game: every event except the ones that would legitimately do something to a lone account.
  let checked = await fuzzAll(outsider, Object.keys(EVENTS).filter((e) => e !== 'create'), { site, secrets, who: 'outsider' });
  assert.equal(outsider.state === null || outsider.state === undefined, true);

  // The lobby, as the host (events that would end it or start the game are exercised in the other phases).
  assert.equal((await ann.call('create', { seats: 5 })).ok, true);
  assert.equal((await bob.call('join', { code: ann.state.code })).ok, true);
  await until(() => ann.state.seats[1], 'bob');
  checked += await fuzzAll(ann, Object.keys(EVENTS), { site, secrets, skip: ['leave', 'start', 'fillBots', 'size'] });
  checked += await fuzzAll(twin, ['place', 'tool', 'end', 'window', 'settings', 'size', 'kick'], { site, secrets, who: 'twin' });
  checked += await fuzzAll(bob, Object.keys(EVENTS), { site, secrets, who: 'bob (not host)', skip: ['leave', 'start', 'fillBots', 'again'] });
  checked += await fuzzAll(outsider, ['kick', 'settings', 'size', 'start', 'window', 'place', 'tool', 'end', 'addBot', 'removeBot', 'fillBots', 'again'], { site, secrets, who: 'outsider in a lobby' });
  assert.equal(ann.state.phase, 'lobby', 'garbage did not start the game');
  assert.equal(bob.state.you, 1, 'garbage did not move anybody');
  assert.equal(outsider.state === null || outsider.state === undefined, true, 'an outsider is still outside');

  // Start the game; fuzz the window phase before anybody has chosen.
  assert.equal((await ann.call('size', { seats: 5 })).ok, true);
  assert.equal((await ann.call('fillBots')).ok, true);
  await until(() => ann.state.seats.every(Boolean), 'all seated');
  assert.equal((await ann.call('start')).ok, true);
  await until(() => bob.state?.phase === 'windows' || bob.state?.phase === 'playing', 'the windows phase');
  if (bob.state.phase === 'windows') {
    checked += await fuzzAll(bob, ['window', 'place', 'tool', 'end', 'settings', 'size', 'start', 'kick', 'addBot', 'removeBot', 'fillBots', 'resume', 'join', 'create', 'again'], { site, secrets, who: 'bob in windows' });
    checked += await fuzzAll(outsider, ['window', 'place', 'tool', 'end'], { site, secrets, who: 'outsider in windows' });
    assert.equal(bob.state.phase === 'windows' || bob.state.phase === 'playing', true);
  }
  // Choose windows the normal way, then fuzz the game itself.
  for (const p of [ann, bob]) if (p.state.phase === 'windows' && !p.state.chosen) assert.equal((await p.call('window', { pid: p.state.options[0].pid })).ok, true);
  await until(() => ann.state.phase === 'playing' && bob.state.phase === 'playing', 'the game to begin');
  checked += await fuzzAll(outsider, ['place', 'tool', 'end', 'window', 'kick', 'settings', 'size'], { site, secrets, who: 'outsider in a game' });
  checked += await fuzzAll(bob, ['place', 'tool', 'window', 'settings', 'size', 'kick', 'addBot', 'removeBot', 'fillBots', 'start', 'resume', 'join', 'create', 'again'], { site, secrets, who: 'bob playing' });
  checked += await fuzzAll(ann, ['place', 'tool', 'window', 'settings', 'size', 'kick', 'addBot', 'removeBot', 'fillBots', 'start', 'resume', 'join', 'create', 'again'], { site, secrets, who: 'ann playing' });
  assert.ok(checked > 3000, `${checked} replies checked`);
  assert.equal(ann.state.phase === 'playing' || ann.state.phase === 'finished', true);
  assert.equal(ann.state.settings.badPrivate, false);
  assert.equal(ann.state.size, 5);

  // Hostile tool payloads on the player's own turn: every tool id with every kind of garbage parameter.
  for (const tool of TOOL_IDS) {
    for (const [, value] of garbageValues().slice(0, 30)) {
      for (const p of [ann, bob]) {
        const reply = await p.call('tool', { tool, params: value });
        assert.ok(reply.ok === true || reply.ok === false, `${tool}: a structured reply`);
        if (reply.ok === false) assert.equal(typeof reply.error, 'string');
      }
    }
    validateView(ann.state, `ann after ${tool}`);
    validateView(bob.state, `bob after ${tool}`);
  }
  for (const [, cell] of garbageValues()) for (const [, die] of garbageValues().slice(0, 12)) {
    const reply = await ann.call('place', { die, cell });
    assert.ok(reply.ok === true || reply.ok === false);
  }
  assert.equal(await site.alive(), true);

  // The game is still sound and finishes.
  await playToEnd([ann, bob]);
  validateView(ann.state, 'ann finished');
  validateView(bob.state, 'bob finished');
  // Finished: the events that act on a finished game.
  checked += await fuzzAll(bob, ['place', 'tool', 'end', 'window', 'settings', 'size', 'kick', 'start', 'addBot', 'removeBot', 'fillBots'], { site, secrets, who: 'bob finished' });
  assert.equal(ann.state.phase, 'finished');
  assert.equal((await bob.call('again')).ok, false, 'only the host');
  assert.equal((await ann.call('again')).ok, true);
  await until(() => ann.state.phase === 'lobby', 'the lobby again');
  assert.equal((await ann.call('leave')).ok, true);
  assert.equal(await site.alive(), true);
  assertNoPollution(before);
  await sleep(100);
  const stats = await ann.stats();
  assert.equal(stats.perGame.find((g) => g.name === 'Gaudi').played, 1, 'one game recorded after all that');
});
