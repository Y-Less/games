// Garbage thrown at every socket event GTK handles, in every phase, from the host, the subject, an ordinary player and
// a stranger: every reply must be a well-formed refusal or a harmless success, nothing may leak the true answer, no
// prototype may be polluted, and a normal game must still be playable to the end afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['roundsEach', 'questionsPerRound', 'seconds'],
  leave: [],
  kick: ['userId'],
  addBot: [],
  fillBots: ['count'],
  removeBot: ['seat'],
  settings: ['roundsEach', 'questionsPerRound', 'seconds'],
  start: [],
  answers: ['texts'],
  choose: ['n'],
  ready: [],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

const PHASES = ['lobby', 'writing', 'picking', 'reveal', 'finished'];

/** Every state a person was sent is well formed, and nobody saw what they should not have. */
function checkStates(person) {
  let round = 0;
  for (const s of person.states) {
    if (!s) {
      round = 0;
      continue;
    }
    if (s.phase === 'lobby') round = 0;
    assert.ok(s.round >= round, `${person.name}: the round only moves forward`);
    round = s.round;
    assert.ok(['lobby', 'writing', 'picking', 'reveal', 'finished', 'abandoned'].includes(s.phase), `${person.name}: phase ${s.phase}`);
    if (['writing', 'picking'].includes(s.phase)) {
      assert.equal(s.truth, null, `${person.name}: the true answer was sent early`);
      for (const option of s.options) assert.deepEqual(Object.keys(option).sort(), ['canPick', 'n', 'text', 'yours'], `${person.name}: saw who wrote an answer early`);
    }
    if (s.phase === 'writing') assert.deepEqual(s.options, [], `${person.name}: saw an answer before they were all in`);
    if (s.phase === 'picking') assert.ok(s.options.every((o) => (o.yours ? !o.canPick : true)), `${person.name}: was offered their own answer`);
    if (s.isSubject && s.phase === 'picking') assert.ok(s.options.every((o) => !o.canPick), `${person.name}: the subject was offered a pick`);
    const ids = s.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'no player twice');
    assert.ok(s.players.length <= s.limits.max);
    assert.ok(s.question >= 1 && s.question <= s.questionsPerRound, `${person.name}: question ${s.question}`);
    assert.ok(s.questionsPerRound >= s.limits.questions.min && s.questionsPerRound <= s.limits.questions.max, `${person.name}: questions a round`);
    assert.ok(s.seconds >= s.limits.time.min && s.seconds <= s.limits.time.max, `${person.name}: the time to answer`);
    assert.ok(s.remaining === null || (s.remaining >= 0 && s.remaining <= s.seconds * 1000), `${person.name}: the countdown is within the time allowed`);
    if (['writing', 'picking'].includes(s.phase)) assert.notEqual(s.remaining, null, `${person.name}: ${s.phase} is timed`);
    else assert.equal(s.remaining, null, `${person.name}: ${s.phase} is not timed`);
  }
}

test('garbage payloads on every event, in every phase, from members and strangers', { timeout: 900000 }, async (t) => {
  process.env.GTK_BOT_DELAY = '0-5';
  const prototypes = prototypeNames();
  const site = await launchModule(t, { id: 'gtk', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const members = [ann, bob, cat];
  const subjectOf = () => members.find((p) => p.state?.isSubject);
  // The subject's own answer while a question is open: nobody's reply may contain it.
  const hiddenTruth = () => {
    const subject = subjectOf();
    if (!subject || !['writing', 'picking'].includes(subject.state?.phase)) return [];
    const mine = subject.state.yourAnswers;
    return mine ? mine.map((text) => `"text":"${text}"`) : [];
  };
  const everyoneIn = (phase) => until(() => members.every((p) => p.state?.phase === phase), `everyone in ${phase}`);

  /** Takes the three of them from wherever they are to a fresh game in the phase asked for. */
  async function arrange(phase) {
    for (const p of [...members, eve]) await p.call('leave', {});
    await until(() => [...members, eve].every((p) => p.state == null), 'everyone out');
    const created = await ann.call('create', { roundsEach: 1 });
    assert.equal(created.ok, true, created.error);
    for (const p of [bob, cat]) assert.equal((await p.call('join', { code: created.code })).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'lobby' && p.state.players.length === 3), 'a lobby of three');
    if (phase === 'lobby') return;
    assert.equal((await ann.call('start', {})).ok, true);
    await everyoneIn('writing');
    if (phase === 'writing') return;
    // One question: everybody writes, then everybody but the subject picks something they are allowed to.
    const question = async (how) => {
      for (const p of members) if (!p.state.yourAnswers) assert.equal((await p.call('answers', { texts: p.state.prompts.map((_, n) => `${p.name} says ${p.state.round} ${n}`) })).ok, true);
      await everyoneIn('picking');
      if (how === 'picking') return;
      for (const p of members) {
        if (p.state.isSubject || p.state.yoursWasTrue) continue;
        const n = p.state.options.findIndex((o) => o.canPick);
        assert.equal((await p.call('choose', { n })).ok, true);
      }
      await everyoneIn('reveal');
    };
    if (phase === 'picking') return question('picking');
    await question('reveal');
    if (phase === 'reveal') return;
    for (let n = 0; n < 6; n++) {
      for (const p of members) await p.call('ready', {});
      if (members.every((p) => p.state?.phase === 'finished')) break;
      await until(() => members.every((p) => ['writing', 'picking'].includes(p.state?.phase)), 'the next question');
      await question('reveal');
    }
    await everyoneIn('finished');
  }

  let acks = 0;
  for (const phase of PHASES) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await arrange(phase);
      const subject = subjectOf();
      const other = members.find((p) => p !== ann && p !== subject) ?? bob;
      const extra = {
        answers: [{ texts: ['one', 'two'] }, { texts: ['one'] }, { texts: ['one', 'two', 'three'] }, { texts: ['', ''] }, { texts: ['  ', '  '] }, { texts: ['x'.repeat(200), 'y'] }, { texts: [1, 2] }, { texts: 'one' }],
        choose: [{ n: 0 }, { n: 1 }, { n: -1 }, { n: 99 }, { n: '0' }, { n: 0.5 }],
        kick: [{ userId: bob.id }, { userId: cat.id }, { userId: ann.id }, { userId: 0 }, { userId: -5 }, { userId: 999999 }, { userId: String(bob.id) }],
        removeBot: [{ seat: 'bot:1' }, { seat: 'bot:0' }, { seat: ann.id }],
        fillBots: [{ count: 8 }, { count: 0 }, { count: 99 }],
        settings: [{ roundsEach: 2 }, { roundsEach: 0 }, { roundsEach: 9 }, { roundsEach: '2' }, { questionsPerRound: 1 }, { questionsPerRound: 0 }, { questionsPerRound: 9 }, { seconds: 30 }, { seconds: 7 }, { seconds: 1000 }, { roundsEach: 2, questionsPerRound: 3, seconds: 45 }],
        create: [{ roundsEach: 2 }, { roundsEach: 99 }, { questionsPerRound: 4 }, { questionsPerRound: 0 }, { seconds: 15 }, { seconds: 1 }],
        join: [{ code: 'boss-aware-you' }, { code: 'Boss Aware You' }, { code: '?boss-aware-you' }],
        resume: [{ code: 'boss-aware-you' }, { code: 'no-such-game' }],
      }[event];
      // The host, the subject, an ordinary player, and somebody who is not in the game at all.
      for (const who of new Set([ann, subject, other, eve].filter(Boolean))) {
        acks += await fuzzEvent(who, event, fields, { secrets: hiddenTruth, extra: extra ?? [] });
        assert.equal((await eve.call('resume', {})).ok !== 'timeout', true, 'the server is still answering');
        if (['create', 'leave', 'start', 'kick', 'join', 'resume', 'removeBot', 'fillBots', 'addBot', 'answers', 'choose'].includes(event)) await arrange(phase);
      }
    }
  }
  assert.ok(acks > 4000, `a large battery was sent (${acks})`);
  assert.equal(await site.alive(), true);
  assertNoPollution(prototypes);
  await sleep(100);
  for (const p of [...members, eve]) checkStates(p);

  // A normal game can still be played to the end, and is recorded once.
  const before = (await ann.stats()).perGame?.[0]?.played ?? 0;
  await arrange('finished');
  await sleep(200);
  assert.equal((await ann.stats()).perGame[0].played, before + 1);
  for (const p of members) checkStates(p);
});

test('actions from outsiders and out of turn are refused and change nothing', async (t) => {
  const site = await launchModule(t, { id: 'gtk', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { roundsEach: 1 });
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state?.players.length === 3, 'three players');
  const everyone = [ann, bob, cat];
  for (const [event, payload] of [['answers', { texts: ['a', 'b'] }], ['choose', { n: 0 }], ['ready', {}]]) {
    for (const who of everyone) assert.equal((await who.call(event, payload)).ok, false, `${event} in the lobby`);
  }
  for (const [event, payload] of [['start', {}], ['answers', { texts: ['a', 'b'] }], ['choose', { n: 0 }], ['kick', { userId: bob.id }], ['addBot', {}], ['settings', { roundsEach: 2 }]]) {
    assert.equal((await eve.call(event, payload)).ok, false, `${event} by an outsider`);
  }
  assert.ok((await ann.call('start')).ok);
  await until(() => everyone.every((p) => p.state?.phase === 'writing'), 'the writing phase');
  const subject = everyone.find((p) => p.state.isSubject);
  const [a, b] = everyone.filter((p) => p !== subject);
  assert.equal((await subject.call('choose', { n: 0 })).ok, false, 'no picking before the answers are in');
  assert.equal((await eve.call('answers', { texts: ['a', 'b'] })).ok, false);
  assert.ok((await a.call('answers', { texts: ['A one', 'A two'] })).ok);
  assert.equal((await a.call('answers', { texts: ['again', 'again'] })).ok, false, 'one set of answers each');
  assert.ok((await b.call('answers', { texts: ['B one', 'B two'] })).ok);
  assert.ok((await subject.call('answers', { texts: ['S one', 'S two'] })).ok);
  await until(() => subject.state.phase === 'picking', 'picking');
  assert.equal((await a.call('answers', { texts: ['late', 'late'] })).ok, false, 'the answers are in');
  assert.equal((await subject.call('choose', { n: 0 })).ok, false, 'the subject does not pick');
  assert.equal((await a.call('choose', { n: a.state.options.findIndex((o) => o.yours) })).ok, false, 'not your own answer');
  assert.equal((await a.call('ready')).ok, false, 'there are no scores to close');
  assert.ok((await a.call('choose', { n: a.state.options.findIndex((o) => o.canPick) })).ok);
  assert.equal((await a.call('choose', { n: 0 })).ok, false, 'one pick each');
});
