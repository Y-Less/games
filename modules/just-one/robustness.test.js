// Garbage in: every socket event of Just One, in every phase that is cheap to reach, from members and strangers, is sent
// malformed payloads. The server must stay up, answer every time with a structured failure or a harmless success, keep the
// game consistent, never show the guesser the word or anybody the clues too early, and still be able to finish a normal game.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, fuzzEvent, assertNoPollution, prototypeNames, until, sleep } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['turnsEach'],
  leave: [],
  kick: ['userId'],
  addBot: [],
  fillBots: ['count'],
  removeBot: ['seat'],
  settings: ['turnsEach'],
  start: [],
  clue: ['text'],
  guess: ['text'],
  pass: [],
  best: ['n'],
  ready: [],
};
const PHASES = ['lobby', 'clues', 'guessing', 'choosing', 'reveal', 'finished'];

/** Every state a person was sent is well formed, and nobody saw what they should not have. */
function checkStates(person) {
  let turn = 0;
  for (const s of person.states) {
    if (!s) {
      turn = 0;
      continue;
    }
    if (s.phase === 'lobby') turn = 0;
    assert.ok(s.turn >= turn, `${person.name}: the turn only moves forward`);
    turn = s.turn;
    assert.ok(['lobby', 'clues', 'guessing', 'choosing', 'reveal', 'finished', 'abandoned'].includes(s.phase), `${person.name}: phase ${s.phase}`);
    const playing = ['clues', 'guessing', 'choosing'].includes(s.phase);
    const isGuesser = s.guesser === s.you;
    if (playing && isGuesser) assert.equal(s.word, null, `${person.name}: the guesser saw the word`);
    if (playing && !isGuesser && s.players.some((p) => p.id === s.you)) assert.ok(s.word, `${person.name}: a writer must see the word`);
    if (playing && isGuesser) for (const c of s.clues) assert.deepEqual(Object.keys(c).sort(), ['n', 'text'], `${person.name}: the guesser saw who wrote a clue`);
    if (s.phase === 'clues') assert.ok(s.clues.every((c) => c.own && c.id === s.you), `${person.name}: saw somebody else's clue before they were all in`);
    const ids = s.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'no player twice');
    assert.ok(s.players.length <= s.limits.max);
  }
}

test('garbage payloads on every event, in every phase, from members and strangers', { timeout: 600000 }, async (t) => {
  const prototypes = prototypeNames();
  const site = await launchModule(t, { id: 'just-one', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const members = [ann, bob, cat];
  const guesserOf = () => members.find((p) => p.state?.guesser === p.id);
  const writers = () => members.filter((p) => p !== guesserOf());
  const hiddenWord = () => {
    const g = guesserOf();
    const w = writers()[0]?.state;
    return g && w && ['clues', 'guessing', 'choosing'].includes(g.state?.phase) && w.word ? [`"word":"${w.word}"`] : [];
  };
  const everyoneIn = (phase) => until(() => members.every((p) => p.state?.phase === phase), `everyone in ${phase}`);

  async function arrange(phase) {
    for (const p of [...members, eve]) await p.call('leave', {});
    await until(() => [...members, eve].every((p) => p.state == null), 'everyone out');
    const created = await ann.call('create', { turnsEach: 1 });
    assert.equal(created.ok, true, created.error);
    for (const p of [bob, cat]) assert.equal((await p.call('join', { code: created.code })).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'lobby' && p.state.players.length === 3), 'a lobby of three');
    if (phase === 'lobby') return;
    assert.equal((await ann.call('start', {})).ok, true);
    await everyoneIn('clues');
    if (phase === 'clues') return;
    const turn = async (how) => {
      const [a, b] = writers();
      assert.equal((await a.call('clue', { text: 'alpha' })).ok, true);
      assert.equal((await b.call('clue', { text: 'beta' })).ok, true);
      await everyoneIn('guessing');
      if (how === 'guessing') return;
      const word = a.state.word;
      assert.equal((await guesserOf().call('guess', { text: word })).ok, true);
      await everyoneIn('choosing');
      if (how === 'choosing') return;
      assert.equal((await guesserOf().call('best', { n: 0 })).ok, true);
      await everyoneIn('reveal');
    };
    if (['guessing', 'choosing'].includes(phase)) return turn(phase);
    await turn('reveal');
    if (phase === 'reveal') return;
    for (let n = 0; n < 3; n++) {
      for (const p of members) assert.equal((await p.call('ready', {})).ok, true);
      if (n < 2) {
        await everyoneIn('clues');
        await turn('reveal');
      }
    }
    await everyoneIn('finished');
  }

  let acks = 0;
  for (const phase of PHASES) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await arrange(phase);
      const guesser = guesserOf();
      const writer = writers().find((p) => p !== ann) ?? bob;
      const extra = {
        clue: [{ text: 'good' }, { text: 'two words' }, { text: 'x'.repeat(30) }, { text: '   ' }, { text: 'apple' }, { text: 'a-b' }],
        guess: [{ text: 'apple' }, { text: '   ' }, { text: 'x'.repeat(100) }, { text: 'two words' }],
        best: [{ n: 0 }, { n: 1 }, { n: -1 }, { n: 99 }, { n: '0' }, { n: 0.5 }],
        kick: [{ userId: bob.id }, { userId: cat.id }, { userId: ann.id }, { userId: 0 }, { userId: -5 }, { userId: 999999 }, { userId: String(bob.id) }],
        removeBot: [{ seat: 'bot:1' }, { seat: 'bot:0' }, { seat: ann.id }],
        fillBots: [{ count: 7 }, { count: 0 }, { count: 99 }],
        settings: [{ turnsEach: 3 }, { turnsEach: 0 }, { turnsEach: 6 }, { turnsEach: '3' }],
        create: [{ turnsEach: 3 }, { turnsEach: 99 }],
        join: [{ code: 'boss-aware-you' }, { code: 'Boss Aware You' }, { code: '?boss-aware-you' }],
        resume: [{ code: 'boss-aware-you' }, { code: 'no-such-game' }],
      }[event];
      // The host, the guesser, an ordinary writer, and someone who is not in the game at all.
      for (const who of new Set([ann, guesser, writer, eve].filter(Boolean))) {
        acks += await fuzzEvent(who, event, fields, { secrets: hiddenWord, extra: extra ?? [] });
        assert.equal((await eve.call('resume', {})).ok !== 'timeout', true, 'the server is still answering');
        if (['create', 'leave', 'start', 'kick', 'join', 'resume', 'removeBot', 'fillBots', 'addBot', 'pass', 'best', 'guess'].includes(event)) await arrange(phase);
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
  await sleep(150);
  assert.equal((await ann.stats()).perGame[0].played, before + 1);
  for (const p of members) checkStates(p);
});

test('actions from outsiders and out of turn are refused and change nothing', async (t) => {
  const site = await launchModule(t, { id: 'just-one', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { turnsEach: 1 });
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state?.players.length === 3, 'three players');
  const everyone = [ann, bob, cat];
  for (const [event, payload] of [['clue', { text: 'x' }], ['guess', { text: 'x' }], ['pass', {}], ['best', { n: 0 }], ['ready', {}]]) {
    for (const who of everyone) assert.equal((await who.call(event, payload)).ok, false, `${event} in the lobby`);
  }
  for (const [event, payload] of [['start', {}], ['clue', { text: 'x' }], ['guess', { text: 'x' }], ['pass', {}], ['best', { n: 0 }], ['kick', { userId: bob.id }], ['addBot', {}], ['settings', { turnsEach: 3 }]]) {
    assert.equal((await eve.call(event, payload)).ok, false, `${event} by an outsider`);
  }
  assert.ok((await ann.call('start')).ok);
  await until(() => everyone.every((p) => p.state?.phase === 'clues'), 'the clue phase');
  const guesser = everyone.find((p) => p.state.guesser === p.id);
  const [a, b] = everyone.filter((p) => p !== guesser);
  assert.equal((await guesser.call('guess', { text: a.state.word })).ok, false, 'no guessing before the clues are in');
  assert.equal((await guesser.call('pass')).ok, false);
  assert.equal((await a.call('guess', { text: a.state.word })).ok, false);
  assert.equal((await eve.call('clue', { text: 'x' })).ok, false);
  assert.ok((await a.call('clue', { text: 'alpha' })).ok);
  assert.equal((await a.call('clue', { text: 'again' })).ok, false, 'one clue each');
  assert.ok((await b.call('clue', { text: 'beta' })).ok);
  await until(() => guesser.state.phase === 'guessing', 'guessing');
  assert.equal((await a.call('clue', { text: 'late' })).ok, false, 'the clues are in');
  assert.equal((await a.call('pass')).ok, false, 'only the guesser passes');
  assert.equal((await a.call('best', { n: 0 })).ok, false);
  assert.equal((await guesser.call('best', { n: 0 })).ok, false, 'no best hint before a right guess');
  assert.ok((await guesser.call('guess', { text: a.state.word })).ok);
  assert.equal((await guesser.call('guess', { text: 'again' })).ok, false, 'one guess');
  assert.equal((await guesser.call('pass')).ok, false);
});
