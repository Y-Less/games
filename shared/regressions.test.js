// Regression tests for the shared code: bugs that were fixed in shared/ without a test being written for them at the
// time.  Each test names the commit it pins and says what went wrong, and each asserts what that commit's message says
// is right, so that taking the fix back out fails here rather than in front of a player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRoomServer } from './roomServer.js';
import { createRosterRules } from './roster.js';
import { seatScoreboardEntry } from './scores.js';
import { createSeatRules } from './seats.js';
import { until } from './testkit.js';

/** A fake socket: an event emitter with the data the room server reads, which records the states it is sent. */
function fakeSocket(userId) {
  const socket = new EventEmitter();
  socket.data = { user: { id: userId, name: `User ${userId}` } };
  socket.sent = [];
  const emit = socket.emit.bind(socket);
  socket.emit = (event, payload) => (event === 'state' ? socket.sent.push(payload) : emit(event, payload));
  socket.ask = (event, payload = {}) => new Promise((resolve) => emit(event, payload, resolve));
  return socket;
}

/**
 * A room server over one saved room with Ann (account 7) in it, driven by a rules stub that keeps a list of players.
 * @param {import('node:test').TestContext} t  the running test, whose `after` hook stops the server
 * @param {object} options  `rules` are added to the stub; the rest goes to createRoomServer
 * @returns {{ ctx: object, server: object }}
 */
function roomWithAnn(t, { rules = {}, ...options } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-regressions-'));
  const saved = { code: 'a-b-c', phase: 'playing', updatedAt: Date.now(), players: [{ kind: 'human', id: 7, name: 'Ann' }] };
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify([saved]));
  const ctx = { io: new EventEmitter(), dataDir, log() {}, codes: { normalise: (code) => code ?? '', generate: () => 'd-e-f' }, stats: { record() {} } };
  const game = {
    isLive: (room) => room.phase !== 'finished',
    isHuman: (player) => player.kind === 'human',
    hasPlayer: (room, id) => room.players.some((player) => player.id === id),
    seatOf: (room, id) => room.players.findIndex((player) => player.id === id),
    viewFor: (room) => ({ code: room.code }),
    removeHuman: () => ({ ok: true, empty: true }),
    ...rules,
  };
  const server = createRoomServer(ctx, { game, pickSettings: () => ({}), nextAction: () => null, registerEvents() {}, members: (room) => room.players, ...options });
  t.after(() => {
    server.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { ctx, server };
}

// 5e4b96e "A connection going now works out the room's next timer too".  A game that waits on somebody who has gone
// was only asked what it wanted next when something else happened, so a round sat there with nobody to move it on.
test('when the player a game is waiting on disconnects, the game is asked at once what happens next', async (t) => {
  let watching = false;
  let movedOn = false;
  const { ctx } = roomWithAnn(t, {
    // The game's rule: while the player it is waiting on is here, wait for them; once they have gone, move on without them.
    nextAction: (room, rng, now, { online }) => (watching && !movedOn && !online(7) ? { key: 'away', wait: 1, run: () => { movedOn = true; } } : null),
  });
  const ann = fakeSocket(7);
  ctx.io.emit('connection', ann);
  assert.deepEqual(await ann.ask('resume', { code: 'a-b-c' }), { ok: true, code: 'a-b-c' });
  watching = true;
  assert.equal(movedOn, false, 'nothing moves while she is here');
  ann.emit('disconnect');
  // Nothing else happens to the room from here on: her going is the only thing that can have set the timer.
  await until(() => movedOn, 'the game to move on without the player who left');
});

// 315e008 "A refusal keeps the values its words need on the way to the client".  A refused kick was answered with
// the code alone, so a sentence with a number in it reached the player with the gap still there.
test('a refused kick reaches the client with the values its sentence needs', async (t) => {
  const { ctx } = roomWithAnn(t, { rules: { kick: () => ({ ok: false, error: 'minPlayers', params: { min: 3 } }) } });
  const ann = fakeSocket(7);
  ctx.io.emit('connection', ann);
  assert.equal((await ann.ask('resume', { code: 'a-b-c' })).ok, true);
  assert.deepEqual(await ann.ask('kick', { slot: 's1' }), { ok: false, error: 'minPlayers', params: { min: 3 } });
});

// 0084e81 "Room server: reset retries on any change, survive one bad saved room, detach swept rooms; share bot
// naming".  A run of failed scheduled moves was only forgotten when a scheduled move worked, so a room that had used
// up its retries got one attempt and no retries for the rest of its life, whatever anybody did in it.
test('a room that has used up its retries is retried afresh once somebody does something in it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); // the retry pauses are seconds long: step through them instead of waiting
  let calls = 0;
  const { ctx } = roomWithAnn(t, {
    nextAction: () => {
      calls += 1;
      throw new Error('the rules broke');
    },
    registerEvents: ({ on, act }) => on('poke', () => act(() => ({ ok: true }))),
  });
  // Let every retry it is going to make on its own happen: far longer than the doubling pauses add up to.
  for (let i = 0; i < 20; i++) t.mock.timers.tick(60 * 1000);
  const before = calls;
  for (let i = 0; i < 20; i++) t.mock.timers.tick(60 * 1000);
  assert.equal(calls, before, 'left alone, the room has given up rather than retrying for ever');

  const ann = fakeSocket(7);
  ctx.io.emit('connection', ann);
  assert.equal((await ann.ask('resume', { code: 'a-b-c' })).ok, true);
  assert.deepEqual(await ann.ask('poke'), { ok: true });
  const afterPoke = calls;
  assert.ok(afterPoke > before, 'her move had the next one worked out again');
  for (let i = 0; i < 20; i++) t.mock.timers.tick(60 * 1000);
  assert.ok(calls > afterPoke, 'and when that failed too it was tried again, as it would be in a room that had never failed');
});

// 5debb2b "Hearts and Cheat: keep a gone marker when a person leaves a finished game, instead of a null seat".  The
// marker is not a person, so the shared scoreboard entry showed somebody who had left the table as still being there.
test('the seat of a person who left a finished game is shown as away on the scoreboard', () => {
  const entry = seatScoreboardEntry({ kind: 'gone', name: 'Ann' }, 0, { score: 26, me: 1, current: false, online: () => true });
  assert.equal(entry.away, true, 'they have gone, whoever else is connected');
  assert.equal(entry.name, 'Ann', 'and their name stays on the final scores');
});

// e614659 "Never let Number() or String() throw on a client payload".  fillBots passed whatever the client sent
// straight to Number(), which throws for an object that cannot become a primitive, so a hostile payload was a crash
// in a socket handler where an answer was due.
test('filling with computer players never throws on a target that cannot be made into a number', () => {
  // Both of these make Number() and String() throw a TypeError.
  const unconvertible = () => [Object.create(null), { toString: 'x', valueOf: 'y' }];

  // Whether such a target is refused or read as "the usual table" is not what the fix decided; that the host is
  // answered as a rule answers, rather than with a TypeError, is.
  const seats = createSeatRules({ minPlayers: 2, maxPlayers: 3, fillTo: 3, isMidGame: (room) => room.phase === 'playing' });
  const table = () => ({ hostId: 1, phase: 'lobby', nextBot: 1, seats: [{ kind: 'human', id: 1, name: 'Ann' }, null, null] });
  const usual = table();
  assert.equal(seats.fillWithBots(usual, 1, 3).ok, true, 'the same host at the same table is filled when the target is a number');
  assert.equal(usual.seats.filter(Boolean).length, 3, 'so what follows gets as far as reading the target');
  for (const target of unconvertible()) {
    let outcome;
    assert.doesNotThrow(() => { outcome = seats.fillWithBots(table(), 1, target); }, 'a game with seats');
    assert.equal(typeof outcome.ok, 'boolean', 'it answers as a rule does');
  }

  const roster = createRosterRules({ isLive: (room) => room.phase !== 'finished', minPlayers: 2, maxPlayers: 4, makePlayer: (room, base) => ({ ...base }) });
  const list = () => ({ hostId: 1, phase: 'lobby', nextBot: 1, nextSlot: 1, players: [{ kind: 'human', id: 1, name: 'Ann', slot: 's0' }] });
  const usualList = list();
  assert.equal(roster.fillWithBots(usualList, 1, 3).ok, true, 'and the same for a game with a list of players');
  assert.equal(usualList.players.length, 3);
  for (const target of unconvertible()) {
    let outcome;
    assert.doesNotThrow(() => { outcome = roster.fillWithBots(list(), 1, target); }, 'a game with a list of players');
    assert.equal(typeof outcome.ok, 'boolean', 'it answers as a rule does');
  }
});
