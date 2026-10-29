// Lifecycle for Just One against the real site: rooms surviving a restart, writers sending clues at the same moment, several
// sockets for one account, people going away, and the host or the guesser leaving.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { launchModule, until, sleep } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'just-one';
const launch = (t) => launchModule(t, { id: ID, moduleDir: here });

async function gameOf(site, names, { turnsEach = 1 } = {}) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const [host, ...others] = people;
  const created = await host.call('create', { turnsEach });
  assert.equal(created.ok, true, created.error);
  for (const p of others) assert.equal((await p.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === people.length), 'everyone in the lobby');
  return { people, host, others, code: created.code, guesser: () => people.find((p) => p.state?.guesser === p.id) };
}
const allIn = (people, phase) => until(() => people.every((p) => p.state?.phase === phase), `everyone in ${phase}`);

test('a room survives a restart of the site: the clues, the cancelling and the guess are as they were, and the game can be finished', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'just-one-restart-'));
  const first = await launchModule(t, { id: ID, moduleDir: here, dataDir, keep: true });
  const people = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((n) => first.person(n).open()));
  const [ann, bob, cat, dan] = people;
  const { code } = await ann.call('create', { turnsEach: 1 });
  for (const p of [bob, cat, dan]) await p.call('join', { code });
  await ann.call('start');
  await allIn(people, 'clues');
  const guesser = people.find((p) => p.state.guesser === p.id);
  const [a, b, c] = people.filter((p) => p !== guesser);
  const word = a.state.word;
  await a.call('clue', { text: 'alpha' });
  await b.call('clue', { text: 'ALPHA' });
  await c.call('clue', { text: 'gamma' });
  await allIn(people, 'guessing');
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
    assert.deepEqual(await me.call('resume'), { ok: true, code });
    return me;
  };
  const back = Object.fromEntries(await Promise.all(['ann', 'bob', 'cat', 'dan'].map(async (n) => [n, await open(n)])));
  await until(() => Object.values(back).every((p) => p.state?.phase === 'guessing'), 'the game back');
  const g2 = back[guesser.name];
  assert.deepEqual(g2.state.clues.map((x) => x.text), ['gamma'], 'the guesser sees the one clue that was left');
  assert.equal(g2.state.word, null);
  assert.equal(back[a.name].state.word, word, 'the same word');
  assert.deepEqual(back[a.name].state.clues.filter((x) => x.cancelled).map((x) => x.id).sort(), [a.id, b.id].sort(), 'and the same cancelling');
  assert.ok((await g2.call('guess', { text: word })).ok);
  assert.ok((await g2.call('best', { n: 0 })).ok);
  await until(() => Object.values(back).every((p) => p.state.phase === 'reveal'), 'the reveal');
  assert.equal(g2.state.result.best, c.id);
  for (const p of Object.values(back)) assert.ok((await p.call('ready')).ok);
  await until(() => g2.state.phase === 'clues' && g2.state.turn === 2, 'the second turn');
});

test('writers sending clues in the same moment: all of them count, and the guessing opens once', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan', 'eve']);
  await g.host.call('start');
  await allIn(g.people, 'clues');
  const guesser = g.guesser();
  const writers = g.people.filter((p) => p !== guesser);
  const replies = await Promise.all(writers.map((p, i) => p.call('clue', { text: `word${'abcd'[i]}` })));
  assert.ok(replies.every((r) => r.ok), JSON.stringify(replies));
  await allIn(g.people, 'guessing');
  assert.equal(guesser.state.clues.length, 4, 'every clue is there');
  const again = await Promise.all(writers.map((p) => p.call('clue', { text: 'later' })));
  assert.ok(again.every((r) => !r.ok), 'and no more are taken');
});

test('one account on two sockets: both see the same game, and a clue sent from one shows on the other', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat']);
  await g.host.call('start');
  await allIn(g.people, 'clues');
  const guesser = g.guesser();
  const [a, b] = g.people.filter((p) => p !== guesser);
  const aTab = await a.twin();
  await aTab.call('resume', {});
  await until(() => aTab.state?.phase === 'clues', 'the second tab');
  assert.equal(aTab.state.word, a.state.word);
  assert.ok((await aTab.call('clue', { text: 'alpha' })).ok);
  await until(() => a.state.clues.some((c) => c.own), 'the other socket sees the clue sent');
  assert.equal((await a.call('clue', { text: 'beta' })).ok, false, 'still only one clue');
});

test('a writer who has gone away holds up the clues until the host removes them, and then the guessing opens', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan']);
  await g.host.call('start');
  await allIn(g.people, 'clues');
  const guesser = g.guesser();
  const [a, b, c] = g.people.filter((p) => p !== guesser);
  for (const s of c.sockets) s.close();
  await until(() => a.state.players.find((p) => p.id === c.id).online === false, 'one away');
  await a.call('clue', { text: 'alpha' });
  await b.call('clue', { text: 'beta' });
  await sleep(100);
  assert.equal(guesser.state.phase, 'clues', 'the clues are not in until the one who is away has written (or has been removed)');
  const host = g.host.id === c.id ? null : g.host;
  if (host) {
    assert.ok((await host.call('kick', { userId: c.id })).ok);
    await until(() => guesser.state?.phase === 'guessing', 'the guessing opens once the missing writer is removed');
    assert.equal(guesser.state.clues.length, 2);
  }
});

test('when the guesser is gone the host removes them, the turn is skipped and the next guesser starts', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan'], { turnsEach: 2 });
  await g.host.call('start');
  await allIn(g.people, 'clues');
  const guesser = g.guesser();
  if (guesser === g.host) return; // the host is the guesser this time: removal is covered by the rules tests
  for (const s of guesser.sockets) s.close();
  await until(() => g.host.state.players.find((p) => p.id === guesser.id).online === false, 'the guesser away');
  assert.ok((await g.host.call('kick', { userId: guesser.id })).ok);
  await until(() => g.host.state.players.length === 3 && g.host.state.phase === 'clues', 'a new turn');
  assert.notEqual(g.host.state.guesser, guesser.id);
  assert.equal(g.host.state.scoreboard.rounds.length, 0, 'the skipped turn scored nothing');
});

test('the host leaving passes the game on, and one account is in one game at a time', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat']);
  assert.equal((await g.others[0].call('create')).ok, false, 'already in a game');
  assert.ok((await g.host.call('leave')).ok);
  await until(() => g.others.every((p) => p.state?.players.length === 2), 'two players left');
  assert.equal(g.others[0].state.hostId, g.others[0].id, 'the next person is the host');
});
