// The small things every list game wants, written once: finding a player and their name, bringing a renamed field
// of a saved room up to date, the phase that waits for everybody to close the scores, a computer player's move as the
// server schedules it, and asking an AI without trusting it.  Each is asserted against what its own comment promises.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attempt } from './ai.js';
import { accountNames, afterWait, botMove, insist } from './roomServer.js';
import { createReadyRules, namer, playerOf, renameField } from './roster.js';

const person = (id, name) => ({ kind: 'human', id, name });
const computer = (n, name) => ({ kind: 'bot', id: `bot:${n}`, name });

test('playerOf finds a person or a computer player by id, and nobody for an id that is not in the room', () => {
  const room = { players: [person(7, 'Ann'), computer(1, 'Ada')] };
  assert.equal(playerOf(room, 7).name, 'Ann');
  assert.equal(playerOf(room, 'bot:1').name, 'Ada');
  assert.equal(playerOf(room, 8), undefined);
  assert.equal(playerOf(room, '7'), undefined, 'an account id is a number: its text is somebody else');
});

test('namer prefers the name saved with the player, and asks the fallback for anybody else', () => {
  const room = { players: [person(7, 'Ann'), { kind: 'human', id: 8 }] };
  const nameOf = namer(room, (id) => `account ${id}`);
  assert.equal(nameOf(7), 'Ann');
  assert.equal(nameOf(8), 'account 8', 'a player saved without a name');
  assert.equal(nameOf(9), 'account 9', 'somebody who has left the room');
});

test('renameField moves an old field to its new name once, and never over a value already there', () => {
  const old = { round: 3 };
  renameField(old, 'round', 'turn');
  assert.deepEqual(old, { turn: 3 });
  renameField(old, 'round', 'turn');
  assert.deepEqual(old, { turn: 3 }, 'running it twice changes nothing more');

  const both = { round: 3, turn: 5 };
  renameField(both, 'round', 'turn');
  assert.deepEqual(both, { turn: 5 }, 'what is already under the new name is kept');

  assert.doesNotThrow(() => renameField(null, 'round', 'turn'));
  assert.doesNotThrow(() => renameField(undefined, 'round', 'turn'));
});

/** A room at the reveal with two people and a computer player, and rules whose `finish` notes what it was handed. */
function atReveal() {
  const finished = [];
  const rules = createReadyRules({
    finish(room, ...rest) {
      finished.push(rest);
      room.ready = [];
      room.phase = 'next';
      return false;
    },
  });
  const room = { phase: 'reveal', ready: [], players: [person(1, 'Ann'), person(2, 'Bob'), computer(1, 'Ada')] };
  return { room, rules, finished };
}

test('the reveal waits for every person, and never for a computer player', () => {
  const { room, rules, finished } = atReveal();
  assert.equal(rules.waitingForReady(room), true);
  assert.deepEqual(rules.unready(room).map((p) => p.id), [1, 2]);

  assert.deepEqual(rules.ready(room, 1, 'rng'), { ok: true, finished: false });
  assert.deepEqual(rules.unready(room).map((p) => p.id), [2]);
  assert.equal(finished.length, 0, 'one person is still to close the scores');

  assert.deepEqual(rules.ready(room, 1, 'rng'), { ok: true, finished: false }, 'being ready twice is harmless');
  assert.deepEqual(room.ready, [1]);

  assert.equal(rules.ready(room, 2, 'rng', 'now').ok, true);
  assert.deepEqual(finished, [['rng', 'now']], 'the last person in ends the turn, with whatever the game was handed');
  assert.equal(rules.waitingForReady(room), false);
});

test('only somebody in the room may be ready, and only while the scores are up', () => {
  const { room, rules } = atReveal();
  assert.deepEqual(rules.ready(room, 99), { ok: false, error: 'notInGame' });
  room.phase = 'guessing';
  assert.deepEqual(rules.ready(room, 1), { ok: false, error: 'noScoresToClose' });
  assert.deepEqual(rules.forceNext(room), { ok: false, error: 'nothingToMoveOn' });
});

test('the server moves on without the people who have not closed the scores', () => {
  const { room, rules, finished } = atReveal();
  rules.ready(room, 1);
  assert.equal(rules.forceNext(room, 'rng').ok, true);
  assert.deepEqual(finished, [['rng']]);
});

test('the answer says whether the game is over, as `finish` reports it', () => {
  const rules = createReadyRules({ finish: () => true, phase: 'scores' });
  const room = { phase: 'scores', ready: [], players: [person(1, 'Ann')] };
  assert.deepEqual(rules.ready(room, 1), { ok: true, finished: true });
  assert.deepEqual(rules.forceNext(room), { ok: true, finished: true });
  assert.equal(rules.waitingForReady({ phase: 'reveal' }), false, 'the phase that waits is the one the game named');
});

test('a computer move that plays nothing is a failure, so that it is not asked for again for ever', () => {
  const action = { type: 'guess', id: 'bot:1' };
  const played = botMove(action, 700, () => true);
  assert.equal(played.wait, 700);
  assert.doesNotThrow(() => played.run());
  assert.throws(() => botMove(action, 700, () => false).run(), /guess.*bot:1/);
});

test('a rule the server runs after a wait keeps its key, and a refusal of it is thrown', () => {
  const moved = afterWait('next:3', 60000, () => ({ ok: true }));
  assert.equal(moved.key, 'next:3');
  assert.equal(moved.wait, 60000);
  assert.doesNotThrow(() => moved.run());
  assert.throws(() => afterWait('next:3', 60000, () => ({ ok: false, error: 'nothingToMoveOn' })).run(), /nothingToMoveOn/);
});

test('insist lets a rule that worked through and throws the code of one that was refused', () => {
  assert.doesNotThrow(() => insist({ ok: true }));
  assert.throws(() => insist({ ok: false, error: 'notYourTurn' }), /notYourTurn/);
});

test('accountNames gives the display name, and "Someone" for an account the site does not know', () => {
  const nameOf = accountNames({ users: { get: (id) => (id === 7 ? { displayName: 'Ann' } : null) } });
  assert.equal(nameOf(7), 'Ann');
  assert.equal(nameOf(8), 'Someone');
  assert.equal(accountNames({})(7), 'Someone', 'a context with no accounts at all (a rules test) still answers');
});

test('attempt hands back what an AI decided, and nothing at all from one that threw', () => {
  assert.equal(attempt(() => 3), 3);
  assert.equal(
    attempt(() => {
      throw new Error('a broken AI');
    }),
    undefined,
  );
});
