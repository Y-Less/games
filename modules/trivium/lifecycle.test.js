// Concurrency and lifecycle for Trivium against the real site: a quiz surviving a restart of the site, answers that
// arrive in the same tick, one account on two devices, people going away, and the host or a player leaving in the
// middle of a question.  The questions are made up (TRIVIUM_TRIVIA=test), and the clocks are long enough that nothing
// moves on by itself while a test is looking at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connect } from 'socket.io-client';
import { launchModule, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'trivium';

process.env.TRIVIUM_TRIVIA = 'test';
process.env.TRIVIUM_SPIN_MS = '40';
process.env.TRIVIUM_REVEAL_STEP = '50';
process.env.TRIVIUM_GRACE_MS = '600000';

/**
 * How long a question and a reveal last on the site a test is about to start.  server.js reads these as the site
 * loads it, so a test sets them just before it launches; by default nothing moves on by itself at all.
 * @param {string} [answerMs]  how long a question is up for
 * @param {string} [revealHold]  how long the right answer stays up
 * @returns {void}
 */
const clocks = (answerMs = '600000', revealHold = '600000') => {
  Object.assign(process.env, { TRIVIUM_ANSWER_MS: answerMs, TRIVIUM_REVEAL_HOLD: revealHold });
};
clocks();

const launch = (t, options = {}) => launchModule(t, { id: ID, moduleDir: here, ...options });

/** A quiz with these people in it, started, with the first question up. */
async function quizOf(site, names, settings = { rounds: 1, perRound: 2 }) {
  const people = await Promise.all(names.map((n) => site.person(n).open()));
  const [host, ...rest] = people;
  const created = await host.call('create', settings);
  assert.equal(created.ok, true, created.error);
  for (const p of rest) assert.equal((await p.call('join', { code: created.code })).ok, true);
  await until(() => people.every((p) => p.state?.players.length === people.length), 'everybody in the waiting room');
  assert.equal((await host.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.question), 'a question', { timeout: 30000 });
  return { people, host, code: created.code };
}

test('a quiz survives a restart of the site: an answer given before it still counts', async (t) => {
  clocks();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-restart-'));
  const first = await launch(t, { dataDir, keep: true });
  const { people, code } = await quizOf(first, ['ann', 'bob'], { rounds: 1, perRound: 1 });
  const [ann] = people;
  const question = ann.state.question.text;
  const annId = ann.id;
  assert.equal((await ann.call('answer', { choice: 1, x: 0.2, y: 0.8 })).ok, true);
  await first.stop();
  assert.ok(fs.existsSync(path.join(dataDir, 'site', 'modules', ID, 'rooms.json')), 'the room was saved');

  // The same data folder, a new process-worth of site.  The accounts are already in that database, so they sign in.
  const second = await launch(t, { dataDir, keep: true });
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
  const back = { ann: await open('ann'), bob: await open('bob') };
  for (const p of Object.values(back)) assert.deepEqual(await p.call('resume'), { ok: true, code });
  await until(() => Object.values(back).every((p) => p.state?.question), 'the question still up after the restart');
  assert.equal(back.ann.state.question.text, question, 'the same question');
  assert.deepEqual(back.ann.state.mine, { choice: 1, x: 0.2, y: 0.8 }, 'and the same answer');
  assert.equal((await back.ann.call('answer', { choice: 0, x: 0.5, y: 0.5 })).error, 'alreadyAnswered');
  assert.equal((await back.bob.call('answer', { choice: 0, x: 0.5, y: 0.5 })).ok, true);
  await until(() => back.ann.state?.phase === 'reveal', 'the reveal');
  assert.equal(back.ann.state.result.entries.length, 2);
  assert.equal(back.ann.state.result.entries[0].id, annId, 'she answered first, before the restart');
});

test('answers sent in the same tick are all taken, once each', async (t) => {
  const site = await launch(t);
  const { people } = await quizOf(site, ['ann', 'bob', 'cat'], { rounds: 1, perRound: 1 });
  const replies = await Promise.all(people.map((p, index) => p.call('answer', { choice: index % 2, x: 0.5, y: 0.5 })));
  assert.deepEqual(replies.map((r) => r.ok), [true, true, true]);
  await until(() => people.every((p) => p.state?.phase === 'reveal'), 'the reveal');
  assert.equal(people[0].state.result.entries.length, 3);
  const ids = people[0].state.result.entries.map((e) => e.id);
  assert.equal(new Set(ids).size, 3, 'nobody answered twice');
});

test('two answers from one person in the same tick count once', async (t) => {
  const site = await launch(t);
  const { people } = await quizOf(site, ['ann', 'bob'], { rounds: 1, perRound: 1 });
  const [ann] = people;
  const both = await Promise.all([ann.call('answer', { choice: 0, x: 0.1, y: 0.1 }), ann.call('answer', { choice: 1, x: 0.9, y: 0.9 })]);
  assert.equal(both.filter((r) => r.ok).length, 1, 'one of them was taken');
  assert.equal(both.filter((r) => r.error === 'alreadyAnswered').length, 1, 'and the other refused');
});

test('one account on two devices sees the same quiz and answers once', async (t) => {
  const site = await launch(t);
  const { people } = await quizOf(site, ['ann', 'bob'], { rounds: 1, perRound: 1 });
  const [ann] = people;
  const phone = await ann.twin();
  assert.equal((await phone.call('resume', {})).ok, true);
  await until(() => phone.state?.question, 'the quiz on the second device');
  assert.equal(phone.state.question.text, ann.state.question.text);
  assert.equal((await phone.call('answer', { choice: 2, x: 0.3, y: 0.3 })).ok, true);
  await until(() => ann.state?.mine?.choice === 2, 'the answer reaching the first device too');
  assert.equal((await ann.call('answer', { choice: 0, x: 0.5, y: 0.5 })).error, 'alreadyAnswered');
});

test('somebody who closes the page shows as away, and the quiz still finishes when they come back', async (t) => {
  const site = await launch(t);
  const { people } = await quizOf(site, ['ann', 'bob'], { rounds: 1, perRound: 1 });
  const [ann, bob] = people;
  bob.closeAll();
  await until(() => ann.state?.players.find((p) => p.id === bob.id)?.online === false, 'Bob showing as away');
  assert.equal((await ann.call('answer', { choice: 0, x: 0.5, y: 0.5 })).ok, true);
  assert.equal(ann.state.phase, 'question', 'the question waits for the one who has gone');
  await bob.connect();
  assert.equal((await bob.call('resume', {})).ok, true);
  await until(() => bob.state?.question, 'Bob back on the question');
  assert.equal((await bob.call('answer', { choice: 1, x: 0.5, y: 0.5 })).ok, true);
  await until(() => ann.state?.phase === 'reveal', 'the reveal once both have answered');
});

test('a person who leaves mid-question is replaced by a computer player, which answers for them', async (t) => {
  clocks('5000'); // a computer player taking over answers within what is left of the question, so give it a short one
  const site = await launch(t);
  const { people } = await quizOf(site, ['ann', 'bob', 'cat'], { rounds: 1, perRound: 1 });
  const [ann, bob, cat] = people;
  assert.equal((await ann.call('answer', { choice: 0, x: 0.5, y: 0.5 })).ok, true);
  assert.equal((await cat.call('leave')).ok, true);
  await until(() => ann.state?.players.some((p) => p.bot), 'a computer player in her place');
  const taken = ann.state.players.find((p) => p.bot);
  assert.ok(taken.ai?.name, 'with an AI of its own');
  assert.equal(ann.state.players.length, 3, 'the table is still the same size');
  assert.equal((await bob.call('answer', { choice: 1, x: 0.5, y: 0.5 })).ok, true);
  await until(() => ann.state?.phase === 'reveal', 'the reveal once the computer player has answered too', { timeout: 30000 });
  assert.equal(ann.state.result.entries.length + ann.state.result.missed.length, 3);
  assert.equal(cat.state, null, 'and she was sent back to the menu');
});

test('the host leaving hands the room on, and the host can remove somebody mid-question', async (t) => {
  clocks();
  const site = await launch(t);
  const { people, host } = await quizOf(site, ['ann', 'bob', 'cat'], { rounds: 1, perRound: 1 });
  const [ann, bob, cat] = people;
  assert.equal((await bob.call('kick', { userId: cat.id })).error, 'hostOnlyRemove');
  assert.equal((await host.call('kick', { userId: ann.id })).ok, false, 'the host cannot remove themselves');
  assert.equal((await host.call('kick', { userId: cat.id })).ok, true);
  await until(() => cat.state === null, 'Cat back at the menu');
  assert.equal((await ann.call('leave')).ok, true);
  await until(() => bob.state?.hostId === bob.id, 'Bob is now the host');
  assert.equal(bob.state.players.length, 3, 'with computer players in the empty places');
});

test('a quiz that nobody is left in is forgotten', async (t) => {
  clocks();
  const site = await launch(t);
  const { people, code } = await quizOf(site, ['ann', 'bob'], { rounds: 1, perRound: 1 });
  for (const p of people) assert.equal((await p.call('leave')).ok, true);
  await until(() => people.every((p) => p.state === null), 'everybody out');
  const eve = await site.person('eve').open();
  assert.equal((await eve.call('join', { code })).error, 'noGameWithCode');
});

test('an invite code brings somebody into the waiting room, but not into a quiz under way', async (t) => {
  clocks();
  const site = await launch(t);
  const ann = await site.person('ann').open();
  const created = await ann.call('create', { rounds: 1, perRound: 1 });
  const bob = await site.person('bob').open();
  assert.equal((await bob.call('join', { code: created.code })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => ann.state?.question, 'a question');
  const eve = await site.person('eve').open();
  assert.equal((await eve.call('join', { code: created.code })).error, 'thatGameStarted');
  await sleep(50);
  assert.equal(ann.state.players.length, 2);
});
