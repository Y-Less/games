// Tests for the parts of shared/roomServer.js that need no sockets: a game's "what next" going wrong must never leave a room
// stuck or throw out of a timer.  (The rest of the room server is exercised through each module's own tests.)
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as bot from '../modules/hearts/bot.js';
import * as game from '../modules/hearts/game.js';
import { seeded } from './random.js';
import { botWait, createRoomServer } from './roomServer.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A server over one saved room, with a rules stub that only knows what loading and scheduling need. */
function serverWith(nextAction, extra = {}, saved = JSON.stringify([{ code: 'a-b-c', phase: 'playing', updatedAt: Date.now(), players: [] }])) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-server-'));
  fs.writeFileSync(path.join(dataDir, 'rooms.json'), saved);
  const logs = [];
  const ctx = { io: new EventEmitter(), dataDir, log: (...args) => logs.push(args.map(String).join(' ')), codes: {}, stats: { record() {} } };
  const game = { isLive: () => true };
  const server = createRoomServer(ctx, { game, pickSettings: () => ({}), nextAction, registerEvents() {}, ...extra });
  return { server, logs, dataDir, cleanup: () => { server.dispose(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

test('a saved-games file that cannot be read is kept beside the new one, not quietly overwritten', (t) => {
  const { logs, dataDir, cleanup } = serverWith(() => null, {}, '[ not json');
  t.after(cleanup);
  assert.ok(logs.some((line) => line.includes('corrupt')), `logged: ${logs.join(' | ')}`);
  assert.equal(fs.readFileSync(path.join(dataDir, 'rooms.json.corrupt'), 'utf8'), '[ not json');
});

test('one room that cannot be brought up to date is skipped, the others load, and a copy of the file is kept', (t) => {
  const rooms = JSON.stringify([{ code: 'good' }, { code: 'bad' }]);
  const { server, logs, dataDir, cleanup } = serverWith(() => null, { migrate: (room) => { if (room.code === 'bad') throw new Error('too old'); return room; } }, rooms);
  t.after(cleanup);
  assert.deepEqual([...server.rooms.keys()], ['good']);
  assert.ok(logs.some((line) => line.includes('bad')));
  assert.equal(fs.existsSync(path.join(dataDir, 'rooms.json.imported')), true, 'the file it came from is kept');
});

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
      const action = bot.pendingAction(live);
      if (!action || action.type === 'resolve') return action ? { wait: 0, run: () => bot.runPending(live, rng) } : null;
      const wait = botWait({ min: 0, max: 1 }, rng);
      waits.push(wait);
      return { wait, run: () => bot.runPending(live, rng) };
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
  // must then not stamp, save, or re-send the room, or a finished room would be kept young for ever by its players moving on.
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
  // by then.  A stale room with a person in it reaches detach, and through it every helper detach uses: a module whose
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

// ---- opening a room for somebody else, and saying when it is over ----
//
// Both are for a part of the site that runs games on other people's behalf (a tour, which picks a game by vote and
// sends everybody to it).  Neither has anything to do with the rules, so both are tested here rather than in a game.

/** A server over an empty folder, with codes, for the openFor tests.  `rules` replaces the game. */
function openable(t, rules, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'room-open-'));
  const logs = [];
  let made = 0;
  const ctx = {
    io: new EventEmitter(),
    dataDir,
    log: (...args) => logs.push(args.map(String).join(' ')),
    codes: { generate: () => `boss-aware-${(made += 1)}`, normalise: (c) => c ?? '' },
    stats: { record() {} },
  };
  const server = createRoomServer(ctx, { game: rules, pickSettings: (p) => p, nextAction: () => null, registerEvents() {}, rng: seeded(7), ...extra });
  t.after(() => { server.dispose(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { server, logs };
}

test('openFor seats the people it is given, fills up with computer players, starts the game and saves it', (t) => {
  const { server } = openable(t, game); // the real Hearts rules: a game opened this way is a game like any other
  const opened = server.openFor({ hostId: 1, hostName: 'Ann', people: [{ id: 2, name: 'Bob' }], size: 4 });
  assert.equal(opened.ok, true, opened.error);
  assert.deepEqual(opened.seated, [1, 2], 'it says who actually got in');
  const room = server.rooms.get(opened.code);
  assert.ok(room, 'the room was kept');
  assert.notEqual(room.phase, 'lobby', 'and it is already under way: nobody has to press Start');
  assert.equal(room.seats.length, 4);
  assert.deepEqual(room.seats.filter(game.isHuman).map((s) => s.id), [1, 2]);
  assert.equal(room.seats.filter(game.isBot).length, 2, 'the rest are computer players');
});

test('openFor leaves out anybody the game will not seat, rather than refusing the lot', (t) => {
  const { server } = openable(t, game);
  // Hearts holds seven; the eighth person cannot be seated, and the other seven still get their game.
  const people = [2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, name: `P${id}` }));
  const opened = server.openFor({ hostId: 1, hostName: 'Ann', people, size: 7 });
  assert.equal(opened.ok, true, opened.error);
  assert.deepEqual(opened.seated, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(server.rooms.get(opened.code).seats.length, 7);
});

test('a rules refusal while opening comes back as an answer, and a rules throw does not escape', (t) => {
  const refusing = { isLive: () => true, createRoom: ({ code }) => ({ code, phase: 'lobby', seats: [] }), addHuman: () => ({ ok: true }), fillWithBots: () => ({ ok: true }), start: () => ({ ok: false, error: 'minPlayers', params: { min: 3 } }) };
  const { server } = openable(t, refusing);
  assert.deepEqual(server.openFor({ hostId: 1, hostName: 'Ann' }), { ok: false, error: 'minPlayers', params: { min: 3 } });

  const throwing = { isLive: () => true, createRoom: () => { throw new Error('Play to 61 or 121.'); } };
  const { server: second, logs } = openable(t, throwing);
  const outcome = second.openFor({ hostId: 1, hostName: 'Ann' });
  assert.equal(outcome.ok, false, 'a throw out of the rules is an answer, not a crash');
  assert.ok(logs.some((line) => line.includes('Play to 61 or 121.')), `logged: ${logs.join(' | ')}`);
});

test('a finished game tells the site once, however many times the room changes afterwards', async (t) => {
  const finished = [];
  let ran = 0;
  const { cleanup } = serverWith(
    (room) => ({ wait: 1, run: () => { ran += 1; room.phase = 'finished'; } }),
    { game: { isLive: () => true, statsPlayers: () => [] }, members: (room) => room.players, onFinished: (room) => finished.push(room.code) },
  );
  t.after(cleanup);
  await sleep(60);
  assert.ok(ran >= 2, `the room changed ${ran} times, so it was told more than once if it was going to be`);
  assert.deepEqual(finished, ['a-b-c']);
});

test('a watcher of finished games that throws is logged, and the game is still recorded', async (t) => {
  let recorded = 0;
  const { cleanup, logs } = serverWith(
    (room) => ({ wait: 1, run: () => { room.phase = 'finished'; } }),
    {
      game: { isLive: () => true, statsPlayers: () => { recorded += 1; return []; } },
      members: (room) => room.players,
      onFinished: () => { throw new Error('the tour fell over'); },
    },
  );
  t.after(cleanup);
  await sleep(60);
  assert.equal(recorded, 1, 'the statistics were taken, once, despite the watcher');
  assert.ok(logs.some((line) => line.includes('the tour fell over')), `logged: ${logs.join(' | ')}`);
});

// The list of the games somebody has on the go (`gamesOf`), which the site gathers across every module and puts on
// the home page.  Rooms are saved and loaded rather than played here, so that each rule about what makes a row can be
// said in one line.  What a tournament makes of it is in shared/tournamentServer.test.js, where there is one to ask.
const listingGame = { isLive: (room) => room.phase !== 'finished', isHuman: (member) => member?.kind === 'human' };
/** One saved room of a list game, as recent as the sweep needs it to be. */
const savedRoom = (code, phase, players, ago) => ({ code, phase, players, updatedAt: Date.now() - ago });
/** A server over these saved rooms, listing with the rules above. */
const listing = (t, rooms) => {
  const { server, cleanup } = serverWith(() => null, { game: listingGame, members: (room) => room.players }, JSON.stringify(rooms));
  t.after(cleanup);
  return server;
};

test('the games you have on the go: every unfinished room you are in, the newest first, saying who else is at it', (t) => {
  const server = listing(t, [
    savedRoom('one-two-three', 'lobby', [{ kind: 'human', id: 1, name: 'Ann' }, { kind: 'human', id: 2, name: 'Bob' }], 3000),
    savedRoom('four-five-six', 'playing', [{ kind: 'human', id: 1, name: 'Ann' }, { kind: 'bot', id: 'bot:1', name: 'Hazel' }], 1000),
    savedRoom('over-and-done', 'finished', [{ kind: 'human', id: 1, name: 'Ann' }, { kind: 'human', id: 3, name: 'Cal' }], 500),
  ]);

  const mine = server.gamesOf(1);
  assert.deepEqual(mine.map((row) => row.code), ['four-five-six', 'one-two-three'], 'the newest news first, and a game that is over is not news');
  assert.deepEqual(mine.map((row) => row.kind), ['game', 'game']);
  assert.deepEqual(mine.map((row) => row.lobby), [false, true], 'a game still waiting for people says so');
  assert.deepEqual(mine[0].others, ['Hazel'], 'the computer players are company too');
  assert.deepEqual(mine[1].others, ['Bob']);
  assert.deepEqual(server.gamesOf(2).map((row) => row.code), ['one-two-three'], 'each person is told their own');
  assert.deepEqual(server.gamesOf(9), [], 'somebody who is in nothing is in nothing');
});

test('somebody who has left a game is neither given it back nor counted among the people still at it', (t) => {
  // A list game keeps whoever left on its standings, marked `left`, so the room still names them: they are not one
  // of its people, and a row for them would offer a game they walked out of.
  const server = listing(t, [savedRoom('one-two-three', 'playing', [{ kind: 'human', id: 1, name: 'Ann' }, { kind: 'human', id: 2, name: 'Bob', left: true }], 1000)]);
  assert.deepEqual(server.gamesOf(2), []);
  assert.deepEqual(server.gamesOf(1)[0].others, [], 'and Ann is not told she is playing Bob');
});
