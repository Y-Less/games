// Concurrency and lifecycle for Wavelength against the real site: rooms surviving a restart (solo and team), actions in
// the same tick, several sockets for one account, people going away, and the host or the psychic leaving.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { launchModule, until, sleep } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'wavelength';
const launch = (t) => launchModule(t, { id: ID, moduleDir: here });

async function gameOf(site, names, { turnsEach = 1, mode = 'solo' } = {}) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const [host, ...others] = people;
  const created = await host.call('create', { turnsEach, mode });
  assert.equal(created.ok, true, created.error);
  for (const p of others) assert.equal((await p.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === people.length), 'everyone in the lobby');
  return { people, host, others, code: created.code, psychic: () => people.find((p) => p.state?.psychic === p.id) };
}
const allIn = (people, phase) => until(() => people.every((p) => p.state?.phase === phase), `everyone in ${phase}`);

test('rooms survive a restart of the site: a guess made before it still counts, and the game can be finished', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavelength-restart-'));
  const first = await launchModule(t, { id: ID, moduleDir: here, dataDir, keep: true });
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => first.person(n).open()));
  const { code } = await ann.call('create', { turnsEach: 1 });
  await bob.call('join', { code });
  await cat.call('join', { code });
  await ann.call('start');
  await until(() => [ann, bob, cat].every((p) => p.state?.phase === 'clue'), 'the clue phase');
  const people = [ann, bob, cat];
  const psychic = people.find((p) => p.state.psychic === p.id);
  const [guesserA, guesserB] = people.filter((p) => p !== psychic);
  const target = psychic.state.target;
  assert.ok((await psychic.call('clue', { text: 'a warm evening' })).ok);
  await until(() => guesserA.state.phase === 'guessing', 'guessing');
  assert.ok((await guesserA.call('guess', { position: target })).ok);
  await first.stop();
  assert.ok(fs.existsSync(path.join(dataDir, 'site', 'modules', ID, 'rooms.json')));

  // The same data folder, a new process-worth of site. The accounts' sessions are in the same database.
  const second = await launchModule(t, { id: ID, moduleDir: here, dataDir, keep: true });
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true })); // registered last, so it runs after the site has closed
  const open = async (name) => {
    const res = await fetch(`${second.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: `${name} password` }) });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const socket = connect(`${second.base}/${ID}`, { forceNew: true, extraHeaders: { cookie } });
    t.after(() => socket.close());
    const me = { name, state: undefined, call: (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve)) };
    socket.on('state', (s) => (me.state = s));
    await new Promise((resolve) => socket.on('connect', resolve));
    return me;
  };
  const back = { ann: await open('ann'), bob: await open('bob'), cat: await open('cat') };
  for (const p of Object.values(back)) assert.deepEqual(await p.call('resume'), { ok: true, code });
  await until(() => Object.values(back).every((p) => p.state?.phase === 'guessing'), 'the game back');
  const names = new Map(people.map((p) => [p, p.name]));
  const psychic2 = back[names.get(psychic)];
  const a2 = back[names.get(guesserA)];
  const b2 = back[names.get(guesserB)];
  assert.equal(psychic2.state.target, target, 'the same target');
  assert.equal(psychic2.state.clue, 'a warm evening', 'and clue');
  assert.deepEqual(a2.state.guesses.map((g) => g.position), [target], 'and the guess made before the restart');
  assert.equal((await a2.call('guess', { position: 10 })).ok, false, 'which still counts as made');
  assert.ok((await b2.call('guess', { position: 5 })).ok);
  await until(() => Object.values(back).every((p) => p.state.phase === 'reveal'), 'the reveal');
  assert.equal(psychic2.state.result.entries.find((e) => e.id === guesserA.id).points, 4);
  for (const p of Object.values(back)) assert.ok((await p.call('ready')).ok);
  await until(() => psychic2.state.phase === 'clue' && psychic2.state.turn === 2, 'the second turn');
  await sleep(50);
});

test('a team room keeps its mode and marker over a restart, and the team can carry on', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavelength-team-restart-'));
  const first = await launchModule(t, { id: ID, moduleDir: here, dataDir, keep: true });
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => first.person(n).open()));
  const [ann, bob, cat] = people;
  const { code } = await ann.call('create', { turnsEach: 1, mode: 'team' });
  await bob.call('join', { code });
  await cat.call('join', { code });
  await ann.call('start');
  await until(() => people.every((p) => p.state?.phase === 'clue'), 'the clue phase');
  const psychic = people.find((p) => p.state.psychic === p.id);
  const [a, b] = people.filter((p) => p !== psychic);
  await psychic.call('clue', { text: 'warm' });
  await until(() => a.state.phase === 'guessing', 'guessing');
  assert.ok((await a.call('marker', { position: 37.5 })).ok);
  await until(() => b.state.marker === 37.5, 'the marker');
  await sleep(200); // saves are batched
  await first.stop();

  const second = await launchModule(t, { id: ID, moduleDir: here, dataDir, keep: true });
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true })); // registered last, so it runs after the site has closed
  const open = async (name) => {
    const res = await fetch(`${second.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: `${name} password` }) });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const socket = connect(`${second.base}/${ID}`, { forceNew: true, extraHeaders: { cookie } });
    t.after(() => socket.close());
    const me = { name, state: undefined, call: (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve)) };
    socket.on('state', (s) => (me.state = s));
    await new Promise((resolve) => socket.on('connect', resolve));
    await me.call('resume');
    return me;
  };
  const back = Object.fromEntries(await Promise.all(['ann', 'bob', 'cat'].map(async (n) => [n, await open(n)])));
  await until(() => Object.values(back).every((p) => p.state?.phase === 'guessing'), 'the game back');
  assert.equal(back[a.name].state.mode, 'team');
  assert.equal(back[a.name].state.marker, 37.5, 'the marker is where it was');
  assert.equal(back[psychic.name].state.marker, null, 'the psychic still cannot see it');
  assert.ok((await back[b.name].call('lock')).ok, 'and the team can lock it in');
  await until(() => Object.values(back).every((p) => p.state.phase === 'reveal'), 'the reveal');
  assert.equal(back[a.name].state.marker, 37.5);
});

test('two guessers locking in at the same moment: one lock wins, and everyone ends up with the same marker', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan'], { mode: 'team' });
  await g.host.call('start');
  await allIn(g.people, 'clue');
  const psychic = g.psychic();
  const guessers = g.people.filter((p) => p !== psychic);
  await psychic.call('clue', { text: 'warm' });
  await allIn(g.people, 'guessing');
  await guessers[0].call('marker', { position: 60 });
  await until(() => guessers[2].state.marker === 60, 'the marker');
  const replies = await Promise.all(guessers.map((p) => p.call('lock')));
  assert.equal(replies.filter((r) => r.ok).length, 1, 'exactly one lock succeeds');
  await allIn(g.people, 'reveal');
  assert.ok(g.people.every((p) => p.state.marker === 60));
  assert.equal(new Set(g.people.map((p) => p.state.result.lockedBy)).size, 1, 'everyone agrees who locked it');
});

test('two guessers moving the marker at once leave one marker that everybody sees', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat'], { mode: 'team' });
  await g.host.call('start');
  await allIn(g.people, 'clue');
  const psychic = g.psychic();
  const [a, b] = g.people.filter((p) => p !== psychic);
  await psychic.call('clue', { text: 'warm' });
  await allIn(g.people, 'guessing');
  const moves = [];
  for (let i = 0; i < 20; i++) moves.push(a.call('marker', { position: i }), b.call('marker', { position: 100 - i }));
  assert.ok((await Promise.all(moves)).every((r) => r.ok));
  await sleep(100);
  assert.equal(a.state.marker, b.state.marker, 'both guessers see the same marker');
  assert.ok(a.state.marker >= 0 && a.state.marker <= 100);
  assert.equal(psychic.state.marker, null);
});

test('one account on two sockets: both see the marker move, and either can move it', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat'], { mode: 'team' });
  await g.host.call('start');
  await allIn(g.people, 'clue');
  const psychic = g.psychic();
  const [a, b] = g.people.filter((p) => p !== psychic);
  const aTab = await a.twin();
  await aTab.call('resume', {});
  await psychic.call('clue', { text: 'warm' });
  await until(() => aTab.state?.phase === 'guessing', 'the second tab');
  assert.ok((await b.call('marker', { position: 22 })).ok);
  await until(() => a.state.marker === 22 && aTab.state.marker === 22, 'both sockets see it');
  assert.ok((await aTab.call('marker', { position: 77 })).ok);
  await until(() => a.state.marker === 77 && b.state.marker === 77, 'the other socket moved it for everyone');
});

test('a guesser who goes away does not stop the team locking in, though the reveal still waits for them', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat'], { mode: 'team' });
  await g.host.call('start');
  await allIn(g.people, 'clue');
  const psychic = g.psychic();
  const [a, b] = g.people.filter((p) => p !== psychic);
  await psychic.call('clue', { text: 'warm' });
  await allIn(g.people, 'guessing');
  for (const s of b.sockets) s.close();
  await until(() => psychic.state.players.find((p) => p.id === b.id).online === false, 'one away');
  assert.ok((await a.call('marker', { position: 30 })).ok);
  assert.ok((await a.call('lock')).ok, 'the people who are there are enough');
  await allIn([psychic, a], 'reveal');
  for (const p of [psychic, a]) assert.ok((await p.call('ready')).ok);
  // The one who is away has not closed the scores, so the reveal keeps waiting for them (the server's own timeout moves it on).
  await sleep(100);
  assert.equal(psychic.state.phase, 'reveal');
  assert.equal(psychic.state.players.find((p) => p.id === b.id).ready, false);
});

test('when the psychic is gone the host removes them, the turn is skipped and the next psychic starts', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan'], { turnsEach: 2 });
  await g.host.call('start');
  await allIn(g.people, 'clue');
  const psychic = g.psychic();
  const host = psychic === g.host ? g.others[0] : g.host;
  if (psychic === g.host) return; // the host is the psychic this time: removal is covered by the rules tests
  for (const s of psychic.sockets) s.close();
  await until(() => host.state.players.find((p) => p.id === psychic.id).online === false, 'the psychic away');
  assert.ok((await host.call('kick', { userId: psychic.id })).ok);
  await until(() => host.state.players.length === 3 && host.state.phase === 'clue', 'a new turn');
  assert.notEqual(host.state.psychic, psychic.id);
  assert.equal(host.state.scoreboard.rounds.length, 0, 'the skipped turn scored nothing');
});

test('the host leaving passes the game on, in either mode', async (t) => {
  const site = await launch(t);
  for (const mode of ['solo', 'team']) {
    const g = await gameOf(site, [`ann${mode}`, `bob${mode}`, `cat${mode}`], { mode });
    assert.ok((await g.host.call('leave')).ok);
    await until(() => g.others.every((p) => p.state?.players.length === 2), 'two players left');
    assert.equal(g.others[0].state.hostId, g.others[0].id, 'the next person is the host');
    assert.equal(g.others[0].state.mode, mode, 'the mode stays');
    for (const p of g.others) await p.call('leave');
  }
});

test('one game per account, and a room code only works for the room it names', async (t) => {
  const site = await launch(t);
  const [ann, bob] = await Promise.all(['ann', 'bob'].map((n) => site.person(n).open()));
  const first = await ann.call('create', { mode: 'team' });
  assert.equal((await ann.call('create', { mode: 'solo' })).ok, false, 'already in a game');
  const other = await bob.call('create', { mode: 'solo' });
  assert.notEqual(first.code, other.code);
  assert.equal((await bob.call('join', { code: first.code })).ok, false, 'bob is in his own game');
  await bob.call('leave');
  assert.ok((await bob.call('join', { code: first.code })).ok);
  assert.equal(bob.state.mode, 'team');
});
