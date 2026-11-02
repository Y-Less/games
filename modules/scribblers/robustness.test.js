// Garbage in: every socket event of Scribblers, in every phase that is cheap to reach, from the host, the drawer, a
// guesser and somebody who is not in the game at all, is sent malformed payloads.  The server must stay up, answer
// every time with a structured failure or a harmless success, never leak the word to a guesser, keep the game
// consistent, and still be able to finish a normal game afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Short waits, so that reaching a phase is quick, but long enough that a phase holds still while it is being attacked.
process.env.SCRIBBLERS_CHOOSE_WAIT = '20000';
process.env.SCRIBBLERS_BETWEEN_WAIT = '400';
process.env.SCRIBBLERS_SCORES_WAIT = '20000';
process.env.SCRIBBLERS_AWAY_WAIT = '20000';
process.env.SCRIBBLERS_BOT_DELAY = '50-150';
process.env.SCRIBBLERS_BOT_DRAW = '100';
process.env.SCRIBBLERS_PICTURES = 'test'; // a computer player draws without reaching for the web


const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['rounds', 'drawTime', 'wordChoices'],
  leave: [],
  kick: ['userId'],
  addBot: [],
  fillBots: ['count'],
  removeBot: ['seat'],
  settings: ['rounds', 'drawTime', 'wordChoices'],
  start: [],
  again: [],
  word: ['n'],
  guess: ['text'],
  ready: [],
  line: ['x', 'y', 'x2', 'y2', 'c', 'w'],
  fill: ['x', 'y', 'c'],
  draw: ['ops'],
  clear: [],
  undo: [],
  canvas: [],
};

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

const PHASES = ['lobby', 'choosing', 'drawing', 'between', 'scores', 'finished'];

/** Every state a person was sent is well formed, and nobody saw what they should not have. */
function checkStates(person) {
  for (const state of person.states) {
    if (!state) continue;
    assert.ok(['lobby', 'choosing', 'drawing', 'between', 'scores', 'finished'].includes(state.phase), `${person.name}: phase ${state.phase}`);
    const member = state.players.some((p) => p.id === state.you);
    const guessing = state.phase === 'drawing' && member && !state.youDraw && !state.youGuessed;
    if (guessing) {
      assert.equal(state.word, null, `${person.name}: a guesser saw the word`);
      assert.ok(state.hints.some((h) => h.ch === null), `${person.name}: a guesser saw every letter`);
    }
    if (state.choices.length) assert.equal(state.youDraw, true, `${person.name}: saw the words on offer`);
    for (const line of state.feed) {
      if (line.kind === 'correct') assert.equal(line.text, '', `${person.name}: a right guess was shown`);
      if (line.kind === 'close') assert.equal(line.id, state.you, `${person.name}: told about somebody else's close guess`);
    }
    const ids = state.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'no player twice');
    assert.ok(state.players.length <= state.limits.max);
    assert.ok(state.round <= state.rounds);
  }
}

test('garbage payloads on every event, in every phase, from members and strangers', { timeout: 900000 }, async (t) => {
  const prototypes = prototypeNames();
  const site = await launchModule(t, { id: 'scribblers', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const members = [ann, bob, cat];
  const drawerNow = () => members.find((p) => p.state?.youDraw);
  // The word, while somebody is still guessing: it must never appear in a reply to one of them.
  const hiddenWord = () => {
    const drawer = drawerNow();
    const word = drawer?.state?.word;
    return word && drawer.state.phase === 'drawing' && members.some((p) => p !== drawer && !p.state?.youGuessed) ? [`"${word}"`] : [];
  };
  const everyoneIn = (phase) => until(() => members.every((p) => p.state?.phase === phase), `everyone in ${phase}`);

  /** Puts the three of them in a fresh game and plays it as far as `phase`. */
  async function arrange(phase) {
    for (const person of [...members, eve]) await person.call('leave', {});
    await until(() => [...members, eve].every((p) => p.state == null), 'everyone out');
    const created = await ann.call('create', { rounds: 2, drawTime: 30, wordChoices: 3 });
    assert.equal(created.ok, true, created.error);
    for (const person of [bob, cat]) assert.equal((await person.call('join', { code: created.code })).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'lobby' && p.state.players.length === 3), 'a lobby of three');
    if (phase === 'lobby') return;
    assert.equal((await ann.call('start')).ok, true);
    await everyoneIn('choosing');
    if (phase === 'choosing') return;

    /** Plays one turn: the drawer chooses, then everybody guesses, which ends it. */
    const turn = async (how) => {
      await everyoneIn('choosing');
      const drawer = drawerNow();
      assert.equal((await drawer.call('word', { n: 0 })).ok, true);
      await everyoneIn('drawing');
      if (how === 'drawing') return;
      const word = drawer.state.word;
      for (const person of members.filter((p) => p !== drawer)) assert.equal((await person.call('guess', { text: word })).ok, true);
      await until(() => members.every((p) => p.state?.phase !== 'drawing'), 'the turn is over');
    };

    if (phase === 'drawing') return turn('drawing');
    await turn('over');
    if (phase === 'between') return; // it lasts only a moment, so this is "just after a turn ended"
    for (let n = 0; n < 2; n++) await turn('over'); // the rest of the round
    await until(() => members.every((p) => ['scores', 'finished'].includes(p.state?.phase)), 'the round is over');
    if (phase === 'scores') return;
    for (const person of members) await person.call('ready', {});
    for (let n = 0; n < 3; n++) await turn('over');
    await until(() => members.every((p) => p.state?.phase === 'finished'), 'the game is over');
  }

  let acks = 0;
  for (const phase of PHASES) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await arrange(phase);
      const drawer = drawerNow() ?? ann;
      const guesser = members.find((p) => p !== drawer) ?? bob;
      const extra = {
        word: [{ n: 0 }, { n: 1 }, { n: -1 }, { n: 99 }, { n: '0' }, { n: 0.5 }],
        guess: [{ text: 'house' }, { text: '   ' }, { text: 'x'.repeat(200) }, { text: 'two words here' }],
        line: [{ x: 0, y: 0, x2: 10, y2: 10, c: 0, w: 8 }, { x: -9999, y: 9999, x2: 0, y2: 0, c: 25, w: 32 }, { c: 26 }, { w: 1000 }],
        fill: [{ x: 5, y: 5, c: 3 }, { x: -1, y: 5, c: 3 }, { x: 1600, y: 900, c: 3 }],
        draw: [{ ops: [] }, { ops: [{ t: 'line', x: 1, y: 1, x2: 2, y2: 2, c: 1, w: 8 }] }, { ops: 'lots' }, { ops: Array.from({ length: 2000 }, () => ({ t: 'line', x: 1, y: 1, x2: 2, y2: 2, c: 1, w: 8 })) }],
        kick: [{ userId: bob.id }, { userId: ann.id }, { userId: 0 }, { userId: -5 }, { userId: 999999 }, { userId: String(bob.id) }],
        removeBot: [{ seat: 'bot:1' }, { seat: 'bot:0' }, { seat: ann.id }],
        fillBots: [{ count: 7 }, { count: 0 }, { count: 99 }],
        settings: [{ rounds: 3 }, { rounds: 0 }, { drawTime: 1 }, { drawTime: '60' }, { wordChoices: 99 }],
        create: [{ rounds: 3 }, { rounds: 99 }, { drawTime: 60 }],
        join: [{ code: 'boss-aware-you' }, { code: 'Boss Aware You' }, { code: '?boss-aware-you' }],
        resume: [{ code: 'boss-aware-you' }, { code: 'no-such-game' }],
      }[event];
      for (const who of new Set([ann, drawer, guesser, eve].filter(Boolean))) {
        acks += await fuzzEvent(who, event, fields, { secrets: hiddenWord, extra: extra ?? [] });
        assert.equal((await eve.call('resume', {})).ok !== 'timeout', true, 'the server is still answering');
        // These events can take the table apart, so the phase is set up again before the next attacker.
        if (['create', 'leave', 'start', 'kick', 'join', 'resume', 'removeBot', 'fillBots', 'addBot', 'word', 'guess', 'ready'].includes(event)) await arrange(phase);
      }
    }
  }
  assert.ok(acks > 4000, `a large battery was sent (${acks})`);
  assert.equal(await site.alive(), true);
  assertNoPollution(prototypes);
  await sleep(100);
  for (const person of [...members, eve]) checkStates(person);

  // A normal game can still be played to the end, and is recorded once.
  const before = (await ann.stats()).perGame?.find((g) => g.game === 'scribblers')?.played ?? 0;
  await arrange('finished');
  await sleep(200);
  assert.equal((await ann.stats()).perGame.find((g) => g.game === 'scribblers').played, before + 1);
  for (const person of members) checkStates(person);
});

test('actions out of turn and from outsiders are refused and change nothing', async (t) => {
  const site = await launchModule(t, { id: 'scribblers', moduleDir: here });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { rounds: 1, drawTime: 30 });
  assert.equal((await bob.call('join', { code })).ok, true);
  await until(() => ann.state?.players.length === 2, 'two players');

  for (const [event, payload] of [
    ['word', { n: 0 }],
    ['guess', { text: 'house' }],
    ['ready', {}],
    ['line', { x: 1, y: 1, x2: 2, y2: 2, c: 1, w: 8 }],
    ['undo', {}],
    ['clear', {}],
  ]) {
    for (const who of [ann, bob]) assert.equal((await who.call(event, payload)).ok, false, `${event} in the lobby`);
  }
  for (const [event, payload] of [
    ['start', {}],
    ['word', { n: 0 }],
    ['guess', { text: 'house' }],
    ['kick', { userId: bob.id }],
    ['addBot', {}],
    ['settings', { rounds: 3 }],
    ['line', { x: 1, y: 1, x2: 2, y2: 2, c: 1, w: 8 }],
    ['canvas', {}],
  ]) {
    assert.equal((await eve.call(event, payload)).ok, false, `${event} by an outsider`);
  }

  assert.ok((await ann.call('start')).ok);
  await until(() => [ann, bob].every((p) => p.state?.phase === 'choosing'), 'the first drawer is choosing');
  const drawer = [ann, bob].find((p) => p.state.youDraw);
  const guesser = [ann, bob].find((p) => p !== drawer);
  assert.equal((await guesser.call('word', { n: 0 })).ok, false, 'only the drawer chooses');
  assert.equal((await drawer.call('guess', { text: 'anything' })).ok, true, 'the drawer may talk');
  assert.ok((await drawer.call('word', { n: 0 })).ok);
  await until(() => [ann, bob].every((p) => p.state?.phase === 'drawing'), 'the drawing starts');
  assert.equal((await drawer.call('word', { n: 1 })).ok, false, 'the word is chosen');
  assert.equal((await guesser.call('line', { x: 1, y: 1, x2: 2, y2: 2, c: 1, w: 8 })).ok, false, 'a guesser cannot draw');
  assert.ok((await guesser.call('guess', { text: drawer.state.word })).ok);
  assert.ok((await guesser.call('guess', { text: 'well that was easy' })).ok, 'once you have it you are talking');
  await until(() => guesser.state.feed.some((line) => line.kind === 'chat'), 'what they said is in the panel');
});
