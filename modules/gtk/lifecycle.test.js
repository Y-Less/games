// Lifecycle for GTK against the real site: rooms surviving a restart, everybody writing at the same moment, several
// sockets for one account, people going away, and the host or the subject leaving.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { launchModule, until, sleep } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'gtk';
const launch = (t) => launchModule(t, { id: ID, moduleDir: here });

async function gameOf(site, names, { roundsEach = 1, seconds } = {}) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const [host, ...others] = people;
  const created = await host.call('create', { roundsEach, ...(seconds === undefined ? {} : { seconds }) });
  assert.equal(created.ok, true, created.error);
  for (const p of others) assert.equal((await p.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === people.length), 'everyone in the lobby');
  return { people, host, others, code: created.code, subject: () => people.find((p) => p.state?.isSubject) };
}
const allIn = (people, phase) => until(() => people.every((p) => p.state?.phase === phase), `everyone in ${phase}`);
const write = (p) => p.call('answers', { texts: p.state.prompts.map((_, n) => `${p.name} ${n}`) });

test('a room survives a restart of the site: the answers on the table and who wrote them are as they were, and the game can be finished', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtk-restart-'));
  const first = await launchModule(t, { id: ID, moduleDir: here, dataDir, keep: true });
  const people = await Promise.all(['ann', 'bob', 'cat', 'dan'].map((n) => first.person(n).open()));
  const [ann] = people;
  const { code } = await ann.call('create', { roundsEach: 1 });
  for (const p of people.slice(1)) await p.call('join', { code });
  await ann.call('start');
  await allIn(people, 'writing');
  const subject = people.find((p) => p.state.isSubject);
  const prompts = subject.state.prompts.slice();
  for (const p of people) assert.ok((await write(p)).ok);
  await allIn(people, 'picking');
  const answers = ann.state.options.map((o) => o.text).sort();
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
  await until(() => Object.values(back).every((p) => p.state?.phase === 'picking'), 'the game back');
  assert.deepEqual(back.ann.state.options.map((o) => o.text).sort(), answers, 'the same answers');
  assert.deepEqual(back[subject.name].state.prompts, prompts, 'the same questions');
  assert.equal(back[subject.name].state.isSubject, true, 'and the same subject');
  for (const p of Object.values(back)) {
    if (p.state.isSubject) continue;
    assert.ok((await p.call('choose', { n: p.state.options.findIndex((o) => o.canPick) })).ok);
  }
  await until(() => Object.values(back).every((p) => p.state.phase === 'reveal'), 'the reveal');
  for (const p of Object.values(back)) assert.ok((await p.call('ready')).ok);
  await until(() => back.ann.state.phase === 'picking' && back.ann.state.question === 2, 'the second question');
});

test('everybody writing in the same moment: every set of answers counts, and the picking opens once', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan', 'eve']);
  await g.host.call('start');
  await allIn(g.people, 'writing');
  const replies = await Promise.all(g.people.map((p) => write(p)));
  assert.ok(replies.every((r) => r.ok), JSON.stringify(replies));
  await allIn(g.people, 'picking');
  assert.equal(g.host.state.options.length, 5, 'every answer is there');
  const again = await Promise.all(g.people.map((p) => write(p)));
  assert.ok(again.every((r) => !r.ok), 'and no more are taken');
});

test('everybody picking in the same moment: every pick counts, and the question is scored once', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan']);
  await g.host.call('start');
  await allIn(g.people, 'writing');
  for (const p of g.people) assert.ok((await write(p)).ok);
  await allIn(g.people, 'picking');
  const pickers = g.people.filter((p) => !p.state.isSubject);
  const replies = await Promise.all(pickers.map((p) => p.call('choose', { n: p.state.options.findIndex((o) => o.canPick) })));
  assert.ok(replies.every((r) => r.ok), JSON.stringify(replies));
  await allIn(g.people, 'reveal');
  assert.equal(g.host.state.scoreboard.rounds.length, 1, 'the question was scored once');
});

test('one account on two sockets: both see the same game, and answers sent from one show on the other', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat']);
  await g.host.call('start');
  await allIn(g.people, 'writing');
  const [a] = g.people;
  const aTab = await a.twin();
  await aTab.call('resume', {});
  await until(() => aTab.state?.phase === 'writing', 'the second tab');
  assert.deepEqual(aTab.state.prompts, a.state.prompts);
  assert.ok((await aTab.call('answers', { texts: ['From the phone', 'And again'] })).ok);
  await until(() => Array.isArray(a.state.yourAnswers), 'the other socket sees the answers sent');
  assert.deepEqual(a.state.yourAnswers, ['From the phone', 'And again']);
  assert.equal((await a.call('answers', { texts: ['Once more', 'No'] })).ok, false, 'still only one set of answers');
});

test('a writer who has gone away holds the round up until the host removes them; then a computer player writes for them', async (t) => {
  process.env.GTK_BOT_DELAY = '0-5';
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan']);
  await g.host.call('start');
  await allIn(g.people, 'writing');
  const gone = g.people.find((p) => p !== g.host);
  for (const s of gone.sockets) s.close();
  await until(() => g.host.state.players.find((p) => p.id === gone.id).online === false, 'one away');
  for (const p of g.people.filter((x) => x !== gone)) assert.ok((await write(p)).ok);
  await sleep(100);
  assert.equal(g.host.state.phase, 'writing', 'the answers are not in until the one who is away has written (or has been removed)');
  assert.ok((await g.host.call('kick', { userId: gone.id })).ok);
  await until(() => g.host.state?.phase === 'picking', 'the picking opens once the computer player has written');
  assert.equal(g.host.state.players.length, 4, 'nobody is lost');
  assert.equal(g.host.state.players.filter((p) => p.bot).length, 1, 'a computer player took their place');
});

test('when the subject is gone the host removes them and a computer player answers for them: the round is not lost', async (t) => {
  process.env.GTK_BOT_DELAY = '0-5';
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat', 'dan'], { roundsEach: 1 });
  await g.host.call('start');
  await allIn(g.people, 'writing');
  const subject = g.subject();
  if (subject === g.host) return; // the host is the subject this time: removal is covered by the rules tests
  for (const s of subject.sockets) s.close();
  await until(() => g.host.state.players.find((p) => p.id === subject.id).online === false, 'the subject away');
  assert.ok((await g.host.call('kick', { userId: subject.id })).ok);
  await until(() => g.host.state.players.some((p) => p.bot && p.subject), 'the computer player is the subject');
  assert.equal(g.host.state.players.length, 4, 'nobody is lost');
  assert.equal(g.host.state.roundsTotal, 4, 'and no round is lost');
});

test('the clock answers for somebody who never writes, and the round carries on without them', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat'], { seconds: 15 });
  assert.equal(g.host.state.seconds, 15, 'the host asked for a short clock');
  await g.host.call('start');
  await allIn(g.people, 'writing');
  const quiet = g.people.find((p) => p !== g.host);
  for (const p of g.people.filter((x) => x !== quiet)) assert.ok((await write(p)).ok);
  assert.ok(g.host.state.remaining > 0 && g.host.state.remaining <= 15000, `the countdown is running (${g.host.state.remaining})`);
  await until(() => g.people.every((p) => p.state?.phase === 'picking'), 'the picking opens when the clock runs out', { timeout: 30000 });
  assert.equal(g.host.state.options.length, 3, 'an answer was made up for the one who said nothing');
  assert.equal(quiet.state.options.filter((o) => o.yours).length, 1, 'and it counts as theirs');
});

test('the clock picks for somebody who never picks, and the question is scored', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat'], { seconds: 15 });
  await g.host.call('start');
  await allIn(g.people, 'writing');
  for (const p of g.people) assert.ok((await write(p)).ok);
  await allIn(g.people, 'picking');
  const pickers = g.people.filter((p) => !p.state.isSubject);
  assert.ok((await pickers[0].call('choose', { n: pickers[0].state.options.findIndex((o) => o.canPick) })).ok);
  await until(() => g.people.every((p) => p.state?.phase === 'reveal'), 'the question is scored when the clock runs out', { timeout: 30000 });
  assert.equal(g.host.state.scoreboard.rounds.length, 1);
  assert.equal(g.host.state.remaining, null, 'and the reveal is not on that clock');
});

test('the host leaving passes the game on, and one account is in one game at a time', async (t) => {
  const site = await launch(t);
  const g = await gameOf(site, ['ann', 'bob', 'cat']);
  assert.equal((await g.others[0].call('create')).ok, false, 'already in a game');
  assert.ok((await g.host.call('leave')).ok);
  await until(() => g.others.every((p) => p.state?.players.length === 2), 'two players left');
  assert.equal(g.others[0].state.hostId, g.others[0].id, 'the next person is the host');
});

test('the reveal moves on by itself when somebody never closes the scores', async (t) => {
  process.env.GTK_NEXT_WAIT = '40';
  const site = await launch(t);
  try {
    const g = await gameOf(site, ['ann', 'bob', 'cat']);
    await g.host.call('start');
    await allIn(g.people, 'writing');
    for (const p of g.people) assert.ok((await write(p)).ok);
    await allIn(g.people, 'picking');
    for (const p of g.people.filter((x) => !x.state.isSubject)) await p.call('choose', { n: p.state.options.findIndex((o) => o.canPick) });
    await allIn(g.people, 'reveal');
    await until(() => g.host.state.phase === 'picking' && g.host.state.question === 2, 'the next question comes without anybody saying they are ready');
  } finally {
    delete process.env.GTK_NEXT_WAIT;
  }
});
