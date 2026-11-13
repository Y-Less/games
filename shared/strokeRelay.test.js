// The live drawing half of a drawing game (shared/strokeRelay.js): the boards of the turn being drawn, the strokes
// going from whoever is drawing to everybody else, and the picture a computer player paints.  Scribblers and Draw!
// both stand on it, and their own tests reach it only through a whole site.  What is protected here, directly:
//
//   - only whoever may draw changes a board, and whatever they send, the board holds nothing but real instructions;
//   - what is relayed is exactly what was kept, so somebody following the stream has the same picture as the server;
//   - a board is known by its place and belongs to its turn: it survives a change of drawer and not a change of turn;
//   - a computer player's picture goes on once a turn, at its pace, and stops when the turn moves on.
//
// The strokes arrive from a socket, so much of this file is sending it things no honest client would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRUSH, MAX_BATCH, MAX_OPS, readOp } from './drawing.js';
import { testPicture } from './picture.js';
import { seeded } from './random.js';
import { BOT_STROKE_RATE, STROKE_TICK, createStrokeRelay, pause, pictureSource, readRate } from './strokeRelay.js';
import { assertNoPollution, garbageValues, prototypeNames } from './testkit.js';

const line = (x, extra = {}) => ({ x, y: 10, x2: x + 5, y2: 20, c: 3, w: BRUSH.min, ...extra });
const kept = (x, extra = {}) => ({ t: 'line', ...line(x, extra) });
const fill = (x, extra = {}) => ({ x, y: 10, c: 5, ...extra });

/**
 * One game's relay with a room in the middle of a turn, and a way to be any of the people in it.  Users 1 and 2 draw
 * (on boards 0 and 1 when the game has two); user 3 watches.  `as(id)` is that person's socket: `send(event, payload)`
 * goes through the same wrapper shared/roomServer.js puts round a handler (anything that is not an object becomes {},
 * and a handler that returns nothing has said { ok: true }), and `got` is what was emitted to that socket alone.
 */
function rig(options = {}) {
  const room = { code: 'a-b-c', phase: 'drawing', turn: 1, drawers: [1, 2], words: ['cat', 'dog'] };
  const state = { room, clock: 1000 };
  const relayed = []; // every call to the room server's relay: { room, event, payload, options }
  const logs = [];
  const boards = options.boards ?? 1;
  const relay = createStrokeRelay({
    ctx: { log: (...args) => logs.push(args.map(String).join(' ')) },
    game: { canDraw: (r, id) => r.phase === 'drawing' && r.drawers.includes(id) },
    turnKey: (r) => r.turn,
    wordFor: (r, board) => r.words[board],
    pictureFor: async () => ({ ops: [] }),
    botRate: 1000,
    ...(boards > 1 ? { boards: () => boards, boardOf: (r, id) => r.drawers.indexOf(id), label: (board) => ({ board }) } : {}),
    ...options.relay,
  });
  const send = (...args) => relayed.push({ room: args[0], event: args[1], payload: args[2], options: args[3] });
  const people = new Map();
  const as = (userId) => {
    if (people.has(userId)) return people.get(userId);
    const handlers = {};
    const got = [];
    relay.registerEvents({
      on: (event, handler) => {
        handlers[event] = (payload) => handler(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) ?? { ok: true };
      },
      userId,
      socket: { emit: (event, payload) => got.push({ event, payload }) },
      now: () => state.clock,
      roomOf: () => state.room ?? undefined,
      relay: send,
    });
    const person = { handlers, got, send: (event, payload) => handlers[event](payload) };
    people.set(userId, person);
    return person;
  };
  return { relay, room, state, relayed, logs, as, send };
}

/** Keeps the process alive while a picture is painted: the relay's own timers are unreferenced, on purpose. */
const keepAlive = (t) => {
  const timer = setInterval(() => {}, 1000);
  t.after(() => clearInterval(timer));
};

/** The instructions of every message, end to end. */
const opsOf = (messages) => messages.flatMap((message) => message.payload.ops);

// ---- the events ----

test('the relay handles the six events its header lists, and no others', () => {
  const { as } = rig();
  assert.deepEqual(Object.keys(as(1).handlers).sort(), ['canvas', 'clear', 'draw', 'fill', 'line', 'undo']);
});

test('a line from the drawer is kept on the board and passed to everybody else, but not sent back to them', () => {
  const { relay, room, relayed, as } = rig();
  assert.deepEqual(as(1).send('line', line(100)), { ok: true });
  assert.deepEqual(relay.canvasOf(room).ops, [kept(100)]);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].room, room);
  assert.equal(relayed[0].event, 'draw');
  assert.deepEqual(relayed[0].payload, { ops: [kept(100)] });
  assert.deepEqual(relayed[0].options, { except: 1 });
  assert.deepEqual(as(1).got, [], 'nothing comes back to the socket that drew it');
});

test('a fill is kept and relayed the same way', () => {
  const { relay, room, relayed, as } = rig();
  assert.deepEqual(as(1).send('fill', fill(200)), { ok: true });
  assert.deepEqual(relay.canvasOf(room).ops, [{ t: 'fill', x: 200, y: 10, c: 5 }]);
  assert.deepEqual(relayed[0].payload, { ops: [{ t: 'fill', x: 200, y: 10, c: 5 }] });
});

test('the event name says what the instruction is, whatever the payload claims', () => {
  const { relay, room, as } = rig();
  as(1).send('line', { ...line(100), t: 'fill' });
  as(1).send('fill', { ...fill(200), t: 'line', x2: 1, y2: 1, w: 8 });
  assert.deepEqual(relay.canvasOf(room).ops.map((op) => op.t), ['line', 'fill']);
});

test('a batch is kept in the order it was sent, with anything that is not an instruction left out', () => {
  const { relay, room, relayed, as } = rig();
  const reply = as(1).send('draw', { ops: [{ t: 'line', ...line(1) }, null, 'line', { t: 'circle', x: 1 }, { t: 'fill', ...fill(2) }, [], { t: 'line', ...line(3) }] });
  assert.deepEqual(reply, { ok: true });
  const expected = [kept(1), { t: 'fill', x: 2, y: 10, c: 5 }, kept(3)];
  assert.deepEqual(relay.canvasOf(room).ops, expected);
  assert.deepEqual(relayed.map((message) => message.payload), [{ ops: expected }]);
});

test('what is relayed is the instruction as the server read it, not as the client wrote it', () => {
  const { relayed, as } = rig();
  as(1).send('line', { ...line(100), w: 5000, extra: 'ignored', c: '3' });
  assert.deepEqual(relayed[0].payload.ops, [kept(100, { w: BRUSH.max })], 'brought into range, and nothing the client added is passed on');
});

test('a message that holds no instruction at all is refused, and nothing is kept or relayed', () => {
  const { relay, room, relayed, as } = rig();
  const drawer = as(1);
  for (const [label, value] of garbageValues()) {
    assert.deepEqual(drawer.send('line', value), { ok: false, error: 'badDrawing' }, `line: ${label}`);
    assert.deepEqual(drawer.send('fill', value), { ok: false, error: 'badDrawing' }, `fill: ${label}`);
    assert.deepEqual(drawer.send('draw', value), { ok: false, error: 'badDrawing' }, `draw: ${label}`);
    assert.deepEqual(drawer.send('draw', { ops: value }), { ok: false, error: 'badDrawing' }, `draw with ops = ${label}`);
    assert.deepEqual(drawer.send('draw', { ops: [value, value] }), { ok: false, error: 'badDrawing' }, `draw with ops of ${label}`);
  }
  assert.deepEqual(relay.canvasOf(room).ops, []);
  assert.deepEqual(relayed, []);
});

test('one message carries at most a batch: the rest of an oversized one is dropped, not kept for later', () => {
  const { relay, room, relayed, as } = rig();
  const many = Array.from({ length: MAX_BATCH + 300 }, (_, i) => ({ t: 'line', ...line(i % 1000) }));
  assert.deepEqual(as(1).send('draw', { ops: many }), { ok: true });
  assert.equal(relay.canvasOf(room).ops.length, MAX_BATCH);
  assert.deepEqual(relay.canvasOf(room).ops.at(-1), kept((MAX_BATCH - 1) % 1000), 'the first of them are the ones kept');
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].payload.ops.length, MAX_BATCH);
});

test('a board that is full takes no more, and nothing is relayed that was not kept', () => {
  const { relay, room, relayed, as } = rig();
  const batch = Array.from({ length: MAX_BATCH }, (_, i) => ({ t: 'line', ...line(i) }));
  for (let sent = 0; sent < MAX_OPS + 2 * MAX_BATCH; sent += MAX_BATCH) assert.equal(as(1).send('draw', { ops: batch }).ok, true);
  assert.equal(relay.canvasOf(room).ops.length, MAX_OPS);
  assert.equal(opsOf(relayed).length, MAX_OPS, 'everybody else was sent exactly what is on the board');
  assert.ok(relayed.every((message) => message.payload.ops.length >= 1), 'and never an empty message');
});

test('somebody who is not drawing cannot draw, clear, or undo, and the board is as it was', () => {
  const { relay, room, relayed, as } = rig();
  as(1).send('line', line(100));
  relayed.length = 0;
  const watcher = as(3);
  for (const [event, payload] of [['line', line(1)], ['fill', fill(1)], ['draw', { ops: [{ t: 'line', ...line(1) }] }], ['clear', {}], ['undo', {}]]) {
    assert.deepEqual(watcher.send(event, payload), { ok: false, error: 'notYourTurnToDraw' }, event);
  }
  assert.deepEqual(relay.canvasOf(room).ops, [kept(100)]);
  assert.deepEqual(relayed, []);
  assert.deepEqual(watcher.got, []);
});

test('a socket that is in no game is told so, for every event', () => {
  const { state, relayed, as } = rig();
  state.room = null;
  const nobody = as(1);
  for (const event of ['line', 'fill', 'draw', 'clear', 'undo', 'canvas']) {
    assert.deepEqual(nobody.send(event, event === 'draw' ? { ops: [{ t: 'line', ...line(1) }] } : line(1)), { ok: false, error: 'notInAnyGame' }, event);
  }
  assert.deepEqual(relayed, []);
  assert.deepEqual(nobody.got, []);
});

test('clearing empties the board and tells everybody, the drawer included, to start afresh', () => {
  const { relay, room, relayed, as } = rig();
  as(1).send('line', line(100));
  relayed.length = 0;
  assert.deepEqual(as(1).send('clear'), { ok: true });
  assert.deepEqual(relay.canvasOf(room).ops, []);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].event, 'canvas');
  assert.deepEqual(relayed[0].payload, { ops: [], first: true, done: true });
  assert.equal(relayed[0].options?.except ?? null, null, 'it goes to everybody in the room, the drawer included');
});

test('clearing a board that is already empty is allowed and sends nothing', () => {
  const { relayed, as } = rig();
  assert.deepEqual(as(1).send('clear'), { ok: true });
  assert.deepEqual(relayed, []);
});

test('undo takes off the last stroke, where lines that came without a pause are one stroke, and sends everybody the board as it now stands', () => {
  const { relay, room, state, relayed, as } = rig();
  const drawer = as(1);
  drawer.send('line', line(1));
  state.clock += 50;
  drawer.send('line', line(2)); // the same drag of the pen
  state.clock += 2000;
  drawer.send('line', line(3)); // a new stroke
  relayed.length = 0;
  assert.deepEqual(drawer.send('undo'), { ok: true });
  assert.deepEqual(relay.canvasOf(room).ops, [kept(1), kept(2)]);
  assert.deepEqual(relayed.map((message) => [message.event, message.payload]), [['canvas', { ops: [kept(1), kept(2)], first: true, done: true }]]);
  assert.equal(relayed[0].options?.except ?? null, null);
  drawer.send('undo');
  assert.deepEqual(relay.canvasOf(room).ops, []);
  assert.deepEqual(relayed.at(-1).payload, { ops: [], first: true, done: true });
});

test('undo with nothing to undo is allowed and sends nothing', () => {
  const { relayed, as } = rig();
  assert.deepEqual(as(1).send('undo'), { ok: true });
  assert.deepEqual(relayed, []);
});

test('the game is told of every undo, after it has been attempted, with the room, the drawing, who, and the server’s clock', () => {
  const calls = [];
  const { relay, room, state, as } = rig({ relay: { onUndo: (...args) => calls.push({ args, opsThen: args[1].ops.length }) } });
  as(1).send('fill', fill(1));
  state.clock = 4321;
  as(1).send('undo');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [room, relay.canvasOf(room), 1, 4321]);
  assert.equal(calls[0].opsThen, 0, 'the stroke had already gone when the game was told');
  as(1).send('undo'); // nothing left to take off: attempted all the same
  assert.equal(calls.length, 2);
  as(3).send('undo'); // not allowed to: not attempted
  assert.equal(calls.length, 2);
});

test('anybody in the room may ask for the board as it stands, and it is sent to their socket alone', () => {
  const { relayed, as } = rig();
  as(1).send('line', line(100));
  as(1).send('fill', fill(200));
  relayed.length = 0;
  const watcher = as(3);
  assert.deepEqual(watcher.send('canvas'), { ok: true });
  assert.deepEqual(watcher.got, [{ event: 'canvas', payload: { ops: [kept(100), { t: 'fill', x: 200, y: 10, c: 5 }], first: true, done: true } }]);
  assert.deepEqual(relayed, [], 'nobody else is sent a board they already have');
  assert.deepEqual(as(1).got, []);
});

test('a big board is sent in chunks: the first marked to start afresh, the last marked done, none bigger than a batch', () => {
  const { relay, room, as } = rig();
  const batch = Array.from({ length: MAX_BATCH }, (_, i) => ({ t: 'line', ...line(i) }));
  as(1).send('draw', { ops: batch });
  as(1).send('draw', { ops: batch });
  as(1).send('draw', { ops: batch.slice(0, 7) });
  const watcher = as(3);
  watcher.send('canvas');
  assert.equal(watcher.got.length, 3);
  assert.ok(watcher.got.every((message) => message.event === 'canvas' && message.payload.ops.length <= MAX_BATCH));
  assert.deepEqual(watcher.got.map((message) => [message.payload.first, message.payload.done]), [[true, false], [false, false], [false, true]]);
  assert.deepEqual(opsOf(watcher.got), relay.canvasOf(room).ops);
});

test('a room that is not being drawn on answers with an empty board, which is how a client clears what it was showing', () => {
  const { room, as } = rig();
  as(1).send('line', line(100));
  room.phase = 'finished';
  const watcher = as(3);
  assert.deepEqual(watcher.send('canvas'), { ok: true });
  assert.deepEqual(watcher.got, [{ event: 'canvas', payload: { ops: [], first: true, done: true } }]);
});

// ---- more than one board ----

test('with a board each, a stroke goes on its drawer’s board and says which on the wire', () => {
  const { relay, room, relayed, as } = rig({ boards: 2 });
  as(1).send('line', line(100));
  as(2).send('line', line(200));
  assert.deepEqual(relay.canvasOf(room, 0).ops, [kept(100)]);
  assert.deepEqual(relay.canvasOf(room, 1).ops, [kept(200)]);
  assert.deepEqual(relayed.map((message) => message.payload), [{ board: 0, ops: [kept(100)] }, { board: 1, ops: [kept(200)] }]);
  assert.deepEqual(relayed.map((message) => message.options), [{ except: 1 }, { except: 2 }]);
});

test('clear and undo touch only the drawer’s own board, and name it', () => {
  const { relay, room, relayed, as } = rig({ boards: 2 });
  as(1).send('line', line(100));
  as(2).send('line', line(200));
  relayed.length = 0;
  as(2).send('undo');
  assert.deepEqual(relayed.map((message) => message.payload), [{ board: 1, ops: [], first: true, done: true }]);
  as(1).send('clear');
  assert.deepEqual(relayed.at(-1).payload, { board: 0, ops: [], first: true, done: true });
  assert.deepEqual(relay.canvasOf(room, 0).ops, []);
  assert.deepEqual(relay.canvasOf(room, 1).ops, []);
});

test('asking for the canvas brings every board, each under its own name, in a turn and out of one', () => {
  const { room, as } = rig({ boards: 2 });
  as(2).send('line', line(200));
  const watcher = as(3);
  watcher.send('canvas');
  assert.deepEqual(watcher.got.map((message) => message.payload), [
    { board: 0, ops: [], first: true, done: true },
    { board: 1, ops: [kept(200)], first: true, done: true },
  ]);
  watcher.got.length = 0;
  room.phase = 'finished';
  watcher.send('canvas');
  assert.deepEqual(watcher.got.map((message) => message.payload), [
    { board: 0, ops: [], first: true, done: true },
    { board: 1, ops: [], first: true, done: true },
  ]);
});

// ---- a board belongs to its place and its turn ----

test('a board is known by its place, so whoever takes over a place mid-turn inherits what is already on it', () => {
  const { relay, room, as } = rig({ boards: 2 });
  as(2).send('line', line(200));
  room.drawers = [1, 9]; // somebody else now holds the second place
  as(9).send('line', line(300));
  assert.deepEqual(relay.canvasOf(room, 1).ops, [kept(200), kept(300)]);
  assert.equal(relay.pictureDue(room, 1), false, 'and a computer player standing in would not paint over it');
});

test('the boards are kept for as long as the turn is the same one, and are fresh when it moves on', () => {
  const { relay, room, as } = rig({ boards: 2 });
  as(1).send('line', line(100));
  as(2).send('fill', fill(200));
  const first = relay.canvasOf(room, 0);
  assert.equal(relay.canvasOf(room, 0), first, 'the same drawing each time it is asked for');
  room.turn = 2;
  assert.deepEqual(relay.canvasOf(room, 0).ops, []);
  assert.deepEqual(relay.canvasOf(room, 1).ops, []);
  as(1).send('line', line(300));
  assert.deepEqual(relay.canvasOf(room, 0).ops, [kept(300)], 'strokes of the new turn go on the new board');
});

test('each room has its own boards', () => {
  const { relay, room, state, as } = rig();
  as(1).send('line', line(100));
  const other = { ...room, code: 'd-e-f' };
  state.room = other;
  as(1).send('line', line(200));
  assert.deepEqual(relay.canvasOf(room).ops, [kept(100)]);
  assert.deepEqual(relay.canvasOf(other).ops, [kept(200)]);
});

test('the boards of a room are forgotten once it is doing something else, but not between the turns of a drawing', () => {
  const { relay, room, as } = rig();
  as(1).send('line', line(100));
  relay.forget(room);
  assert.deepEqual(relay.canvasOf(room).ops, [kept(100)], 'still being drawn on');
  room.phase = 'between';
  relay.forget(room);
  assert.deepEqual(relay.canvasOf(room).ops, [kept(100)], 'the pause after a turn still shows the picture');
  room.phase = 'finished';
  relay.forget(room);
  room.phase = 'drawing';
  assert.deepEqual(relay.canvasOf(room).ops, [], 'the room holds no canvas it will never show again');
});

test('a game may say for itself when a room still needs its boards', () => {
  const { relay, room, as } = rig({ relay: { drawingNow: (r) => r.keep === true } });
  as(1).send('line', line(100));
  room.keep = true;
  relay.forget(room);
  assert.deepEqual(relay.canvasOf(room).ops, [kept(100)]);
  room.keep = false;
  relay.forget(room);
  assert.deepEqual(relay.canvasOf(room).ops, []);
});

// ---- a computer player's picture ----

test('a board is due its computer player’s picture while it is empty, and not once somebody has drawn on it', () => {
  const { relay, room, as } = rig({ boards: 2 });
  assert.equal(relay.pictureDue(room, 0), true, 'before anything has happened in the turn');
  assert.equal(relay.pictureDue(room, 1), true);
  as(2).send('line', line(200));
  assert.equal(relay.pictureDue(room, 1), false);
  assert.equal(relay.pictureDue(room, 0), true, 'the other board is still empty');
  room.turn = 2;
  assert.equal(relay.pictureDue(room, 1), true, 'a new turn is a new board');
});

test('a picture is painted on its board in full, relayed to everybody as it goes, and is then no longer due', async (t) => {
  keepAlive(t);
  const picture = testPicture('cat').slice(0, 40);
  assert.ok(picture.length >= 10, 'the test source has a picture to give');
  const asked = [];
  const { relay, room, relayed, send, state } = rig({ relay: { pictureFor: async (word) => (asked.push(word), { ops: picture }) } });
  state.clock = 7777;
  await relay.paint(room, 0, send, seeded(1), () => state.clock);
  assert.deepEqual(asked, ['cat'], 'the word on that board is what was looked up');
  const board = relay.canvasOf(room).ops;
  const order = (ops) => ops.map((op) => JSON.stringify(op)).sort();
  assert.deepEqual(order(board), order(picture), 'the same strokes, in whatever order they went on');
  assert.deepEqual(opsOf(relayed), board, 'what was relayed, end to end, is what is on the board');
  assert.ok(relayed.every((message) => message.event === 'draw' && message.room === room));
  assert.ok(relayed.every((message) => (message.options?.except ?? null) === null), 'nobody is left out: there is no drawer to have it already');
  assert.equal(relay.canvasOf(room).lastAt, 7777, 'stamped with the clock it was handed');
  assert.equal(relay.pictureDue(room, 0), false);
});

test('the same seed puts the strokes on in the same order, and the order is scattered rather than top to bottom', async (t) => {
  keepAlive(t);
  const picture = testPicture('cat').slice(0, 60);
  const painted = async (seed) => {
    const { relay, room, send } = rig({ relay: { pictureFor: async () => ({ ops: picture }) } });
    await relay.paint(room, 0, send, seeded(seed), () => 0);
    return relay.canvasOf(room).ops;
  };
  const first = await painted(5);
  assert.deepEqual(await painted(5), first);
  assert.notDeepEqual(first, picture, 'not simply wiped on in the order the picture came in');
});

test('a picture on one of several boards is looked up by that board’s word and relayed under that board’s name', async (t) => {
  keepAlive(t);
  const asked = [];
  const { relay, room, relayed, send } = rig({ boards: 2, relay: { pictureFor: async (word) => (asked.push(word), { ops: [kept(1), kept(2)] }) } });
  await relay.paint(room, 1, send, seeded(1), () => 0);
  assert.deepEqual(asked, ['dog']);
  assert.equal(relay.canvasOf(room, 1).ops.length, 2);
  assert.deepEqual(relay.canvasOf(room, 0).ops, []);
  assert.ok(relayed.length >= 1 && relayed.every((message) => message.payload.board === 1));
  assert.equal(relay.pictureDue(room, 1), false);
  assert.equal(relay.pictureDue(room, 0), true);
});

test('a picture is not due again from the moment it is started, even before it has been fetched', async (t) => {
  keepAlive(t);
  let deliver;
  const fetched = new Promise((resolve) => { deliver = resolve; });
  const { relay, room, send } = rig({ relay: { pictureFor: () => fetched } });
  const painting = relay.paint(room, 0, send, seeded(1), () => 0);
  assert.equal(relay.pictureDue(room, 0), false, 'a second timer cannot start the same picture again');
  deliver({ ops: [] });
  await painting;
});

test('a picture goes on at the computer player’s pace, never more than a batch at a time', async (t) => {
  keepAlive(t);
  const picture = Array.from({ length: 2 * MAX_BATCH + 10 }, (_, i) => kept(i % 1500));
  // Far more strokes a tick than a message may carry: the message is what gives.
  const { relay, room, relayed, send } = rig({ relay: { pictureFor: async () => ({ ops: picture }), botRate: 1_000_000 } });
  await relay.paint(room, 0, send, seeded(1), () => 0);
  assert.equal(relay.canvasOf(room).ops.length, picture.length);
  assert.ok(relayed.every((message) => message.payload.ops.length <= MAX_BATCH), `the largest message held ${Math.max(...relayed.map((message) => message.payload.ops.length))}`);
  assert.ok(relayed.length >= 3);
});

test('a rate of fewer strokes than there are ticks in a second still paints the whole picture, a stroke at a time', async (t) => {
  keepAlive(t);
  const picture = [kept(1), kept(2), kept(3)];
  const ticksASecond = 1000 / STROKE_TICK;
  const { relay, room, relayed, send } = rig({ relay: { pictureFor: async () => ({ ops: picture }), botRate: ticksASecond / 2 } });
  const started = Date.now();
  await relay.paint(room, 0, send, seeded(1), () => 0);
  const took = Date.now() - started;
  assert.equal(relay.canvasOf(room).ops.length, 3, 'rounding each tick down to nothing would have painted none of it');
  assert.deepEqual(relayed.map((message) => message.payload.ops.length), [1, 1, 1]);
  // Three strokes at half a stroke a tick is six ticks.  Only the lower bound is checked (with a little slack for a
  // timer firing a shade early): a busy machine makes it slower, never faster.
  assert.ok(took >= 6 * STROKE_TICK - 50, `three strokes at half a stroke a tick took only ${took} ms`);
});

test('a board with no word is not painted', async (t) => {
  keepAlive(t);
  const asked = [];
  const { relay, room, relayed, send } = rig({ relay: { pictureFor: async (word) => (asked.push(word), { ops: [kept(1)] }) } });
  room.words = [];
  await relay.paint(room, 0, send, seeded(1), () => 0);
  assert.deepEqual(asked, []);
  assert.deepEqual(relayed, []);
});

test('a word with no picture anywhere leaves the board empty, says so in the log, and is not tried again this turn', async (t) => {
  keepAlive(t);
  const { relay, room, relayed, logs, send } = rig({ relay: { pictureFor: async () => ({ ops: [] }) } });
  await relay.paint(room, 0, send, seeded(1), () => 0);
  assert.equal(relay.pictureDue(room, 0), false, 'only once a turn');
  assert.deepEqual(relayed, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /cat/);
  assert.deepEqual(relay.canvasOf(room).ops, []);
});

// canvasOf used to forget every painted mark of the room when it started a turn's boards, even one paint had already
// made for that same turn.  So if the boards were first started after paint began (a canvas request, a stroke on
// another board), a picture still being fetched, or not found, came due again.

test('somebody asking for the canvas while a picture is being fetched does not make it due a second time', async (t) => {
  keepAlive(t);
  let deliver;
  const fetched = new Promise((resolve) => { deliver = resolve; });
  const { relay, room, send, as } = rig({ relay: { pictureFor: () => fetched } });
  const painting = relay.paint(room, 0, send, seeded(1), () => 0);
  as(3).send('canvas'); // a person opens the page, or comes back, in the middle of the turn
  const due = relay.pictureDue(room, 0);
  deliver({ ops: [] });
  await painting;
  assert.equal(due, false, 'a second timer would start the same picture again, and it would go on twice');
});

test('a person drawing on their own board does not make the computer player’s board due its picture again', async (t) => {
  keepAlive(t);
  let deliver;
  const fetched = new Promise((resolve) => { deliver = resolve; });
  const { relay, room, send, as } = rig({ boards: 2, relay: { pictureFor: () => fetched } });
  const painting = relay.paint(room, 1, send, seeded(1), () => 0);
  as(1).send('line', line(100)); // board 0, while board 1's picture is on its way
  const due = relay.pictureDue(room, 1);
  deliver({ ops: [] });
  await painting;
  assert.equal(due, false);
});

test('a word with no picture is not looked up again this turn, even after somebody has asked for the canvas', async (t) => {
  keepAlive(t);
  const { relay, room, send, as } = rig({ relay: { pictureFor: async () => ({ ops: [] }) } });
  await relay.paint(room, 0, send, seeded(1), () => 0);
  as(3).send('canvas');
  assert.equal(relay.pictureDue(room, 0), false, 'only once a turn');
});

test('a picture that cannot be fetched is logged, and the failure does not escape', async (t) => {
  keepAlive(t);
  const { relay, room, relayed, logs, send } = rig({ relay: { pictureFor: async () => { throw new Error('the network is down'); } } });
  await assert.doesNotReject(relay.paint(room, 0, send, seeded(1), () => 0));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /cat/);
  assert.match(logs[0], /the network is down/);
  assert.deepEqual(relayed, []);
});

for (const [name, moveOn] of [
  ['the turn moves on', (room) => { room.turn += 1; }],
  ['the drawing stops', (room) => { room.phase = 'between'; }],
  ['the word on the board changes', (room) => { room.words = ['owl', 'dog']; }],
]) {
  test(`painting stops when ${name}, leaving the rest of the picture off`, async (t) => {
    keepAlive(t);
    const picture = Array.from({ length: 50 }, (_, i) => kept(i));
    // Ten strokes a tick, so the picture needs five; the room changes as the first of them is relayed.
    const { relay, room, relayed, state } = rig({ relay: { pictureFor: async () => ({ ops: picture }), botRate: 100 } });
    const send = (...args) => {
      relayed.push({ room: args[0], event: args[1], payload: args[2], options: args[3] });
      moveOn(room);
    };
    await relay.paint(room, 0, send, seeded(1), () => state.clock);
    assert.equal(relayed.length, 1, 'nothing more was sent once the room had moved on');
    assert.ok(opsOf(relayed).length < picture.length);
  });
}

test('a turn that moved on while the picture was being fetched gets none of it', async (t) => {
  keepAlive(t);
  let deliver;
  const fetched = new Promise((resolve) => { deliver = resolve; });
  const { relay, room, relayed, send } = rig({ relay: { pictureFor: () => fetched } });
  const painting = relay.paint(room, 0, send, seeded(1), () => 0);
  room.turn = 2;
  deliver({ ops: [kept(1), kept(2)] });
  await painting;
  assert.deepEqual(relayed, []);
  assert.deepEqual(relay.canvasOf(room).ops, [], 'the new turn’s board has nothing of the old turn’s word on it');
  assert.equal(relay.pictureDue(room, 0), true, 'and the new turn is still owed its own');
});

// ---- the settings ----

test('pause waits and then resolves, with nothing', async (t) => {
  keepAlive(t);
  const started = Date.now();
  assert.equal(await pause(40), undefined);
  assert.ok(Date.now() - started >= 30, 'it did wait');
});

test('the stroke tick and the default rate are positive numbers a picture can be paced by', () => {
  assert.ok(Number.isFinite(STROKE_TICK) && STROKE_TICK > 0);
  assert.ok(Number.isFinite(BOT_STROKE_RATE) && BOT_STROKE_RATE > 0);
});

/** Sets an environment variable for one test, and puts back whatever was there. */
const withEnv = (t, name, value) => {
  const before = process.env[name];
  t.after(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

test('a rate is read from the environment when it is a number above zero, and is the fallback otherwise', (t) => {
  const name = 'STROKE_RELAY_TEST_RATE';
  withEnv(t, name, undefined);
  assert.equal(readRate(name, 100), 100, 'missing');
  for (const [text, expected] of [['250', 250], ['0.5', 0.5], [' 40 ', 40]]) {
    process.env[name] = text;
    assert.equal(readRate(name, 100), expected, JSON.stringify(text));
  }
  for (const text of ['0', '-5', 'fast', '', 'NaN', 'Infinity', '-Infinity', '10 strokes']) {
    process.env[name] = text;
    assert.equal(readRate(name, 100), 100, JSON.stringify(text));
  }
});

test('with pictures "off" a computer player draws nothing, whatever the word', async (t) => {
  withEnv(t, 'STROKE_RELAY_TEST_PICTURES', 'off');
  const source = pictureSource('STROKE_RELAY_TEST_PICTURES');
  assert.deepEqual(await source('cat'), { ops: [], url: null });
});

test('the "test" pictures are worked out from the word, need no network, and are instructions a board will take', async (t) => {
  withEnv(t, 'STROKE_RELAY_TEST_PICTURES', 'test');
  t.mock.method(globalThis, 'fetch', () => assert.fail('the test source went to the network'));
  const source = pictureSource('STROKE_RELAY_TEST_PICTURES');
  const cat = await source('cat');
  assert.ok(cat.ops.length > 0);
  assert.deepEqual(await source('cat'), cat, 'the same word, the same picture');
  assert.notDeepEqual((await source('dog')).ops, cat.ops, 'another word, another picture');
  for (const op of cat.ops) assert.deepEqual(readOp(op), op);
});

test('unless told otherwise, pictures come from the web', (t) => {
  withEnv(t, 'STROKE_RELAY_TEST_PICTURES', undefined);
  // Only that there is a source: calling it would fetch, and a test must not.
  assert.equal(typeof pictureSource('STROKE_RELAY_TEST_PICTURES'), 'function');
});

// ---- at random ----

test('fuzz: whatever three sockets send, the boards hold only real instructions and the relayed stream reproduces them', () => {
  const before = prototypeNames();
  const garbage = garbageValues().map(([, value]) => value);
  const events = ['line', 'fill', 'draw', 'clear', 'undo', 'canvas'];
  const refusals = ['notInAnyGame', 'notYourTurnToDraw', 'badDrawing'];
  for (const seed of [31, 32, 33, 0xd0d1e]) {
    const rng = seeded(seed);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const number = () => (rng() < 0.85 ? Math.floor(rng() * 2400) - 400 : pick([-1e9, 1e9, 1.5, NaN, Infinity, '12', '1e3', null, {}, []]));
    const op = () => {
      const made = rng() < 0.75 ? { t: 'line', x: number(), y: number(), x2: number(), y2: number(), c: Math.floor(rng() * 30) - 2, w: Math.floor(rng() * 50) } : { t: 'fill', x: number(), y: number(), c: Math.floor(rng() * 30) - 2 };
      if (rng() < 0.1) made[pick(['t', 'x', 'y', 'c', 'w'])] = pick(garbage);
      if (rng() < 0.05) return { ...made, ...JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}') };
      return rng() < 0.08 ? pick(garbage) : made;
    };
    const payloadFor = (event) => {
      if (rng() < 0.1) return pick(garbage);
      if (event === 'draw') return { ops: rng() < 0.05 ? pick(garbage) : Array.from({ length: Math.floor(rng() * (rng() < 0.05 ? 1200 : 12)) }, op) };
      return op();
    };

    const { relay, room, state, relayed, as } = rig({ boards: 2 });
    const follower = [[], []]; // what somebody who only ever listened has for each board
    let consumed = 0;
    for (let step = 0; step < 1200; step++) {
      const where = `seed ${seed}, step ${step}`;
      const roll = rng();
      state.clock += pick([0, 10, 100, 400]);
      if (roll < 0.02) {
        room.turn += 1; // the view tells everybody a new turn has begun, and a client starts its boards afresh
        follower[0] = [];
        follower[1] = [];
      } else if (roll < 0.04) {
        room.drawers = pick([[1, 2], [2, 1], [1, 9], [3, 2]]); // places change hands; the boards stay where they are
      } else {
        const userId = pick([1, 2, 3, 9]);
        const person = as(userId);
        const event = pick(events);
        const board = room.drawers.indexOf(userId);
        const sizeBefore = board === -1 ? null : relay.canvasOf(room, board).ops.length;
        person.got.length = 0;
        let reply;
        assert.doesNotThrow(() => (reply = person.send(event, payloadFor(event))), `${where}: ${event} from user ${userId} threw`);
        assert.ok(reply.ok === true || (reply.ok === false && refusals.includes(reply.error)), `${where}: ${event} from user ${userId} answered ${JSON.stringify(reply)}`);
        if (event !== 'canvas' && board === -1) assert.deepEqual(reply, { ok: false, error: 'notYourTurnToDraw' }, `${where}: ${event} from user ${userId}, who is not drawing`);
        if (event === 'canvas') {
          assert.deepEqual(reply, { ok: true }, where);
          for (const index of [0, 1]) {
            const chunks = person.got.filter((message) => message.payload.board === index);
            assert.ok(chunks.length >= 1 && chunks.every((message) => message.event === 'canvas' && message.payload.ops.length <= MAX_BATCH), `${where}: the chunks of board ${index}`);
            assert.deepEqual(chunks.map((message) => message.payload.first), chunks.map((_, at) => at === 0), `${where}: only the first chunk of board ${index} starts afresh`);
            assert.deepEqual(chunks.map((message) => message.payload.done), chunks.map((_, at) => at === chunks.length - 1), `${where}: only the last chunk of board ${index} is done`);
            assert.deepEqual(opsOf(chunks), relay.canvasOf(room, index).ops, `${where}: board ${index} as sent to somebody arriving`);
          }
        } else assert.deepEqual(person.got, [], `${where}: ${event} sent something to the socket alone`);
        // Everything relayed by this event, as somebody listening would apply it.
        for (const message of relayed.slice(consumed)) {
          const { board: index, ops, first } = message.payload;
          assert.equal(index, board, `${where}: ${event} from user ${userId} reached board ${index}`);
          if (message.event === 'draw') {
            assert.ok(ops.length >= 1 && ops.length <= MAX_BATCH, `${where}: a draw message of ${ops.length}`);
            assert.deepEqual(message.options, { except: userId }, `${where}: strokes are not sent back to whoever drew them`);
            follower[index].push(...ops);
          } else {
            assert.equal(message.event, 'canvas', where);
            assert.ok(ops.length <= MAX_BATCH, `${where}: a canvas chunk of ${ops.length}`);
            assert.equal(message.options?.except ?? null, null, `${where}: a whole board goes to everybody`);
            if (first) follower[index] = [];
            follower[index].push(...ops);
          }
        }
        consumed = relayed.length;
        if (board !== -1 && ['line', 'fill', 'draw'].includes(event)) {
          assert.ok(relay.canvasOf(room, board).ops.length >= sizeBefore, `${where}: drawing made the board smaller`);
          assert.equal(reply.ok ? true : relay.canvasOf(room, board).ops.length === sizeBefore, true, `${where}: a refused ${event} changed the board`);
        }
      }
      for (const index of [0, 1]) {
        const { ops, groups } = relay.canvasOf(room, index);
        assert.ok(ops.length <= MAX_OPS, `${where}: board ${index} holds ${ops.length}`);
        assert.equal(follower[index].length, ops.length, `${where}: a follower of board ${index} has ${follower[index].length} instructions, the server ${ops.length}`);
        assert.ok(groups.every((at, i) => at >= 0 && at < ops.length && (i === 0 || at > groups[i - 1])), `${where}: the strokes of board ${index} begin at ${groups.slice(-5).join()} of ${ops.length}`);
        if (step % 40 !== 0 && step !== 1199) continue;
        assert.deepEqual(follower[index], ops, `${where}: a follower of board ${index} has a different picture`);
        for (const [at, kept] of ops.entries()) assert.deepEqual(readOp(kept), kept, `${where}: instruction ${at} of board ${index} is not one the server would accept`);
      }
    }
    assert.ok(relayed.length > 100, `seed ${seed}: the run drew very little (${relayed.length} messages)`);
  }
  assertNoPollution(before);
});
