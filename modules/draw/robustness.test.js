// Garbage in: every socket event of Draw! gets malformed payloads in every phase that can be reached cheaply, from
// the host, an ordinary player and an outsider.  The server must stay up, answer with a structured failure or a
// harmless success, keep the game valid, leak neither word, and still be able to finish a round afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, launchModule, prototypeNames, sleep, until } from '../../shared/testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DRAW_CHOOSE_WAIT = '600';
process.env.DRAW_BETWEEN_WAIT = '40';
process.env.DRAW_AWAY_WAIT = '5000';
process.env.DRAW_BOT_DELAY = '0-5';
process.env.DRAW_BOT_DRAW = '10';
process.env.DRAW_BOT_RATE = '20000';
process.env.DRAW_PICTURES = 'test';

/** The events the module handles, with the payload fields each one reads. */
const EVENTS = {
  resume: ['code'],
  create: [],
  join: ['code'],
  leave: [],
  kick: ['userId'],
  voteKick: ['userId'],
  voteAnswer: ['agree'],
  voteDrop: [],
  settings: ['cycles', 'drawTime', 'wordChoices'],
  addBot: ['seat'],
  fillBots: ['count'],
  removeBot: ['seat'],
  start: [],
  again: [],
  word: ['n'],
  guess: ['text'],
  line: ['x', 'y', 'x2', 'y2', 'c', 'w'],
  fill: ['x', 'y', 'c'],
  draw: ['ops'],
  clear: [],
  undo: [],
  canvas: [],
};

/** Checks one view for internal consistency, and that it never carries a word its reader may not have. */
function assertValidView(view, who) {
  if (!view) return;
  const note = (m) => `${who}: ${m} (phase ${view.phase})`;
  const ids = view.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, note('player ids are unique'));
  assert.ok(ids.includes(view.you) || view.phase === 'lobby', note('I am in the player list'));
  assert.ok(view.boards.length <= 2, note('never more than two drawings'));
  for (const board of view.boards) {
    assert.ok(ids.includes(board.drawer), note('a board belongs to a player'));
    if (!['between', 'finished'].includes(view.phase) && !board.yours) assert.equal(board.word, null, note('somebody else\'s word'));
    assert.ok(board.shape.every((ch) => ch === null || typeof ch === 'string'), note('the shape is punctuation and blanks'));
  }
  if (view.phase === 'drawing') assert.equal(view.choices.length, 0, note('nothing left to choose'));
  for (const row of view.players) assert.ok(Number.isInteger(row.score) && row.score >= 0, note('a sane score'));
  assert.equal(view.scoreboard.rounds.length <= view.round, true, note('no more rounds than have been played'));
}

test('every socket event survives garbage in every phase, and a round can still be played afterwards', async (t) => {
  const site = await launchModule(t, { id: 'draw', moduleDir: here });
  const protoBefore = prototypeNames();
  const [ann, bob, cat, eve] = await Promise.all(['ann', 'bob', 'cat', 'eve'].map((n) => site.person(n).open()));
  const table = [ann, bob, cat];

  /** A fresh game of three, in the lobby. */
  async function fresh() {
    for (const p of [...table, eve]) await p.call('leave');
    const created = await ann.call('create');
    assert.equal(created.ok, true, created.error);
    for (const p of [bob, cat]) assert.equal((await p.call('join', { code: created.code })).ok, true);
    await until(() => table.every((p) => p.state?.players.length === 3), 'three in the lobby');
  }

  /** Brings a fresh game to a phase using only legal moves. */
  async function reach(phase) {
    await fresh();
    if (phase === 'lobby') return;
    assert.equal((await ann.call('settings', { drawTime: 120 })).ok, true);
    assert.equal((await ann.call('start')).ok, true);
    await until(() => table.every((p) => p.state?.phase === 'choosing'), 'choosing');
    if (phase === 'choosing') return;
    for (const p of table.filter((x) => x.state.youDraw)) assert.equal((await p.call('word', { n: 0 })).ok, true);
    await until(() => table.every((p) => p.state?.phase === 'drawing'), 'drawing');
  }

  // Neither word may come back in any reply, to anybody: the two drawings are the whole game.
  const secretsFor = () => table.flatMap((p) => (p.state?.boards ?? []).flatMap((b) => (b.word ? [b.word] : [])));

  let calls = 0;
  for (const phase of ['lobby', 'choosing', 'drawing']) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await reach(phase);
      for (const person of [ann, bob, eve]) calls += await fuzzEvent(person, event, fields, { secrets: secretsFor });
      await sleep(5);
      const ping = await ann.call('resume', {});
      assert.equal(ping.ok, true, `${phase}/${event}: the server still answers`);
      for (const p of [ann, bob, cat, eve]) {
        for (const state of p.states) assertValidView(state, p.name);
        p.states.length = 0;
      }
    }
    assert.ok(await site.alive(), `still alive after ${phase}`);
  }
  assert.ok(calls > 2000, `a big battery was thrown (${calls})`);
  assertNoPollution(protoBefore);

  // And the module still works: a round played start to finish.
  await reach('drawing');
  const drawers = table.filter((p) => p.state.youDraw);
  const guesser = table.find((p) => !p.state.youDraw);
  assert.equal(drawers.length, 2);
  const word = drawers[0].state.boards.find((b) => b.yours).word;
  assert.equal((await guesser.call('guess', { text: word })).ok, true);
  await until(() => table.every((p) => p.state?.phase === 'between'), 'the round is named and over');
  assert.equal(guesser.state.players.find((p) => p.id === guesser.state.you).score, 1);
});

test('a guesser is never sent either word, however the round ends', async (t) => {
  const site = await launchModule(t, { id: 'draw', moduleDir: here });
  const people = await Promise.all(['ann', 'bob', 'cat'].map((n) => site.person(n).open()));
  const [ann] = people;
  const { code } = await ann.call('create');
  for (const p of people.slice(1)) await p.call('join', { code });
  await until(() => people.every((p) => p.state?.players.length === 3), 'three');
  assert.equal((await ann.call('settings', { drawTime: 10 })).ok, true);
  assert.equal((await ann.call('start')).ok, true);
  await until(() => people.every((p) => p.state?.phase === 'choosing'), 'choosing');
  for (const p of people.filter((x) => x.state.youDraw)) await p.call('word', { n: 0 });
  await until(() => people.every((p) => p.state?.phase === 'drawing'), 'drawing');

  const guesser = people.find((p) => !p.state.youDraw);
  const words = people.filter((p) => p.state.youDraw).map((p) => p.state.boards.find((b) => b.yours).word);
  for (const state of guesser.states) {
    if (!state || ['between', 'finished'].includes(state.phase)) continue;
    for (const word of words) assert.equal(JSON.stringify(state.boards).includes(word), false, 'a word reached a guesser while it was still being drawn');
  }
  assert.ok(words.every(Boolean), 'both drawers had a word');
});
