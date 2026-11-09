// What a game's saved rooms must do, whatever they are saved in.  These tests know only the store's interface — load,
// put, remove, roomsOf, flush, close — and never the shape of what is on disk, so the same file holds the JSON store
// and the one that replaces it to the same promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRoomStore } from './roomStore.js';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roomstore-'));

/** A store over a folder, with the roster family's shape: members are `room.players`, and a person has a number for an id. */
const open = (dataDir, options = {}) => {
  const logs = [];
  const store = createRoomStore({
    dataDir,
    log: (...parts) => logs.push(parts.join(' ')),
    now: () => 1000,
    members: (room) => room.players ?? [],
    isHuman: (member) => member?.kind === 'human',
    ...options,
  });
  return { store, logs };
};

/** A room with two people, a computer player, and a round already played. */
const room = (code, extra = {}) => ({
  code,
  phase: 'playing',
  players: [
    { kind: 'human', id: 1, name: 'Ann', slot: 's0', score: 3 },
    { kind: 'human', id: 2, name: 'Bob', slot: 's1', score: 0 },
    { kind: 'bot', id: 'bot:1', name: 'Ada', slot: 's2', score: 1 },
  ],
  history: [{ label: 'Round 1', deltas: { s0: 3, s1: 0, s2: 1 }, notes: {} }],
  log: [{ n: 1, text: 'Ann played' }],
  ...extra,
});

test('a folder with nothing saved in it loads no rooms and complains about nothing', () => {
  const { store, logs } = open(dir());
  assert.deepEqual(store.load(), []);
  assert.deepEqual(logs, []);
  assert.equal(store.rooms.size, 0);
});

test('a room put and flushed comes back whole in a new store over the same folder', () => {
  const dataDir = dir();
  const first = open(dataDir);
  first.store.put(room('a-b-c'));
  first.store.flush();
  const second = open(dataDir);
  const loaded = second.store.load();
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], room('a-b-c'), 'every part of the room survives the round trip');
  assert.equal(second.store.rooms.get('a-b-c').phase, 'playing', 'and the store holds it by its code');
});

test('several rooms keep their own contents, and one changing does not disturb the others', () => {
  const dataDir = dir();
  const first = open(dataDir);
  for (const code of ['a-a-a', 'b-b-b', 'c-c-c']) first.store.put(room(code));
  first.store.flush();
  const changed = room('b-b-b', { phase: 'finished' });
  changed.history.push({ label: 'Round 2', deltas: { s0: 1 }, notes: {} });
  first.store.put(changed);
  first.store.flush();
  const loaded = open(dataDir).store.load();
  assert.deepEqual(loaded.map((r) => r.code).sort(), ['a-a-a', 'b-b-b', 'c-c-c']);
  const byCode = Object.fromEntries(loaded.map((r) => [r.code, r]));
  assert.equal(byCode['b-b-b'].phase, 'finished');
  assert.equal(byCode['b-b-b'].history.length, 2);
  assert.equal(byCode['a-a-a'].phase, 'playing', 'the others are untouched');
  assert.equal(byCode['c-c-c'].history.length, 1);
});

test('the people in a room can be found without looking through every room, and are forgotten with it', () => {
  const dataDir = dir();
  const { store } = open(dataDir);
  store.put(room('a-b-c'));
  store.put(room('d-e-f'));
  assert.deepEqual(store.roomsOf(1).sort(), ['a-b-c', 'd-e-f']);
  assert.deepEqual(store.roomsOf(2).sort(), ['a-b-c', 'd-e-f']);
  assert.deepEqual(store.roomsOf('bot:1'), [], 'a computer player is not a person');
  assert.deepEqual(store.roomsOf(99), [], 'and nor is somebody who is not playing');
  store.remove('a-b-c');
  assert.deepEqual(store.roomsOf(1), ['d-e-f']);
  store.flush();
  const second = open(dataDir);
  second.store.load();
  assert.deepEqual(second.store.roomsOf(1), ['d-e-f'], 'the index is rebuilt from what was saved');
});

test('somebody leaving a room is out of the index, and whoever took their place is in it', () => {
  const dataDir = dir();
  const { store } = open(dataDir);
  store.put(room('a-b-c'));
  const after = room('a-b-c');
  after.players[1] = { kind: 'bot', id: 'bot:2', name: 'Bram', slot: 's1', score: 0 };
  store.put(after);
  assert.deepEqual(store.roomsOf(2), [], 'the person who left is in no room');
  assert.deepEqual(store.roomsOf(1), ['a-b-c'], 'the one still playing is where they were');
});

test('a removed room is gone, from the store and from what is saved', () => {
  const dataDir = dir();
  const first = open(dataDir);
  first.store.put(room('a-b-c'));
  first.store.put(room('d-e-f'));
  first.store.flush();
  first.store.remove('a-b-c');
  first.store.flush();
  const loaded = open(dataDir).store.load();
  assert.deepEqual(loaded.map((r) => r.code), ['d-e-f']);
});

test('a history that grows keeps every round, and one that is emptied is emptied on disk too', () => {
  const dataDir = dir();
  const first = open(dataDir);
  const live = room('a-b-c');
  first.store.put(live);
  first.store.flush();
  for (let n = 2; n <= 5; n++) {
    live.history.push({ label: `Round ${n}`, deltas: { s0: n }, notes: {} });
    first.store.put(live);
    first.store.flush();
  }
  assert.deepEqual(open(dataDir).store.load()[0].history.map((h) => h.label), ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5']);
  // "Play again" still empties the history in several games, so a shorter list has to be saved as a shorter list.
  live.history = [];
  first.store.put(live);
  first.store.flush();
  assert.deepEqual(open(dataDir).store.load()[0].history, []);
});

test('a history whose rounds are rewritten in place is saved as rewritten', () => {
  // Dixnt scales old rooms' points on load, and Tints and Hints puts a made-up round at the front; neither only appends.
  const dataDir = dir();
  const first = open(dataDir);
  const live = room('a-b-c');
  live.history.push({ label: 'Round 2', deltas: { s0: 100 }, notes: {} });
  first.store.put(live);
  first.store.flush();
  live.history = [{ label: 'Earlier', deltas: { s0: 9 }, notes: {} }, ...live.history.map((h) => ({ ...h, deltas: { s0: 1 } }))];
  first.store.put(live);
  first.store.flush();
  const loaded = open(dataDir).store.load()[0];
  assert.deepEqual(loaded.history.map((h) => h.label), ['Earlier', 'Round 1', 'Round 2']);
  assert.deepEqual(loaded.history.map((h) => h.deltas.s0), [9, 1, 1]);
});

test('a move log that slides along is saved as it stands, not as everything it ever held', () => {
  const dataDir = dir();
  const first = open(dataDir);
  const live = room('a-b-c');
  live.log = Array.from({ length: 60 }, (_, n) => ({ n, text: `move ${n}` }));
  first.store.put(live);
  first.store.flush();
  live.log = [...live.log.slice(1), { n: 60, text: 'move 60' }];
  first.store.put(live);
  first.store.flush();
  const loaded = open(dataDir).store.load()[0];
  assert.equal(loaded.log.length, 60);
  assert.deepEqual(loaded.log.at(0), { n: 1, text: 'move 1' });
  assert.deepEqual(loaded.log.at(-1), { n: 60, text: 'move 60' });
});

test('each room is brought up to date as it is read, and one that cannot be is left behind rather than taking the rest down', () => {
  const dataDir = dir();
  const first = open(dataDir);
  first.store.put(room('a-b-c'));
  first.store.put(room('d-e-f'));
  first.store.flush();
  const second = open(dataDir, {
    migrate: (saved) => {
      if (saved.code === 'd-e-f') throw new Error('this one is past saving');
      return { ...saved, phase: 'migrated' };
    },
  });
  const loaded = second.store.load();
  assert.deepEqual(loaded.map((r) => r.code), ['a-b-c']);
  assert.equal(loaded[0].phase, 'migrated');
  assert.ok(second.logs.some((line) => line.includes('d-e-f')), 'and it says which one it could not read');
});

test('a room saved without a history comes back without one, which is not the same as an empty one', () => {
  // Dixnt and Tints and Hints both tell a room saved before histories existed from one whose history is empty, and
  // show the scores it already had as a single "earlier rounds" row.  Handing every room a `history: []` on the way
  // back would quietly take that telling-apart away, and the row would never appear again.
  const dataDir = dir();
  const first = open(dataDir);
  const old = room('a-b-c');
  delete old.history;
  first.store.put(old);
  first.store.put(room('d-e-f', { history: [] }));
  first.store.flush();
  const loaded = open(dataDir).store.load();
  const byCode = Object.fromEntries(loaded.map((r) => [r.code, r]));
  assert.equal('history' in byCode['a-b-c'], false, 'a room that never had one still has not');
  assert.deepEqual(byCode['d-e-f'].history, [], 'and one whose history is empty has an empty one');
});

test('saved games that cannot be read are kept aside rather than overwritten, and the site still starts', () => {
  const dataDir = dir();
  const first = open(dataDir);
  first.store.put(room('a-b-c'));
  first.store.close(); // the site is not running: this is a folder found damaged at the next start
  // Whatever the store saved into this folder, ruin it.  The test does not know the name of the file, which is the
  // point: a store that keeps its rooms some other way must still cope with the same accident.
  const saved = fs.readdirSync(dataDir);
  assert.ok(saved.length > 0, 'something was saved');
  for (const name of saved) fs.writeFileSync(path.join(dataDir, name), 'this is not a saved game at all');
  const second = open(dataDir);
  assert.deepEqual(second.store.load(), [], 'the site starts with no rooms rather than refusing to start');
  assert.ok(second.logs.length > 0, 'and says so');
  const after = fs.readdirSync(dataDir);
  assert.ok(after.some((name) => name.includes('corrupt')), `a copy was kept aside: ${after.join(', ')}`);
  // The next save must not throw, and must not take the copy with it.
  second.store.put(room('d-e-f'));
  second.store.flush();
  assert.deepEqual(open(dataDir).store.load().map((r) => r.code), ['d-e-f']);
});

test('close writes whatever is outstanding, so nothing is lost when the site stops', () => {
  const dataDir = dir();
  const first = open(dataDir);
  first.store.put(room('a-b-c'));
  first.store.close(); // no flush() of our own: close must do it
  assert.deepEqual(open(dataDir).store.load().map((r) => r.code), ['a-b-c']);
});
