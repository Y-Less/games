// Garbage in: every socket event of Trivium, in every part of a round, from members and from strangers, is sent
// malformed payloads.  The server must stay up, answer every time with a structured failure or a harmless success,
// keep the quiz consistent, never let the right answer or anybody else's out early, and still be able to play a
// normal quiz to the end afterwards.
//
// The questions are made up (TRIVIUM_TRIVIA=test), and each site is started with the clocks the scene it is for
// needs: a part of a round that is being attacked must not move on by itself halfway through, and the only part that
// cannot be made to last is the one before it.  server.js reads the clocks as the site loads it, so setting them
// before launchModule is enough.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'trivium';
const LONG = '600000';
process.env.TRIVIUM_TRIVIA = 'test';

/** The wheel turns for ever: for the waiting room and the spin itself. */
const ON_THE_WHEEL = { TRIVIUM_SPIN_MS: LONG, TRIVIUM_ANSWER_MS: LONG, TRIVIUM_REVEAL_STEP: '100', TRIVIUM_REVEAL_HOLD: LONG, TRIVIUM_GRACE_MS: LONG };
/** The wheel stops at once and everything after it lasts for ever: for the question and the reveal. */
const ON_A_QUESTION = { ...ON_THE_WHEEL, TRIVIUM_SPIN_MS: '40' };
/** Everything is quick: for a quiz that has to reach its end. */
const QUICK = { TRIVIUM_SPIN_MS: '40', TRIVIUM_ANSWER_MS: '300', TRIVIUM_REVEAL_STEP: '5', TRIVIUM_REVEAL_HOLD: '40', TRIVIUM_GRACE_MS: '4000' };
/** Sets the clocks for the site that is about to start. */
const clocks = (which) => Object.assign(process.env, which);

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['rounds', 'perRound'],
  leave: [],
  kick: ['userId'],
  addBot: [],
  fillBots: ['count'],
  removeBot: ['seat'],
  settings: ['rounds', 'perRound'],
  colour: ['colour'],
  start: [],
  answer: ['choice', 'x', 'y'],
  again: [],
};

/** Extra payloads worth trying on each event beyond the standard battery. */
const extrasFor = (people) => ({
  answer: [{ choice: 0, x: 0.5, y: 0.5 }, { choice: 3, x: 0, y: 0 }, { choice: 3, x: 1, y: 1 }, { choice: 0, x: 1.0001, y: 0.5 }, { choice: '1', x: '0.5', y: '0.5' }, { choice: [0], x: 0.5, y: 0.5 }, { choice: 0 }],
  kick: [...people.map((p) => ({ userId: p.id })), { userId: 0 }, { userId: -5 }, { userId: 999999 }, { userId: String(people[1].id) }],
  removeBot: [{ seat: 'bot:1' }, { seat: 'bot:0' }, { seat: people[0].id }],
  fillBots: [{ count: 8 }, { count: 0 }, { count: 99 }],
  colour: [{ colour: '#ff2d95' }, { colour: '#FF2D95' }, { colour: '#ff2d95 ' }, { colour: '#123456' }],
  settings: [{ rounds: 3 }, { rounds: 0 }, { rounds: 9 }, { rounds: '3' }, { perRound: 10 }, { perRound: 11 }],
  create: [{ rounds: 2, perRound: 2 }, { rounds: 99, perRound: 1 }, { perRound: 'lots' }],
  join: [{ code: 'boss-aware-you' }, { code: 'Boss Aware You' }, { code: '?boss-aware-you' }],
  resume: [{ code: 'boss-aware-you' }, { code: 'no-such-game' }],
});

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

const PHASES = ['lobby', 'spin', 'question', 'reveal', 'finished', 'abandoned'];

/**
 * Every state a person was sent is well formed, and told them nothing they were not entitled to.
 * @param {object} person  a Person from launchModule, with every state it received
 * @returns {void}
 */
function checkStates(person) {
  let round = 0;
  for (const state of person.states) {
    if (!state) {
      round = 0; // out of a game: the next one starts again
      continue;
    }
    const text = JSON.stringify(state);
    assert.ok(PHASES.includes(state.phase), `${person.name}: phase ${state.phase}`);
    if (state.phase === 'lobby') round = 0;
    assert.ok(state.round >= round, `${person.name}: the round only moves forward`);
    round = state.round;
    assert.ok(state.round >= 1 && state.round <= state.rounds, `${person.name}: round ${state.round} of ${state.rounds}`);
    assert.ok(state.ask >= 1 && state.ask <= state.perRound, `${person.name}: question ${state.ask} of ${state.perRound}`);
    assert.ok(state.players.length <= state.limits.max);
    const ids = state.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${person.name}: no player twice`);
    const colours = state.players.map((p) => p.colour);
    assert.equal(new Set(colours).size, colours.length, `${person.name}: colours stay unique`);
    assert.ok(!text.includes('"plan"'), `${person.name}: a computer player's intentions leaked`);
    assert.ok(!text.includes('"deck"'), `${person.name}: the rest of the round leaked`);
    if (state.question) assert.ok(state.question.answers.length >= 2, `${person.name}: a question with ${state.question.answers.length} answers`);
    if (['reveal', 'finished', 'abandoned'].includes(state.phase)) continue;
    assert.equal(state.correct, null, `${person.name} was shown the answer in ${state.phase}`);
    assert.equal(state.result, null, `${person.name} was shown everybody's answers in ${state.phase}`);
    if (state.mine) assert.ok(Number.isInteger(state.mine.choice) && state.mine.choice >= 0, `${person.name}: own answer ${state.mine.choice}`);
  }
}

/**
 * Throws the whole battery at every event, in each of the phases named, on a site whose clocks hold them still.
 * @param {import('node:test').TestContext} t  the running test
 * @param {object} which  the clocks to start the site with
 * @param {string[]} phases  the phases to attack in
 * @returns {Promise<number>} how many acks were checked
 */
async function battery(t, which, phases) {
  clocks(which);
  const site = await launchModule(t, { id: ID, moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const members = [ann, bob, cat];
  const extra = extrasFor(members);

  async function arrange(phase) {
    for (const p of [...members, eve]) await p.call('leave', {});
    await until(() => [...members, eve].every((p) => p.state == null), 'everyone out');
    const created = await ann.call('create', { rounds: 1, perRound: 2 });
    assert.equal(created.ok, true, created.error);
    for (const p of [bob, cat]) assert.equal((await p.call('join', { code: created.code })).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'lobby' && p.state.players.length === 3), 'a lobby of three');
    if (phase === 'lobby') return;
    assert.equal((await ann.call('start', {})).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'spin'), 'the wheel');
    if (phase === 'spin') return;
    await until(() => members.every((p) => p.state?.phase === 'question'), 'a question', { timeout: 30000 });
    if (phase === 'question') return;
    for (const p of members) assert.equal((await p.call('answer', { choice: 0, x: 0.5, y: 0.5 })).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'reveal'), 'the reveal');
  }

  let acks = 0;
  for (const phase of phases) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await arrange(phase);
      // The host, an ordinary player, and somebody who is not in the game at all.
      for (const who of [ann, cat, eve]) {
        acks += await fuzzEvent(who, event, fields, { extra: extra[event] ?? [] });
        assert.equal((await eve.call('resume', {})).ok !== 'timeout', true, 'the server is still answering');
        if (['create', 'leave', 'start', 'kick', 'join', 'resume', 'removeBot', 'fillBots', 'addBot'].includes(event)) await arrange(phase);
      }
    }
  }
  assert.equal(await site.alive(), true);
  await sleep(100);
  for (const p of [...members, eve]) checkStates(p);
  return acks;
}

test('garbage payloads in the waiting room and on the wheel', { timeout: 900000 }, async (t) => {
  const prototypes = prototypeNames();
  const acks = await battery(t, ON_THE_WHEEL, ['lobby', 'spin']);
  assert.ok(acks > 2000, `a large battery was sent (${acks})`);
  assertNoPollution(prototypes);
});

test('garbage payloads while a question is up and while it is being revealed', { timeout: 900000 }, async (t) => {
  const prototypes = prototypeNames();
  const acks = await battery(t, ON_A_QUESTION, ['question', 'reveal']);
  assert.ok(acks > 2000, `a large battery was sent (${acks})`);
  assertNoPollution(prototypes);
});

test('garbage on a finished quiz, after which a normal one can still be played', { timeout: 600000 }, async (t) => {
  clocks(QUICK);
  const site = await launchModule(t, { id: ID, moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const members = [ann, bob];
  const finish = async () => {
    for (const p of members) await p.call('leave', {});
    const created = await ann.call('create', { rounds: 1, perRound: 1 });
    assert.equal(created.ok, true, created.error);
    assert.equal((await bob.call('join', { code: created.code })).ok, true);
    assert.equal((await ann.call('start', {})).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'finished'), 'a finished quiz', { timeout: 30000 });
  };
  let acks = 0;
  for (const [event, fields] of Object.entries(EVENTS)) {
    await finish();
    for (const who of [ann, eve]) acks += await fuzzEvent(who, event, fields);
    assert.equal((await eve.call('resume', {})).ok !== 'timeout', true);
  }
  assert.ok(acks > 500, `a battery was sent (${acks})`);
  assert.equal(await site.alive(), true);

  // And a normal quiz still plays, and is recorded.
  const before = (await ann.stats()).perGame?.[0]?.played ?? 0;
  await finish();
  await sleep(200);
  assert.ok((await ann.stats()).perGame[0].played > before);
  for (const p of [...members, eve]) checkStates(p);
});

test('actions out of their time, and from outsiders, are refused and change nothing', async (t) => {
  clocks(ON_A_QUESTION);
  const site = await launchModule(t, { id: ID, moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const created = await ann.call('create', { rounds: 1, perRound: 1 });
  assert.equal((await bob.call('join', { code: created.code })).ok, true);
  await until(() => ann.state?.players.length === 2, 'two players');

  // Before the quiz: nothing but the waiting room's own actions work.
  for (const who of [ann, bob]) assert.equal((await who.call('answer', { choice: 0, x: 0.5, y: 0.5 })).error, 'noQuestionUp');
  // Outsiders cannot touch a game they are not in.
  for (const [event, payload] of [['start', {}], ['answer', { choice: 0, x: 0.5, y: 0.5 }], ['settings', { rounds: 2 }], ['kick', { userId: bob.id }], ['colour', { colour: '#ff2d95' }], ['addBot', {}]]) {
    assert.equal((await eve.call(event, payload)).ok, false, `${event} by an outsider`);
  }
  assert.equal((await bob.call('start')).error, 'hostOnlyStart');
  assert.equal(ann.state.players.length, 2);

  assert.equal((await ann.call('start')).ok, true);
  await until(() => [ann, bob].every((p) => p.state?.question), 'a question', { timeout: 30000 });
  assert.equal((await ann.call('colour', { colour: ann.state.colours[5] })).error, 'coloursBeforeStart');
  assert.equal((await ann.call('again')).error, 'startFromMenu');
  assert.equal((await ann.call('settings', { rounds: 3 })).ok, false, 'the settings are fixed');
  assert.equal((await eve.call('answer', { choice: 0, x: 0.5, y: 0.5 })).ok, false, 'an outsider cannot answer');
  assert.equal((await ann.call('answer', { choice: 0, x: 0.5, y: 0.5 })).ok, true);
  assert.equal((await ann.call('answer', { choice: 1, x: 0.5, y: 0.5 })).error, 'alreadyAnswered');
  assert.equal(ann.state.mine.choice, 0, 'and the first answer stands');
});
