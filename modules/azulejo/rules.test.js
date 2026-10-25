// The pure rules of Azulejo: the fixed wall, line legality, floor penalties, tile scoring and bonuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOURS,
  FLOOR_PENALTIES,
  MARKER,
  bonuses,
  columnsFor,
  completeColumns,
  completeRows,
  completeSets,
  emptyLines,
  emptyWall,
  factoryCount,
  floorPenalty,
  isDeadCell,
  lineProblem,
  previewTake,
  tileScore,
  wallColour,
  wallColumn,
} from './rules.js';

/** A wall from picture rows: '.' empty, 'X' filled (with the fixed colour). */
const wallOf = (rows) => {
  const wall = emptyWall();
  rows.forEach((text, r) => [...text].forEach((ch, c) => (wall[r][c] = ch === 'X' ? wallColour(r, c) : null)));
  return wall;
};

test('factory displays: 2n + 1', () => {
  assert.deepEqual([2, 3, 4, 5].map(factoryCount), [5, 7, 9, 11]);
});

test('the fixed wall is a Latin square, each row shifted one place from the row above', () => {
  for (let r = 0; r < 5; r++) {
    assert.deepEqual([0, 1, 2, 3, 4].map((c) => wallColour(r, c)).sort(), COLOURS, `row ${r} has every colour`);
    assert.deepEqual([0, 1, 2, 3, 4].map((c) => wallColour(c, r)).sort(), COLOURS, `column ${r} has every colour`);
    for (const colour of COLOURS) assert.equal(wallColour(r, wallColumn(r, colour)), colour, 'wallColumn is the inverse');
  }
  for (let r = 1; r < 5; r++) for (let c = 0; c < 5; c++) assert.equal(wallColour(r, (c + 1) % 5), wallColour(r - 1, c), 'shifted one place right');
});

test('floor penalties by slot: -1 -1 -2 -2 -2 -3 -3', () => {
  assert.deepEqual(FLOOR_PENALTIES, [1, 1, 2, 2, 2, 3, 3]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((n) => floorPenalty(Array(n).fill(0))), [0, 1, 2, 4, 6, 8, 11, 14]);
  assert.equal(floorPenalty(Array(10).fill(0)), 14, 'nothing beyond the seventh slot');
  assert.equal(floorPenalty([MARKER, 1, 1]), 4, 'the marker is a slot like any other');
});

test('tile scoring: an isolated tile scores 1', () => {
  assert.equal(tileScore(wallOf(['.....', '.....', '..X..', '.....', '.....']), 2, 2), 1);
  // Diagonal neighbours do not count.
  assert.equal(tileScore(wallOf(['.....', '.X.X.', '..X..', '.X.X.', '.....']), 2, 2), 1);
});

test('tile scoring: a horizontal run only', () => {
  assert.equal(tileScore(wallOf(['.....', '.....', 'XX...', '.....', '.....']), 2, 1), 2);
  assert.equal(tileScore(wallOf(['.....', '.....', '.XX..', '.....', '.....']), 2, 3), 3, 'two to the left: a run of three');
  assert.equal(tileScore(wallOf(['.....', '.....', 'XX.X.', '.....', '.....']), 2, 4), 2, 'a gap ends the run');
  assert.equal(tileScore(wallOf(['.....', '.....', 'XX.X.', '.....', '.....']), 2, 2), 4, 'joining two runs');
});

test('tile scoring: a vertical run only (not counted twice)', () => {
  assert.equal(tileScore(wallOf(['...X.', '...X.', '...X.', '.....', '.....']), 2, 3), 3);
  assert.equal(tileScore(wallOf(['.....', '.....', '...X.', '...X.', '...X.']), 2, 3), 3);
  assert.equal(tileScore(wallOf(['...X.', '.....', '...X.', '...X.', '.....']), 2, 3), 2, 'a gap above does not count');
});

test('tile scoring: both runs count, tile included in each', () => {
  // Placed at (2,3): row run X X [X] = 3, column run above = 2.
  assert.equal(tileScore(wallOf(['.....', '...X.', '.XXX.', '.....', '.....']), 2, 3), 5);
  // In the middle of a row of four and a column of three.
  assert.equal(tileScore(wallOf(['.....', '..X..', 'XXXXX', '..X..', '.....']), 2, 2), 5 + 3);
});

test('tile scoring: long chains and a full cross', () => {
  assert.equal(tileScore(wallOf(['.....', '.....', 'XXXXX', '.....', '.....']), 2, 4), 5, 'the end of a full row');
  assert.equal(tileScore(wallOf(['..X..', '..X..', 'XXXXX', '..X..', '..X..']), 2, 2), 10, 'a full row and a full column');
  assert.equal(tileScore(wallOf(['X....', 'X....', 'X....', 'X....', 'X....']), 0, 0), 5, 'the top of a full column');
  assert.equal(tileScore(wallOf(['XXXXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']), 3, 3), 10, 'a full wall');
});

test('end bonuses: +2 per row, +7 per column, +10 per colour set', () => {
  assert.deepEqual(bonuses(emptyWall()), { rows: 0, columns: 0, sets: 0, points: 0 });
  const oneRow = wallOf(['XXXXX', '.....', '.....', '.....', '.....']);
  assert.deepEqual(bonuses(oneRow), { rows: 1, columns: 0, sets: 0, points: 2 });
  const oneColumn = wallOf(['..X..', '..X..', '..X..', '..X..', '..X..']);
  assert.deepEqual(bonuses(oneColumn), { rows: 0, columns: 1, sets: 0, points: 7 });
  const full = wallOf(['XXXXX', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX']);
  assert.deepEqual(bonuses(full), { rows: 5, columns: 5, sets: 5, points: 10 + 35 + 50 });
  // One colour on the fixed wall sits on a diagonal: that makes a colour set without a row or column.
  const diagonal = emptyWall();
  for (let r = 0; r < 5; r++) diagonal[r][wallColumn(r, 3)] = 3;
  assert.deepEqual(bonuses(diagonal), { rows: 0, columns: 0, sets: 1, points: 10 });
  assert.equal(completeRows(full), 5);
  assert.equal(completeColumns(full), 5);
  assert.equal(completeSets(full), 5);
  assert.equal(completeSets(wallOf(['XXXX.', 'XXXXX', 'XXXXX', 'XXXXX', 'XXXXX'])), 4, 'one missing tile spoils one colour only');
});

test('which line a colour may go on', () => {
  const wall = emptyWall();
  const lines = emptyLines();
  for (let line = 0; line < 5; line++) assert.equal(lineProblem(lines, wall, line, 2), null, 'an empty line takes any colour');
  lines[2] = { colour: 1, count: 2 };
  assert.match(lineProblem(lines, wall, 2, 2), /already holds Saffron/);
  assert.equal(lineProblem(lines, wall, 2, 1), null, 'the same colour');
  lines[2].count = 3;
  assert.match(lineProblem(lines, wall, 2, 1), /already full/);
  assert.match(lineProblem(lines, wall, 5, 1), /no such/);
  assert.match(lineProblem(lines, wall, -1, 1), /no such/);
  assert.match(lineProblem(lines, wall, 1.5, 1), /no such/);
  assert.match(lineProblem(lines, wall, '1', 1), /no such/);
  // The wall row already has the colour.
  wall[3][wallColumn(3, 4)] = 4;
  assert.match(lineProblem(lines, wall, 3, 4), /Row 4 of your wall already has Plum/);
  assert.equal(lineProblem(lines, wall, 3, 3), null);
  assert.equal(lineProblem(lines, wall, 4, 4), null, 'other rows are not affected');
});

test('columns for a tile: one place on the fixed wall, any free one on a free wall', () => {
  const wall = emptyWall();
  for (let r = 0; r < 5; r++) for (const colour of COLOURS) assert.deepEqual(columnsFor(wall, r, colour, false), [wallColumn(r, colour)]);
  assert.deepEqual(columnsFor(wall, 0, 0, true), [0, 1, 2, 3, 4], 'a blank free wall allows every column');
  wall[0][2] = 3; // colour 3 in row 0, column 2
  assert.deepEqual(columnsFor(wall, 0, 3, true), [], 'the row already has the colour');
  assert.deepEqual(columnsFor(wall, 1, 3, true), [0, 1, 3, 4], 'column 2 already has colour 3');
  assert.deepEqual(columnsFor(wall, 0, 1, true), [0, 1, 3, 4], 'the filled place is not offered');
  const fixed = emptyWall();
  fixed[1][wallColumn(1, 2)] = 2;
  assert.deepEqual(columnsFor(fixed, 1, 2, false), []);
});

test('dead cells: an empty place of a free wall that no colour can fill', () => {
  const wall = emptyWall();
  assert.equal(isDeadCell(wall, 0, 0), false);
  // Row 0 holds colours 0-3 in columns 1-4 and column 0 holds colour 4 elsewhere: cell (0,0) cannot take anything.
  for (let c = 1; c < 5; c++) wall[0][c] = c - 1;
  wall[1][0] = 4;
  assert.equal(isDeadCell(wall, 0, 0), true);
  assert.equal(isDeadCell(wall, 0, 1), false, 'a filled place is not dead');
});

test('previewTake: what fits, the floor, the marker and the penalty', () => {
  const lines = emptyLines();
  const floor = [];
  assert.deepEqual(previewTake({ lines, floor }, { count: 2, line: 2 }), { put: 2, overflow: 0, onFloor: 0, toLid: 0, markerOnFloor: false, extraPenalty: 0, completes: false });
  const over = previewTake({ lines, floor }, { count: 3, line: 0 });
  assert.equal(over.put, 1);
  assert.equal(over.overflow, 2);
  assert.equal(over.extraPenalty, 2, '-1 and -1');
  assert.equal(over.completes, true);
  const marker = previewTake({ lines, floor }, { count: 2, line: 'floor', marker: true });
  assert.equal(marker.put, 0);
  assert.equal(marker.onFloor, 2);
  assert.equal(marker.markerOnFloor, true);
  assert.equal(marker.extraPenalty, 4, 'marker, tile, tile: 1 + 1 + 2');
  // Near the end of the floor: slots run out and tiles go to the lid.
  const nearlyFull = previewTake({ lines, floor: [0, 0, 0, 0, 0] }, { count: 4, line: 'floor' });
  assert.equal(nearlyFull.onFloor, 2);
  assert.equal(nearlyFull.toLid, 2);
  assert.equal(nearlyFull.extraPenalty, 6, 'slots six and seven: 3 + 3');
  const full = previewTake({ lines, floor: Array(7).fill(0) }, { count: 3, line: 'floor', marker: true });
  assert.equal(full.markerOnFloor, false);
  assert.equal(full.toLid, 3);
  assert.equal(full.extraPenalty, 0);
  const partial = { colour: 1, count: 2 };
  const withPartial = emptyLines();
  withPartial[3] = partial;
  assert.equal(previewTake({ lines: withPartial, floor }, { count: 2, line: 3 }).completes, true);
  assert.equal(previewTake({ lines: withPartial, floor }, { count: 1, line: 3 }).completes, false);
});
