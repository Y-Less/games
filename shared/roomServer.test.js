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
