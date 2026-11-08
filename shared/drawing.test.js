// What the server will accept on to the board, how strokes are grouped so that undo takes one off, and how a whole
// drawing is cut into messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, BRUSH, COLOURS, MAX_BATCH, MAX_OPS, addOps, canvasMessages, clear, newDrawing, readOp, undo } from './drawing.js';

/** A line instruction with whatever is wanted changed. */
const line = (over = {}) => ({ t: 'line', x: 10, y: 20, x2: 30, y2: 40, c: 2, w: 8, ...over });

test('a line is accepted with its numbers, and a size or colour out of range is brought back in', () => {
  assert.deepEqual(readOp(line()), { t: 'line', x: 10, y: 20, x2: 30, y2: 40, c: 2, w: 8 });
  assert.equal(readOp(line({ w: 100 })).w, BRUSH.max);
  assert.equal(readOp(line({ w: 1 })).w, BRUSH.min);
  assert.equal(readOp(line({ x: 10.7, y: -0.5 })).x, 10, 'whole numbers only');
  assert.equal(readOp(line({ x: '12' })).x, 12, 'a number as text still counts');
});

test('a stroke may reach a little past the edge of the board, but not far', () => {
  assert.equal(readOp(line({ x: -50 })).x, -50, 'a pen dragged over the edge draws up to it');
  assert.ok(readOp(line({ x: -100000 })).x > -1000);
  assert.ok(readOp(line({ x2: 100000 })).x2 < BOARD.width + 1000);
});

test('anything that is not an instruction is refused', () => {
  for (const bad of [
    null,
    undefined,
    'line',
    42,
    [],
    [line()],
    {},
    { t: 'line' },
    line({ t: 'scribble' }),
    line({ c: -1 }),
    line({ c: COLOURS }),
    line({ c: 'red' }),
    line({ x: 'over there' }),
    line({ x: NaN }),
    line({ x: Infinity }),
    line({ w: 'thick' }),
    { t: 'fill', x: 1, y: 1 },
    { t: 'fill', x: -1, y: 1, c: 1 },
    { t: 'fill', x: BOARD.width, y: 1, c: 1 },
    { t: 'fill', x: 1, y: BOARD.height, c: 1 },
  ]) {
    assert.equal(readOp(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(readOp({ t: 'fill', x: 5, y: 6, c: 3 }), { t: 'fill', x: 5, y: 6, c: 3 });
});

test('strokes made one after another are one stroke to undo, and a pause starts another', () => {
  const drawing = newDrawing();
  let now = 1000;
  addOps(drawing, [readOp(line())], now);
  addOps(drawing, [readOp(line())], (now += 50)); // the same stroke carried on
  addOps(drawing, [readOp(line())], (now += 50));
  assert.equal(drawing.ops.length, 3);
  assert.equal(drawing.groups.length, 1, 'one stroke so far');
  addOps(drawing, [readOp(line())], (now += 500)); // a pause: a new stroke
  assert.equal(drawing.groups.length, 2);
  assert.equal(undo(drawing), true);
  assert.equal(drawing.ops.length, 3, 'the last stroke went, the first stayed');
  assert.equal(undo(drawing), true);
  assert.equal(drawing.ops.length, 0);
  assert.equal(undo(drawing), false, 'nothing left to undo');
});

test('a fill is always a stroke of its own, and so is whatever follows it', () => {
  const drawing = newDrawing();
  addOps(drawing, [readOp(line())], 1000);
  addOps(drawing, [readOp({ t: 'fill', x: 1, y: 1, c: 4 })], 1010);
  addOps(drawing, [readOp(line())], 1020);
  assert.equal(drawing.groups.length, 3);
  assert.equal(undo(drawing), true);
  assert.equal(drawing.ops.at(-1).t, 'fill');
});

test('clearing empties the board, and says whether there was anything to clear', () => {
  const drawing = newDrawing();
  assert.equal(clear(drawing), false);
  addOps(drawing, [readOp(line())], 1000);
  assert.equal(clear(drawing), true);
  assert.deepEqual(drawing.ops, []);
  assert.deepEqual(drawing.groups, []);
  assert.equal(undo(drawing), false);
});

test('a drawing stops growing once it is full', () => {
  const drawing = newDrawing();
  const batch = Array.from({ length: 1000 }, () => readOp(line()));
  let now = 1000;
  for (let sent = 0; sent < MAX_OPS + 2000; sent += 1000) addOps(drawing, batch, (now += 200));
  assert.equal(drawing.ops.length, MAX_OPS);
  assert.deepEqual(addOps(drawing, batch, (now += 200)), [], 'nothing more is kept');
});

test('a whole drawing is sent in chunks, the first marked to start afresh and the last marked done', () => {
  assert.deepEqual(canvasMessages([]), [{ ops: [], first: true, done: true }]);
  const ops = Array.from({ length: MAX_BATCH * 2 + 5 }, () => readOp(line()));
  const messages = canvasMessages(ops);
  assert.equal(messages.length, 3);
  assert.deepEqual(
    messages.map((m) => [m.ops.length, m.first, m.done]),
    [
      [MAX_BATCH, true, false],
      [MAX_BATCH, false, false],
      [5, false, true],
    ],
  );
  assert.deepEqual(messages.flatMap((m) => m.ops), ops, 'every instruction is sent once');
});
