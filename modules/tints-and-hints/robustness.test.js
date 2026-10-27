// Garbage in: every socket event of Tints and Hints, in every phase that is cheap to reach, from members and strangers,
// is sent malformed payloads. The server must stay up, answer every time with a structured failure or a harmless
// success, keep the game consistent, never reveal the hidden tint, and still be able to finish a normal game.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, fuzzEvent, assertNoPollution, prototypeNames, until, sleep } from '../../shared/testkit.js';
import { checkRun } from './checks.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['turnsEach'],
  leave: [],
  kick: ['userId'],
  colour: ['colour'],
  settings: ['turnsEach'],
  start: [],
  hint: ['text'],
  guess: ['cell'],
  advance: [],
  ready: [],
};
const PHASES = ['lobby', 'guessing1', 'guessing2', 'reveal', 'finished'];

test('garbage payloads on every event, in every phase, from members and strangers', async (t) => {
  const prototypes = prototypeNames();
  const site = await launchModule(t, { id: 'tints-and-hints', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const members = [ann, bob, cat];
  const hinterOf = () => members.find((p) => p.state?.hinter === p.id);
  const hiddenTint = () => {
    const h = hinterOf();
    return h && ['guessing1', 'guessing2'].includes(h.state.phase) && h.state.tint ? [h.state.tint] : [];
  };

  const guessAll = async (cell = 'A1') => {
    for (const p of members) if (p !== hinterOf()) assert.equal((await p.call('guess', { cell })).ok, true);
  };
  const advance = async () => assert.equal((await hinterOf().call('advance', {})).ok, true);
  /** Puts the three members in a fresh game in the given phase (everybody leaves whatever they were in first). */
  async function arrange(phase) {
    for (const p of [...members, eve]) await p.call('leave', {});
    await until(() => [...members, eve].every((p) => p.state == null), 'everyone out');
    const created = await ann.call('create', { turnsEach: 1 });
    assert.equal(created.ok, true, created.error);
    for (const p of [bob, cat]) assert.equal((await p.call('join', { code: created.code })).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'lobby' && p.state.players.length === 3), 'a lobby of three');
    if (phase === 'lobby') return;
    assert.equal((await ann.call('start', {})).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'guessing1'), 'guessing1');
    if (phase === 'guessing1') return;
    assert.equal((await hinterOf().call('hint', { text: 'a warm sunset' })).ok, true);
    await guessAll('M4');
    await advance();
    await until(() => members.every((p) => p.state?.phase === 'guessing2'), 'guessing2');
    if (phase === 'guessing2') return;
    await guessAll('B7');
    await advance();
    await until(() => members.every((p) => p.state?.phase === 'reveal'), 'reveal');
    if (phase === 'reveal') return;
    for (let turn = 0; turn < 3; turn++) {
      for (const p of members) assert.equal((await p.call('ready', {})).ok, true);
      if (turn < 2) {
        await until(() => members.every((p) => p.state?.phase === 'guessing1'), 'the next turn');
        assert.equal((await hinterOf().call('hint', { text: 'a warm sunset' })).ok, true);
        await guessAll();
        await advance();
        await until(() => members.every((p) => p.state?.phase === 'guessing2'), 'guessing2');
        await guessAll();
        await advance();
        await until(() => members.every((p) => p.state?.phase === 'reveal'), 'reveal');
      }
    }
    await until(() => members.every((p) => p.state?.phase === 'finished'), 'finished');
  }

  let acks = 0;
  for (const phase of PHASES) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await arrange(phase);
      const hinter = hinterOf();
      const guesser = members.find((p) => p !== hinter && p !== ann) ?? bob;
      const extra = {
        guess: [{ cell: 'A1' }, { cell: 'a0' }, { cell: 'A0 ' }, { cell: 'AA' }, { cell: 'BA1' }, { cell: 'A25' }, { cell: ['A1'] }, { cell: 'AZ24' }],
        hint: [{ text: 'a pleasant hint' }, { text: 'x'.repeat(81) }, { text: '   ' }],
        kick: [{ userId: bob.id }, { userId: cat.id }, { userId: ann.id }, { userId: 0 }, { userId: -5 }, { userId: 999999 }, { userId: String(bob.id) }],
        colour: [{ colour: '#ff2d95' }, { colour: '#FF2D95' }, { colour: '#ff2d95 ' }],
        settings: [{ turnsEach: 3 }, { turnsEach: 0 }, { turnsEach: 6 }, { turnsEach: '3' }],
        create: [{ turnsEach: 3 }, { turnsEach: 99 }],
        join: [{ code: 'boss-aware-you' }, { code: 'Boss Aware You' }, { code: '?boss-aware-you' }],
        resume: [{ code: 'boss-aware-you' }, { code: 'no-such-game' }],
      }[event];
      // The host or hinter, an ordinary member, and someone who is not in the game at all.
      for (const who of new Set([ann, hinter, guesser, eve].filter(Boolean))) {
        acks += await fuzzEvent(who, event, fields, { secrets: hiddenTint, extra: extra ?? [] });
        // The server is still answering after every battery.
        assert.equal((await eve.call('resume', {})).ok !== 'timeout', true);
        if (['create', 'leave', 'start', 'advance', 'kick', 'join', 'resume'].includes(event)) await arrange(phase);
      }
    }
  }
  assert.ok(acks > 5000, `a large battery was sent (${acks})`);
  assert.equal(await site.alive(), true);
  assertNoPollution(prototypes);
  await sleep(100);

  // Every state anyone was sent is valid, moves forward only, and never showed a guesser the tint early.
  for (const p of [...members, eve]) checkRun(p.states, p.name);

  // A normal game can still be played to the end, and is recorded once.
  const before = (await ann.stats()).perGame?.[0]?.played ?? 0;
  await arrange('finished');
  assert.equal(members[0].state.phase, 'finished');
  await sleep(150);
  assert.equal((await ann.stats()).perGame[0].played, before + 1);
  for (const p of members) checkRun(p.states, p.name);
});

test('actions from outsiders and out of turn are refused and change nothing', async (t) => {
  const site = await launchModule(t, { id: 'tints-and-hints', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { turnsEach: 1 });
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state?.players.length === 3, 'three players');
  const everyone = [ann, bob, cat];

  // Before the start: nothing but lobby actions work.
  for (const [event, payload] of [['hint', { text: 'x' }], ['guess', { cell: 'A1' }], ['advance', {}]]) {
    for (const p of everyone) assert.equal((await p.call(event, payload)).ok, false, `${event} in the lobby`);
  }
  for (const [event, payload] of [['colour', { colour: '#000000' }], ['settings', { turnsEach: 2 }], ['start', {}], ['kick', { userId: bob.id }], ['guess', { cell: 'A1' }], ['hint', { text: 'x' }], ['advance', {}]]) {
    const reply = await eve.call(event, payload);
    assert.deepEqual(reply, { ok: false, error: event === 'kick' ? 'Only the host can remove players.' : 'You are not in a game.' }, event);
  }
  assert.equal((await bob.call('start', {})).ok, false, 'only the host starts');
  assert.equal((await bob.call('settings', { turnsEach: 3 })).ok, false, 'only the host changes the settings');
  assert.equal((await ann.call('start', {})).ok, true);
  await until(() => everyone.every((p) => p.state?.phase === 'guessing1'), 'guessing1');
  const hinter = everyone.find((p) => p.state.hinter === p.id);
  const guessers = everyone.filter((p) => p !== hinter);
  const tint = hinter.state.tint;

  assert.equal((await hinter.call('guess', { cell: 'A1' })).ok, false, 'the hinter cannot guess');
  for (const g of guessers) {
    assert.equal((await g.call('hint', { text: 'I will help' })).ok, false, 'guessers cannot hint');
    assert.equal((await g.call('advance', {})).ok, false, 'guessers cannot advance');
    assert.equal((await g.call('colour', { colour: '#000000' })).ok, false, 'colours are fixed once started');
    assert.equal((await g.call('start', {})).ok, false);
    assert.equal((await g.call('settings', { turnsEach: 3 })).ok, false);
  }
  assert.equal((await hinter.call('advance', {})).ok, false, 'the hinter must wait for the guesses');
  assert.equal((await hinter.call('hint', { text: 'warm' })).ok, true);
  assert.equal((await guessers[0].call('guess', { cell: 'C3' })).ok, true);
  assert.equal((await guessers[0].call('guess', { cell: 'D4' })).ok, false, 'one guess a round');
  assert.equal((await guessers[1].call('guess', { cell: 'nonsense' })).ok, false);
  assert.equal((await guessers[1].call('guess', { cell: 'D4' })).ok, true);
  // A guess is private until the round closes.
  await until(() => guessers.every((g) => g.state.guesses.length === 1), 'own guesses');
  assert.ok(guessers[0].state.guesses.every((g) => g.id === guessers[0].id));
  assert.ok(guessers[1].state.guesses.every((g) => g.id === guessers[1].id));
  for (const g of guessers) assert.equal(g.state.tint, null);
  assert.ok(!JSON.stringify(guessers.map((g) => g.states)).includes(`"tint":"${tint}"`));
  assert.equal((await eve.call('guess', { cell: 'C3' })).ok, false);
  assert.equal((await hinter.call('advance', {})).ok, true);
  await until(() => guessers.every((g) => g.state.phase === 'guessing2'), 'guessing2');
  assert.equal((await hinter.call('advance', {})).ok, false, 'the second round needs its guesses too');
  for (const g of guessers) assert.equal((await g.call('guess', { cell: 'E5' })).ok, true);
  assert.equal((await hinter.call('advance', {})).ok, true);
  await until(() => guessers.every((g) => g.state.phase === 'reveal'), 'the reveal');
  for (const g of guessers) assert.equal(g.state.tint, tint, 'revealed to all');
  assert.equal((await guessers[0].call('guess', { cell: 'A1' })).ok, false, 'no guessing at the reveal');
  assert.equal((await hinter.call('hint', { text: 'late' })).ok, false, 'no hints at the reveal');
  for (const outsider of [hinter, ...guessers]) assert.equal((await outsider.call('advance', {})).ok, false, 'nobody closes the reveal with advance');
  for (const p of everyone) checkRun(p.states, p.name);
});

test('error messages and replies never carry the tint or anyone else\'s guess', async (t) => {
  const site = await launchModule(t, { id: 'tints-and-hints', moduleDir: here });
  const [ann, bob, cat] = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { turnsEach: 1 });
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state?.players.length === 3, 'three players');
  await ann.call('start', {});
  await until(() => [ann, bob, cat].every((p) => p.state?.phase === 'guessing1'), 'guessing1');
  const hinter = [ann, bob, cat].find((p) => p.state.hinter === p.id);
  const [g1, g2] = [ann, bob, cat].filter((p) => p !== hinter);
  await g1.call('guess', { cell: 'K6' });
  const replies = [];
  for (const [who, event, payload] of [
    [g2, 'guess', { cell: 'nonsense' }], [g2, 'hint', { text: 'x' }], [g2, 'advance', {}], [g1, 'guess', { cell: 'K6' }], [g1, 'guess', { cell: 'K7' }],
    [g2, 'kick', { userId: hinter.id }], [g2, 'kick', { userId: g1.id }], [g2, 'colour', { colour: 'K6' }], [g1, 'settings', { turnsEach: 'K6' }],
  ]) replies.push(await who.call(event, payload));
  const text = JSON.stringify(replies);
  assert.ok(!text.includes(`"${hinter.state.tint}"`) || ['K6', 'K7'].includes(hinter.state.tint));
  assert.ok(replies.every((r) => r.ok === false));
  assert.ok(!JSON.stringify(g2.states).includes('K6') || g2.states.every((s) => !s?.guesses?.some((g) => g.cell === 'K6' && g.id !== g2.id)), 'g1\'s guess is never in g2\'s states');
});
