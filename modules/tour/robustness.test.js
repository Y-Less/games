// Garbage in: every socket event of a tour, in every phase, from the people in it and from a stranger, is sent
// malformed payloads.  The server must stay up, answer every time with a structured failure or a harmless success,
// keep the tour consistent, and still be able to run a normal evening afterwards.
//
// A tour has no hidden information — the whole point of the vote is that everybody sees it — so there is nothing here
// about leaks.  What there is to protect is the shape: a vote that counts somebody who is not here, a choice nobody
// was offered, or a phase that cannot be got out of would all be worse than a refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoPollution, fuzzEvent, handledSocketEvents, launchModule, prototypeNames, until } from '../../shared/testkit.js';
import { modulesWithStandIns } from './fixtures/standIn.js';

process.env.TOUR_BOT_DELAY = '1-4';

const here = path.dirname(fileURLToPath(import.meta.url));
const STAND_INS = ['mini', 'midi', 'maxi']; // three, so a vote has three games to offer

const EVENTS = {
  resume: ['code'],
  join: ['code'],
  create: [],
  leave: [],
  kick: ['slot'],
  voteKick: ['slot'],
  voteAnswer: ['agree'],
  voteDrop: [],
  addBot: [],
  fillBots: ['count'],
  removeBot: ['slot'],
  settings: [],
  start: [],
  vote: ['choice'],
  again: [],
};

test('this test knows every socket event the server handles', () => {
  assert.deepEqual(handledSocketEvents(here), Object.keys(EVENTS).sort());
});

const PHASES = ['lobby', 'voting', 'playing', 'finished'];

/** Every state a person was sent makes sense on its own terms. */
function checkStates(person) {
  let played = 0;
  for (const state of person.states) {
    if (!state) {
      played = 0;
      continue;
    }
    assert.ok(['lobby', 'voting', 'opening', 'playing', 'finished'].includes(state.phase), `${person.name}: phase ${state.phase}`);
    const ids = state.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${person.name}: a player appeared twice`);
    assert.ok(state.players.length <= state.max, `${person.name}: more players than a tour holds`);
    if (state.phase === 'lobby') played = 0;
    assert.ok(state.played.length >= played, `${person.name}: a tour forgot a game it had played`);
    played = state.played.length;
    // The vote: what it offers and what it says you chose must agree with each other.
    const offered = state.choices.map((choice) => choice.id);
    assert.equal(new Set(offered).size, offered.length, `${person.name}: the same game offered twice`);
    if (state.yourVote !== null) assert.ok(state.yourVote === 'end' || offered.includes(state.yourVote), `${person.name}: voted for ${state.yourVote}, which was not offered`);
    for (const choice of state.choices) assert.ok(choice.votes >= 0 && choice.votes <= state.players.length, `${person.name}: ${choice.votes} votes from ${state.players.length} players`);
    if (state.phase === 'playing') assert.ok(state.current?.game && state.current?.code, `${person.name}: playing nothing in particular`);
    if (state.phase !== 'playing') assert.equal(state.current, null, `${person.name}: playing something while ${state.phase}`);
  }
}

test('garbage payloads on every event, in every phase, from members and strangers', { timeout: 900000 }, async (t) => {
  const prototypes = prototypeNames();
  // launchModule copies one module; a tour needs something to open, so the folder is built first and it finds it made.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-fuzz-'));
  modulesWithStandIns(path.join(dataDir, 'copy'), here, STAND_INS);
  const site = await launchModule(t, { id: 'tour', moduleDir: here, dataDir });
  const [ann, bob, eve] = await Promise.all(['ann', 'bob', 'eve'].map((n) => site.person(n).open()));
  const members = [ann, bob];
  const bothIn = (phase) => until(() => members.every((p) => p.state?.phase === phase), `both of them in ${phase}`);

  /** Puts the tour into a phase, from wherever it is. */
  async function arrange(phase) {
    for (const p of [...members, eve]) await p.call('leave', {});
    await until(() => [...members, eve].every((p) => p.state == null), 'everyone out');
    const created = await ann.call('create', {});
    assert.equal(created.ok, true, created.error);
    assert.equal((await bob.call('join', { code: created.code })).ok, true);
    await until(() => members.every((p) => p.state?.phase === 'lobby' && p.state.players.length === 2), 'a lobby of two');
    if (phase === 'lobby') return;
    assert.equal((await ann.call('start', {})).ok, true);
    await bothIn('voting');
    if (phase === 'voting') return;
    // Both vote the same way, so the vote settles at once rather than waiting out its minute.
    const choice = phase === 'finished' ? 'end' : ann.state.choices[0].id;
    for (const p of members) assert.equal((await p.call('vote', { choice })).ok, true);
    await bothIn(phase === 'finished' ? 'finished' : 'playing');
  }

  let acks = 0;
  for (const phase of PHASES) {
    for (const [event, fields] of Object.entries(EVENTS)) {
      await arrange(phase);
      const onOffer = ann.state?.choices?.map((choice) => choice.id) ?? [];
      const extra = {
        vote: [{ choice: onOffer[0] }, { choice: 'end' }, { choice: 'END' }, { choice: ' end ' }, { choice: 'no-such-game' }, { choice: STAND_INS[0] }, { choice: 'tour' }],
        kick: [{ slot: 's0' }, { slot: 's1' }, { slot: 's99' }, { slot: 0 }, { slot: bob.id }],
        removeBot: [{ slot: 's1' }, { slot: 'bot:1' }, { slot: ann.id }],
        fillBots: [{ count: 4 }, { count: 0 }, { count: 99 }, { count: -1 }],
        voteKick: [{ slot: 's1' }, { slot: 's99' }],
        voteAnswer: [{ agree: true }, { agree: false }, { agree: 'yes' }],
        join: [{ code: 'boss-aware-you' }, { code: 'Boss Aware You' }, { code: '?boss-aware-you' }],
        resume: [{ code: 'boss-aware-you' }, { code: 'no-such-game' }],
      }[event];
      for (const who of [ann, bob, eve]) {
        acks += await fuzzEvent(who, event, fields, { extra: extra ?? [] });
        assert.notEqual((await eve.call('resume', {}))?.ok, 'timeout', 'the server is still answering');
        // Anything that can move the tour or empty it has to be put back before the next sender.
        if (['create', 'leave', 'start', 'join', 'resume', 'kick', 'removeBot', 'fillBots', 'addBot', 'vote', 'again'].includes(event)) await arrange(phase);
      }
    }
  }
  assert.ok(acks > 2000, `a large battery was sent (${acks})`);

  // After all of that, a perfectly ordinary evening still runs from end to end.
  await arrange('playing');
  assert.equal(ann.state.played.length, 1);
  assert.equal((await ann.call('leave', {})).ok, true);

  for (const person of [ann, bob, eve]) checkStates(person);
  assertNoPollution(prototypes);
});
