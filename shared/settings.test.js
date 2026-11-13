// A lobby's settings change is all or nothing (shared/settings.js): a host who is told no must find the table exactly
// as it was.  The helper is tested by itself, and then every game that takes several settings in one message is sent
// one whose first part is fine and whose second is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allOrNothing, eachSetting } from './settings.js';

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });

test('a change that succeeds is kept, and its answer is passed back', () => {
  const room = { rounds: 3, players: [{ id: 1 }] };
  const answer = allOrNothing(room, () => {
    room.rounds = 5;
    room.players.push({ id: 2 });
    return { ok: true, extra: 'kept' };
  });
  assert.deepEqual(answer, { ok: true, extra: 'kept' });
  assert.deepEqual(room, { rounds: 5, players: [{ id: 1 }, { id: 2 }] });
});

test('a change that is refused leaves nothing behind: not a changed field, a new one, a removed one, nor a change deep inside', () => {
  const room = { rounds: 3, size: 6, players: [{ id: 1, name: 'Ann' }], gone: 'still here' };
  const before = structuredClone(room);
  const answer = allOrNothing(room, () => {
    room.rounds = 5;
    room.added = true;
    delete room.gone;
    room.players[0].name = 'Changed';
    room.players.push({ id: 2 });
    return fail('rounds');
  });
  assert.deepEqual(answer, { ok: false, error: 'rounds' }, 'the refusal is passed back as it was');
  assert.deepEqual(room, before);
  assert.deepEqual(Object.keys(room), Object.keys(before), 'in the order it had');
});

test('the room is still the same object afterwards, because its store and its timers hold it', () => {
  const room = { rounds: 3 };
  const held = room;
  allOrNothing(room, () => ((room.rounds = 9), fail('no')));
  assert.equal(room, held);
  assert.equal(held.rounds, 3);
});

test('a change that throws is undone too, and the error is passed on', () => {
  const room = { rounds: 3 };
  assert.throws(() => allOrNothing(room, () => {
    room.rounds = 9;
    throw new Error('a rules bug');
  }), /a rules bug/);
  assert.deepEqual(room, { rounds: 3 });
});

test('a new room takes its settings one at a time, so one that is wrong does not spoil the rest', () => {
  const applied = [];
  eachSetting({ rounds: 5, drawTime: 'nonsense', size: 4 }, (one) => applied.push(one));
  assert.deepEqual(applied, [{ rounds: 5 }, { drawTime: 'nonsense' }, { size: 4 }]);
});

test('a setting that was not given is not applied, and settings that are not an object ask for nothing', () => {
  const applied = [];
  eachSetting({ rounds: undefined, size: 4 }, (one) => applied.push(one));
  assert.deepEqual(applied, [{ size: 4 }]);
  for (const nothing of [undefined, null, 'rounds', 5, true, [], [{ rounds: 5 }]]) eachSetting(nothing, (one) => applied.push(one));
  assert.deepEqual(applied, [{ size: 4 }], 'nothing more was applied');
});

// ---- every game that takes several settings at once ----

/** The games whose lobby settings arrive together with the size, and a second setting each of them refuses. */
const GAMES = [
  ['draw', { rounds: 'nonsense' }],
  ['gtk', { rounds: 'nonsense' }],
  ['just-one', { rounds: 'nonsense' }],
  ['scribblers', { drawTime: 'nonsense' }],
  ['tints-and-hints', { rounds: 'nonsense' }],
  ['trivium', { perRound: 'nonsense' }],
  ['wavelength', { mode: 'nonsense' }],
];

for (const [id, bad] of GAMES) {
  test(`${id}: a settings change refused for one setting has not applied the ones before it`, async () => {
    const game = await import(`../modules/${id}/game.js`);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0 });
    assert.equal(room.phase, 'lobby');
    const before = structuredClone(room);

    // The size alone is a change this room accepts, so it is the refusal of the other that must undo it.
    const alone = structuredClone(room);
    assert.equal(game.setSettings(alone, 1, { size: 3 }).ok, true, 'a table for three is allowed');
    assert.notDeepEqual(alone, before, 'and changes the room');

    const answer = game.setSettings(room, 1, { size: 3, ...bad });
    assert.equal(answer.ok, false, `${JSON.stringify(bad)} is refused`);
    assert.equal(typeof answer.error, 'string');
    assert.deepEqual(room, before, 'and the table is the size it was');
  });
}

for (const [id, bad] of GAMES) {
  test(`${id}: a new room keeps the settings that were right when one of them was wrong`, async () => {
    const game = await import(`../modules/${id}/game.js`);
    const asked = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0, settings: { size: 3, ...bad } });
    const sized = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 0, settings: { size: 3 } });
    assert.deepEqual(asked, sized, 'the wrong one is left at its default, and the size still counts');
  });
}
