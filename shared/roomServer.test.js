// Tests for the parts of shared/roomServer.js that need no sockets: a game's "what next" going wrong must never leave a room
// stuck or throw out of a timer. (The rest of the room server is exercised through each module's own tests.)
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as game from '../modules/hearts/game.js';
import { seeded } from './random.js';
import { botWait, createRoomServer } from './roomServer.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A server over one saved room, with a rules stub that only knows what loading and scheduling need. */
function serverWith(nextAction, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-'));
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([{ code: 'a-b-c', phase: 'playing', updatedAt: Date.now(), players: [] }]));
  const logs = [];
  const ctx = { io: new EventEmitter(), dataDir, log: (...args) => logs.push(args.map(String).join(' ')), codes: {}, stats: { record() {} } };
  const game = { isLive: () => true };
  const server = createRoomServer(ctx, { game, pickSettings: () => ({}), nextAction, registerEvents() {}, ...extra });
  return { server, logs, cleanup: () => { server.dispose(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('if working out the next move throws, it is logged and tried again, so the room is not left stuck', async (t) => {
  let calls = 0;
  let ran = false;
  const { logs, cleanup } = serverWith(() => {
    calls++;
    if (calls === 1) throw new Error('the rules broke');
    return ran ? null : { wait: 1, run: () => { ran = true; } };
  });
  t.after(cleanup);
  assert.equal(calls, 1, 'tried once while loading, and the throw did not escape');
  assert.ok(logs.some((line) => line.includes('the rules broke')), 'the failure was logged');
  await sleep(1300);
  assert.equal(ran, true, 'the move ran after the pause');
});

test('if a scheduled move throws, it is logged and retried; afterChange runs after the move that worked', async (t) => {
  let attempts = 0;
  let changes = 0;
  let done = false;
  const { logs, cleanup } = serverWith(
    () => (done ? null : { wait: 1, run: () => { attempts++; if (attempts === 1) throw new Error('a computer move failed'); done = true; } }),
    { afterChange: () => { changes++; } },
  );
  t.after(cleanup);
  await sleep(1300);
  assert.equal(attempts, 2, 'the failed move was tried again');
  assert.ok(logs.some((line) => line.includes('a computer move failed')));
  assert.equal(changes, 1, 'afterChange ran once, after the move that worked');
});

test('after too many failures in a row the room is left alone rather than retried for ever', async (t) => {
  let calls = 0;
  const { cleanup } = serverWith(() => {
    calls++;
    throw new Error('always broken');
  });
  t.after(cleanup);
  assert.equal(calls, 1);
  await sleep(3500); // retries come after 1 s, then 2 s: there is no tight loop
  assert.ok(calls <= 3, `retried only a few times (${calls})`);
});

/**
 * Plays computer moves of a real Hearts room through createRoomServer's nextAction path, using only the `rng` the server
 * hands to nextAction, and returns what happened: the wait chosen for each move and the hands afterwards.
 */
async function botMovesWith(seed, moves = 25) {
  const code = 'a-b-c';
  const room = game.createRoom({ code, hostId: 1, hostName: 'Ann', now: 0 });
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(99)); // the same deal every time: only the bots' own choices come from the server's rng
  room.seats[0] = { ...room.seats[1], id: 'bot:zero', name: 'Zero' }; // nobody is human, so every move is the server's
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-'));
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([room]));
  const waits = [];
  let done = null;
  const finished = new Promise((resolve) => { done = resolve; });
  const ctx = { io: new EventEmitter(), dataDir, log() {}, codes: {}, stats: { record() {} } };
  const server = createRoomServer(ctx, {
    game,
    pickSettings: () => ({}),
    registerEvents() {},
    rng: seeded(seed),
    now: () => 0,
    nextAction(live, rng) {
      if (waits.length >= moves) {
        done();
        return null;
      }
      const action = game.pendingAction(live);
      if (!action || action.type === 'resolve') return action ? { wait: 0, run: () => game.runPending(live, rng) } : null;
      const wait = botWait({ min: 0, max: 1 }, rng);
      waits.push(wait);
      return { wait, run: () => game.runPending(live, rng) };
    },
  });
  const keepAlive = setInterval(() => {}, 1000); // the server's timers are unref'd, so something must keep the test alive
  await finished;
  clearInterval(keepAlive);
  const hands = JSON.stringify(server.rooms.get(code).hands);
  server.dispose();
  fs.rmSync(dataDir, { recursive: true, force: true });
  return { waits, hands };
}

test('the same seed gives the same computer moves through nextAction, and another seed gives different ones', async () => {
  const first = await botMovesWith(5);
  const again = await botMovesWith(5);
  const other = await botMovesWith(6);
  assert.equal(first.waits.length, 25);
  assert.deepEqual(again, first);
  assert.notDeepEqual(other.waits, first.waits);
});

/** A fake socket: an event emitter with the data the room server reads, which records what it is sent. */
function fakeSocket(userId) {
  const socket = new EventEmitter();
  socket.data = { user: { id: userId, name: `User ${userId}` } };
  socket.sent = [];
  const emit = socket.emit.bind(socket);
  socket.emit = (event, payload) => (event === 'state' ? socket.sent.push(payload) : emit(event, payload));
  socket.ask = (event, payload = {}) => new Promise((resolve) => emit(event, payload, resolve));
  return socket;
}

test('leaving a finished list game, or starting another one, leaves the finished room as old as it was', async (t) => {
  // The roster rules leave a finished game alone (the standings keep everybody) and say `changed: false`; the room server
  // must then not stamp, save or re-send the room, or a finished room would be kept young for ever by its players moving on.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-'));
  const old = { code: 'a-b-c', phase: 'finished', updatedAt: 1000, players: [{ kind: 'human', id: 7, name: 'Ann' }] };
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([old]));
  const ctx = { io: new EventEmitter(), dataDir, log() {}, codes: { normalise: (c) => c ?? '', generate: () => 'd-e-f' }, stats: { record() {} } };
  let clock = 5000;
  const rules = {
    isLive: (room) => room.phase !== 'finished',
    isHuman: (p) => p.kind === 'human',
    hasPlayer: (room, id) => room.players.some((p) => p.id === id),
    seatOf: (room, id) => room.players.findIndex((p) => p.id === id),
    viewFor: (room) => ({ code: room.code }),
    removeHuman: (room) => (room.phase === 'finished' ? { ok: true, empty: false, changed: false } : { ok: true, empty: true }),
    createRoom: ({ code, hostId, hostName }) => ({ code, phase: 'lobby', updatedAt: clock, players: [{ kind: 'human', id: hostId, name: hostName }] }),
  };
  const server = createRoomServer(ctx, { game: rules, pickSettings: () => ({}), nextAction: () => null, registerEvents() {}, members: (room) => room.players, now: () => clock });
  t.after(() => { server.dispose(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const ann = fakeSocket(7);
  ctx.io.emit('connection', ann);
  assert.deepEqual(await ann.ask('resume', { code: 'a-b-c' }), { ok: true, code: 'a-b-c' }, 'the finished room can still be looked at');
  assert.deepEqual(await ann.ask('leave'), { ok: true });
  assert.equal(server.rooms.get('a-b-c').updatedAt, 1000, 'leaving did not touch the room');
  assert.deepEqual(ann.sent.at(-1), null, 'but the leaver was sent home');
  assert.deepEqual(await ann.ask('create'), { ok: true, code: 'd-e-f' });
  assert.equal(server.rooms.get('a-b-c').updatedAt, 1000, 'starting another game did not touch it either');
  assert.equal(server.rooms.size, 2);
});

/** The rules stub the socket tests use: list-style rooms, nothing hidden. */
function listRules(extra = {}) {
  return {
    isLive: (room) => room.phase !== 'finished',
    isHuman: (p) => p.kind === 'human',
    hasPlayer: (room, id) => room.players.some((p) => p.id === id),
    seatOf: (room, id) => room.players.findIndex((p) => p.id === id),
    viewFor: (room) => ({ code: room.code }),
    removeHuman: () => ({ ok: true, empty: true }),
    createRoom: ({ code, hostId, hostName }) => ({ code, phase: 'lobby', updatedAt: 0, players: [{ kind: 'human', id: hostId, name: hostName }] }),
    ...extra,
  };
}

test('one saved room that cannot be brought up to date is skipped and logged; the others still load', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-'));
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([{ code: 'good', phase: 'playing', updatedAt: 1000, players: [] }, { code: 'bad', phase: 'playing', updatedAt: 1000, players: [] }]));
  const logs = [];
  const ctx = { io: new EventEmitter(), dataDir, log: (...args) => logs.push(args.map(String).join(' ')), codes: {}, stats: { record() {} } };
  const migrate = (room) => {
    if (room.code === 'bad') throw new Error('unknown shape');
    return room;
  };
  const server = createRoomServer(ctx, { game: listRules(), pickSettings: () => ({}), nextAction: () => null, registerEvents() {}, members: (room) => room.players, migrate, now: () => 2000 });
  t.after(() => { server.dispose(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  assert.deepEqual([...server.rooms.keys()], ['good']);
  assert.ok(logs.some((line) => line.includes('bad') && line.includes('unknown shape')), 'the skipped room is named in the log');
});

test('the hourly sweep sends anybody still looking at a discarded room back to the menu', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-'));
  let clock = 10_000;
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([{ code: 'a-b-c', phase: 'playing', updatedAt: clock, players: [{ kind: 'human', id: 7, name: 'Ann' }] }]));
  const ctx = { io: new EventEmitter(), dataDir, log() {}, codes: { normalise: (c) => c ?? '' }, stats: { record() {} } };
  const server = createRoomServer(ctx, { game: listRules(), pickSettings: () => ({}), nextAction: () => null, registerEvents() {}, members: (room) => room.players, now: () => clock });
  t.after(() => { server.dispose(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const ann = fakeSocket(7);
  ctx.io.emit('connection', ann);
  ann.handlers = {};
  ann.emit('resume', {}, () => {});
  assert.deepEqual(ann.sent.at(-1), { code: 'a-b-c' }, 'Ann is looking at her live game');
  clock += 8 * 24 * 60 * 60 * 1000; // a week and a day later, with nobody having touched the room
  t.mock.timers.tick(60 * 60 * 1000);
  assert.equal(server.rooms.size, 0, 'the room was swept');
  assert.equal(ann.sent.at(-1), null, 'and Ann was sent home rather than left pointing at nothing');
  assert.equal(ann.data.code, null);
});

test('a room already stale when the server starts is swept during start-up, not left to crash it', (t) => {
  // The start-up sweep runs while createRoomServer is still building its closure, so anything it reaches has to exist
  // by then. A stale room with a person in it reaches detach, and through it every helper detach uses: a module whose
  // saved games had gone cold would otherwise fail to load at all, taking the whole game off the site.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-'));
  const now = 10 * 24 * 60 * 60 * 1000; // ten days in, so a week-old room is well past its keep
  fs.writeFileSync(
    path.join(dataDir, 'rooms.json'),
    JSON.stringify([
      { code: 'cold', phase: 'playing', updatedAt: 1000, players: [{ kind: 'human', id: 7, name: 'Ann' }] },
      { code: 'warm', phase: 'playing', updatedAt: now - 1000, players: [{ kind: 'human', id: 8, name: 'Bob' }] },
    ]),
  );
  const ctx = { io: new EventEmitter(), dataDir, log() {}, codes: { normalise: (c) => c ?? '' }, stats: { record() {} } };
  const server = createRoomServer(ctx, { game: listRules(), pickSettings: () => ({}), nextAction: () => null, registerEvents() {}, members: (room) => room.players, now: () => now });
  t.after(() => { server.dispose(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  assert.deepEqual([...server.rooms.keys()], ['warm'], 'the cold room went and the warm one stayed');
});
