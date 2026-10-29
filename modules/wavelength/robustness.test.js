// Garbage in: every socket event of Wavelength, in every phase and both modes that are cheap to reach, from members and
// strangers, is sent malformed payloads. The server must stay up, answer every time with a structured failure or a
// harmless success, keep the game consistent, never reveal the hidden target, and still be able to finish a normal game.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchModule, fuzzEvent, assertNoPollution, prototypeNames, until, sleep } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: ['turnsEach', 'mode'],
  leave: [],
  kick: ['userId'],
  addBot: [],
  fillBots: ['count'],
  removeBot: ['seat'],
  colour: ['colour'],
  settings: ['turnsEach'],
  mode: ['mode'],
  start: [],
  clue: ['text'],
  guess: ['position'],
  marker: ['position'],
  lock: [],
  ready: [],
};
const SCENES = [
  ['solo', 'lobby'],
  ['solo', 'clue'],
  ['solo', 'guessing'],
  ['team', 'guessing'],
  ['solo', 'reveal'],
  ['team', 'reveal'],
  ['solo', 'finished'],
];

/** Every state a person was sent is well formed, and only the psychic ever saw the target before the reveal. */
function checkStates(person) {
  let turn = 0;
  for (const s of person.states) {
    if (!s) {
      turn = 0; // out of a game: the next one starts again
      continue;
    }
    if (s.phase === 'lobby') turn = 0;
    assert.ok(s.turn >= turn, `${person.name}: the turn only moves forward`);
    turn = s.turn;
    assert.ok(['lobby', 'clue', 'guessing', 'reveal', 'finished', 'abandoned'].includes(s.phase), `${person.name}: phase ${s.phase}`);
    assert.ok(['solo', 'team'].includes(s.mode), `${person.name}: mode ${s.mode}`);
    if (['clue', 'guessing'].includes(s.phase) && s.target !== null) assert.equal(s.psychic, s.you, `${person.name} saw the target without being the psychic`);
    if (s.phase === 'guessing' && s.psychic === s.you) assert.equal(s.marker, null, `${person.name}: the psychic saw the marker`);
    if (['lobby', 'clue'].includes(s.phase)) assert.equal(s.marker, null, `${person.name}: a marker before guessing`);
    if (s.marker !== null) assert.ok(s.marker >= 0 && s.marker <= 100, `${person.name}: marker ${s.marker}`);
    for (const g of s.guesses) assert.ok(g.position >= 0 && g.position <= 100, `${person.name}: guess ${g.position}`);
    if (!['reveal', 'finished'].includes(s.phase)) assert.ok(s.guesses.every((g) => g.id === s.you), `${person.name} saw somebody else's guess early`);
    const ids = s.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'no player twice');
    const colours = s.players.map((p) => p.colour);
    assert.equal(new Set(colours).size, colours.length, `${person.name}: colours stay unique`);
    assert.ok(s.players.length <= s.limits.max);
  }
}

test('garbage payloads on every event, in every phase and mode, from members and strangers', { timeout: 600000 }, async (t) => {
  const prototypes = prototypeNames();
  const site = await launchModule(t, { id: 'wavelength', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const members = [ann, bob, cat];
  const psychicOf = () => members.find((p) => p.state?.psychic === p.id);
  const hiddenTarget = () => {
    const p = psychicOf();
    return p && ['clue', 'guessing'].includes(p.state.phase) && p.state.target !== null ? [`"target":${p.state.target}`] : [];
  };
  const guessers = () => members.filter((p) => p !== psychicOf());
  const everyoneIn = (phase) => until(() => members.every((p) => p.state?.phase === phase), `everyone in ${phase}`);

  async function arrange(mode, phase) {
    for (const p of [...members, eve]) await p.call('leave', {});
    await until(() => [...members, eve].every((p) => p.state == null), 'everyone out');
    const created = await ann.call('create', { turnsEach: 1, mode });
    assert.equal(created.ok, true, created.error);
    for (const p of [bob, cat]) assert.equal((await p.call('join', { code: created.code })).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'lobby' && p.state.players.length === 3), 'a lobby of three');
    if (phase === 'lobby') return;
    assert.equal((await ann.call('start', {})).ok, true);
    await everyoneIn('clue');
    if (phase === 'clue') return;
    assert.equal((await psychicOf().call('clue', { text: 'a warm sunset' })).ok, true);
    await everyoneIn('guessing');
    if (phase === 'guessing') return;
    const finishTurn = async () => {
      if (mode === 'team') {
        assert.equal((await guessers()[0].call('marker', { position: 40 })).ok, true);
        assert.equal((await guessers()[1].call('lock', {})).ok, true);
      } else for (const p of guessers()) assert.equal((await p.call('guess', { position: 40 })).ok, true);
      await everyoneIn('reveal');
    };
    await finishTurn();
    if (phase === 'reveal') return;
    for (let turn = 0; turn < 3; turn++) {
      for (const p of members) assert.equal((await p.call('ready', {})).ok, true);
      if (turn < 2) {
        await everyoneIn('clue');
        assert.equal((await psychicOf().call('clue', { text: 'a warm sunset' })).ok, true);
        await everyoneIn('guessing');
        await finishTurn();
      }
    }
    await everyoneIn('finished');
  }

  let acks = 0;
  for (const [mode, phase] of SCENES) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await arrange(mode, phase);
      const psychic = psychicOf();
      const guesser = guessers().find((p) => p !== ann) ?? bob;
      const extra = {
        guess: [{ position: 0 }, { position: 100 }, { position: 100.1 }, { position: -0.1 }, { position: '50' }, { position: [50] }, { position: 49.96 }],
        marker: [{ position: 0 }, { position: 100 }, { position: 100.1 }, { position: -0.1 }, { position: '50' }, { position: [50] }, { position: 49.96 }],
        clue: [{ text: 'a pleasant clue' }, { text: 'x'.repeat(81) }, { text: '   ' }, { text: 'two\nlines' }],
        kick: [{ userId: bob.id }, { userId: cat.id }, { userId: ann.id }, { userId: 0 }, { userId: -5 }, { userId: 999999 }, { userId: String(bob.id) }],
        removeBot: [{ seat: 'bot:1' }, { seat: 'bot:0' }, { seat: ann.id }],
        fillBots: [{ count: 8 }, { count: 0 }, { count: 99 }],
        colour: [{ colour: '#ff2d95' }, { colour: '#FF2D95' }, { colour: '#ff2d95 ' }, { colour: '#123456' }],
        settings: [{ turnsEach: 3 }, { turnsEach: 0 }, { turnsEach: 6 }, { turnsEach: '3' }],
        mode: [{ mode: 'team' }, { mode: 'solo' }, { mode: 'TEAM' }, { mode: ['team'] }],
        create: [{ turnsEach: 3, mode: 'team' }, { turnsEach: 99, mode: 'solo' }, { mode: 'chaos' }],
        join: [{ code: 'boss-aware-you' }, { code: 'Boss Aware You' }, { code: '?boss-aware-you' }],
        resume: [{ code: 'boss-aware-you' }, { code: 'no-such-game' }],
      }[event];
      // The host, the psychic, an ordinary guesser, and someone who is not in the game at all.
      for (const who of new Set([ann, psychic, guesser, eve].filter(Boolean))) {
        acks += await fuzzEvent(who, event, fields, { secrets: hiddenTarget, extra: extra ?? [] });
        assert.equal((await eve.call('resume', {})).ok !== 'timeout', true, 'the server is still answering');
        if (['create', 'leave', 'start', 'kick', 'join', 'resume', 'removeBot', 'fillBots', 'addBot'].includes(event)) await arrange(mode, phase);
      }
    }
  }
  assert.ok(acks > 5000, `a large battery was sent (${acks})`);
  assert.equal(await site.alive(), true);
  assertNoPollution(prototypes);
  await sleep(100);
  for (const p of [...members, eve]) checkStates(p);

  // A normal game can still be played to the end, and is recorded once.
  const before = (await ann.stats()).perGame?.[0]?.played ?? 0;
  await arrange('solo', 'finished');
  await sleep(150);
  assert.equal((await ann.stats()).perGame[0].played, before + 1);
  for (const p of members) checkStates(p);
});

test('actions from outsiders and out of turn are refused and change nothing', async (t) => {
  const site = await launchModule(t, { id: 'wavelength', moduleDir: here });
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const { code } = await ann.call('create', { turnsEach: 1, mode: 'team' });
  await bob.call('join', { code });
  await cat.call('join', { code });
  await until(() => ann.state?.players.length === 3, 'three players');
  const everyone = [ann, bob, cat];
  // Before the game: nothing but the lobby's own actions work.
  for (const [event, payload] of [['clue', { text: 'x' }], ['guess', { position: 5 }], ['marker', { position: 5 }], ['lock', {}], ['ready', {}]]) {
    for (const who of everyone) assert.equal((await who.call(event, payload)).ok, false, `${event} in the lobby`);
  }
  // Outsiders cannot do anything to a game they are not in.
  for (const [event, payload] of [['start', {}], ['clue', { text: 'x' }], ['marker', { position: 5 }], ['lock', {}], ['mode', { mode: 'solo' }], ['kick', { userId: bob.id }], ['colour', { colour: '#ff2d95' }], ['addBot', {}]]) {
    assert.equal((await eve.call(event, payload)).ok, false, `${event} by an outsider`);
  }
  assert.equal(ann.state.players.length, 3);
  assert.equal(ann.state.mode, 'team');
  assert.ok((await ann.call('start')).ok);
  await until(() => everyone.every((p) => p.state?.phase === 'clue'), 'the clue phase');
  const psychic = everyone.find((p) => p.state.psychic === p.id);
  const [a, b] = everyone.filter((p) => p !== psychic);
  // Before the clue nobody can move or lock a marker, and only the psychic can give the clue.
  for (const who of everyone) {
    assert.equal((await who.call('marker', { position: 5 })).ok, false);
    assert.equal((await who.call('lock', {})).ok, false);
  }
  assert.equal((await a.call('clue', { text: 'cheat' })).ok, false);
  assert.ok((await psychic.call('clue', { text: 'warm' })).ok);
  assert.equal((await psychic.call('clue', { text: 'again' })).ok, false, 'one clue a turn');
  await until(() => a.state.phase === 'guessing', 'guessing');
  assert.equal((await psychic.call('marker', { position: 5 })).ok, false);
  assert.equal((await psychic.call('lock', {})).ok, false);
  assert.equal((await eve.call('marker', { position: 5 })).ok, false);
  assert.equal((await a.call('mode', { mode: 'solo' })).ok, false, 'the mode is fixed once the game has started');
  assert.equal((await ann.call('mode', { mode: 'solo' })).ok, false);
  assert.equal(a.state.mode, 'team');
  assert.ok((await a.call('marker', { position: 25 })).ok);
  assert.ok((await b.call('lock', {})).ok);
  assert.equal((await a.call('lock', {})).ok, false, 'already locked');
  assert.equal((await a.call('marker', { position: 80 })).ok, false, 'and the marker no longer moves');
});
