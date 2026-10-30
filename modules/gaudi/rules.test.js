// The pure rules: window patterns, the dice bag formula, placement rules and objective scoring by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BAD_PRIVATE_POINTS,
  CELLS,
  COLOURS,
  COLS,
  OBJECTIVES,
  isPerfect,
  PATTERNS,
  PATTERN_CARDS,
  PATTERN_IDS,
  ROWS,
  bagSize,
  cellProblem,
  dicePerColour,
  emptyGrid,
  isDeadSpace,
  legalCells,
  moveProblem,
  objectivePoints,
  patternOf,
  poolSize,
  privatePoints,
  provisionalScore,
  restrictionOf,
  solvePattern,
} from './rules.js';
import { makeBag, snakeOrder } from './game.js';
import { die, seeded } from './testing.js';

const blank = patternOf('0.0'); // 'R....' '.3.T.' '..5..' '.J.2S'
const free = { cells: Array(CELLS).fill('.') }; // a window with no restrictions at all
const at = (r, c) => r * COLS + c;
const put = (grid, r, c, colour, shade) => (grid[at(r, c)] = die(colour, shade, r * 10 + c));

test('there are twelve double-sided cards, 24 well-formed patterns', () => {
  assert.equal(PATTERN_CARDS.length, 12);
  assert.ok(PATTERN_IDS.length >= 24);
  assert.equal(new Set(PATTERN_IDS).size, PATTERN_IDS.length, 'unique ids');
  for (const card of PATTERN_CARDS) assert.equal(card.faces.length, 2);
  const names = Object.values(PATTERNS).map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'unique names');
  for (const pattern of Object.values(PATTERNS)) {
    const label = `${pattern.name} (${pattern.pid})`;
    assert.equal(pattern.rows.length, ROWS, label);
    assert.ok(pattern.rows.every((row) => row.length === COLS), `${label}: five columns`);
    assert.equal(pattern.cells.length, CELLS, label);
    assert.ok(pattern.cells.every((ch) => /^[.RTJSA1-6]$/.test(ch)), `${label}: valid cell values`);
    assert.ok(Number.isInteger(pattern.difficulty) && pattern.difficulty >= 3 && pattern.difficulty <= 6, `${label}: difficulty 3-6`);
    assert.ok(patternOf(pattern.pid) === pattern);
  }
});

test('every pattern can be completely and legally filled with unlimited dice', () => {
  for (const pattern of Object.values(PATTERNS)) {
    const grid = solvePattern(pattern);
    assert.ok(grid, `${pattern.name} has a complete filling`);
    // Rebuild it die by die, in a legal order, through the real placement rule.
    const built = emptyGrid();
    for (let placed = 0; placed < CELLS; placed++) {
      const next = [...Array(CELLS).keys()].find((i) => !built[i] && cellProblem(built, pattern, i, grid[i]) === null);
      assert.notEqual(next, undefined, `${pattern.name}: never stuck when filling it in`);
      built[next] = grid[next];
    }
    assert.equal(built.filter(Boolean).length, CELLS);
  }
});

test('difficulty follows how restricted a window is, and the two faces of a card differ', () => {
  const count = (p) => p.cells.filter((c) => c !== '.').length;
  for (const pattern of Object.values(PATTERNS)) {
    const n = count(pattern);
    if (pattern.difficulty === 3) assert.ok(n <= 8, pattern.name);
    if (pattern.difficulty === 6) assert.ok(n >= 15, pattern.name);
  }
  for (const card of PATTERN_CARDS) assert.notEqual(card.faces[0].difficulty, card.faces[1].difficulty);
});

test('pattern lookups reject anything that is not a pattern id', () => {
  for (const bad of [undefined, null, 5, '', '__proto__', 'constructor', 'toString', '99.9', {}, []]) assert.equal(patternOf(bad), null);
  assert.deepEqual(restrictionOf('R'), { colour: 'ruby' });
  assert.deepEqual(restrictionOf('4'), { shade: 4 });
  assert.equal(restrictionOf('.'), null);
  assert.equal(restrictionOf('7'), null);
});

test('the bag formula: 10 x (2n + 1) dice, shared evenly, for two to five players', () => {
  assert.deepEqual([2, 3, 4, 5].map(poolSize), [5, 7, 9, 11]);
  assert.deepEqual([2, 3, 4, 5].map(bagSize), [50, 70, 90, 110]);
  assert.deepEqual([2, 3, 4, 5].map(dicePerColour), [10, 14, 18, 22]);
  for (const n of [2, 3, 4, 5]) {
    assert.equal(bagSize(n), 10 * poolSize(n));
    assert.equal(dicePerColour(n) * COLOURS.length, bagSize(n));
    assert.equal(dicePerColour(n), 2 * poolSize(n));
  }
});

test('a bag holds the right dice, each once, and is shuffled', () => {
  for (const n of [2, 3, 4, 5]) {
    const bag = makeBag(n, seeded(n));
    assert.equal(bag.length, bagSize(n));
    assert.equal(new Set(bag.map((d) => d.id)).size, bag.length);
    for (const c of COLOURS) assert.equal(bag.filter((d) => d.c === c).length, dicePerColour(n));
    assert.ok(bag.every((d) => !('v' in d)), 'a die in the bag has no face yet');
  }
  const a = makeBag(4, seeded(1)).map((d) => d.id).join();
  const b = makeBag(4, seeded(2)).map((d) => d.id).join();
  assert.notEqual(a, b);
  assert.notEqual(a, makeBag(4, () => 0.999999).map((d) => d.id).join());
});

test('snake order for two to five players, from any first player', () => {
  assert.deepEqual(snakeOrder(0, 2), [0, 1, 1, 0]);
  assert.deepEqual(snakeOrder(0, 3), [0, 1, 2, 2, 1, 0]);
  assert.deepEqual(snakeOrder(1, 3), [1, 2, 0, 0, 2, 1]);
  assert.deepEqual(snakeOrder(2, 4), [2, 3, 0, 1, 1, 0, 3, 2]);
  assert.deepEqual(snakeOrder(3, 5), [3, 4, 0, 1, 2, 2, 1, 0, 4, 3]);
  for (let n = 2; n <= 5; n++) for (let f = 0; f < n; f++) {
    const order = snakeOrder(f, n);
    assert.equal(order.length, 2 * n);
    for (let s = 0; s < n; s++) assert.equal(order.filter((x) => x === s).length, 2);
    assert.equal(order.at(-1), f, 'the first player also goes last');
  }
});

// ---- placement ----

test('the first die goes on an edge or corner, and never in the middle', () => {
  const grid = emptyGrid();
  const d = die('jade', 5);
  for (let i = 0; i < CELLS; i++) {
    const edge = i < COLS || i >= CELLS - COLS || i % COLS === 0 || i % COLS === COLS - 1;
    assert.equal(cellProblem(grid, free, i, d) === null, edge, `space ${i}`);
  }
  assert.match(cellProblem(grid, free, at(1, 2), d), /edge or corner/);
});

test('later dice must touch a placed die, sideways or diagonally', () => {
  const grid = emptyGrid();
  put(grid, 0, 0, 'ruby', 1);
  const d = die('jade', 5);
  const legal = legalCells(grid, free, d);
  assert.deepEqual(legal.sort((a, b) => a - b), [at(0, 1), at(1, 0), at(1, 1)]);
  assert.match(cellProblem(grid, free, at(2, 2), d), /touch/);
  assert.match(cellProblem(grid, free, at(0, 0), d), /already holds/);
});

test('colour and shade restrictions are enforced; blank spaces take anything', () => {
  const grid = emptyGrid();
  const ruby = die('ruby', 2);
  assert.equal(cellProblem(grid, blank, at(0, 0), ruby), null, 'R accepts ruby (a corner)');
  assert.match(cellProblem(grid, blank, at(0, 0), die('jade', 2)), /needs a Ruby die/);
  assert.equal(cellProblem(grid, blank, at(0, 1), die('jade', 2)), null, 'blank edge space');
  put(grid, 0, 1, 'jade', 4); // something to touch
  assert.match(cellProblem(grid, blank, at(1, 1), die('ruby', 4)), /showing 3/, 'a 3 space');
  assert.equal(cellProblem(grid, blank, at(1, 1), die('ruby', 3)), null);
  assert.match(cellProblem(grid, blank, at(1, 1), die('ruby', 5)), /showing 3/);
});

test('no like colour or like shade directly beside a die, but diagonals are fine', () => {
  const grid = emptyGrid();
  put(grid, 0, 0, 'ruby', 3);
  assert.match(cellProblem(grid, free, at(0, 1), die('ruby', 5)), /Ruby die cannot sit beside/);
  assert.match(cellProblem(grid, free, at(1, 0), die('jade', 3)), /showing 3 cannot sit beside/);
  assert.equal(cellProblem(grid, free, at(1, 1), die('ruby', 3)), null, 'diagonal: same colour and same shade are fine');
  put(grid, 1, 1, 'ruby', 3);
  assert.match(cellProblem(grid, free, at(1, 2), die('topaz', 3)), /showing 3/);
  assert.match(cellProblem(grid, free, at(2, 1), die('ruby', 1)), /Ruby/);
  assert.match(cellProblem(grid, free, at(0, 1), die('topaz', 3)), /showing 3/);
  assert.equal(cellProblem(grid, free, at(0, 1), die('topaz', 4)), null);
});

test('every combination of the rules, one at a time (table-driven)', () => {
  // [description, window setup, space, die, options, expected problem or null]
  const cases = [
    ['restriction ok, touching ok', [[0, 0, 'jade', 5]], at(0, 1), die('ruby', 2), {}, null],
    ['first die in the middle', [], at(2, 2), die('ruby', 2), {}, 'edge'],
    ['first die in the middle, ignoring touching', [], at(2, 2), die('ruby', 2), { ignoreTouch: true }, null],
    ['touching ignored but like colour beside', [[2, 2, 'ruby', 4]], at(2, 3), die('ruby', 1), { ignoreTouch: true }, 'cannot sit beside'],
    ['not touching', [[0, 0, 'jade', 5]], at(3, 4), die('ruby', 2), {}, 'touch'],
    ['not touching but ignoreTouch', [[0, 0, 'jade', 5]], at(3, 4), die('ruby', 2), { ignoreTouch: true }, null],
  ];
  for (const [label, setup, space, d, options, expected] of cases) {
    const grid = emptyGrid();
    for (const [r, c, colour, shade] of setup) put(grid, r, c, colour, shade);
    const problem = cellProblem(grid, free, space, d, options);
    if (expected === null) assert.equal(problem, null, label);
    else assert.match(problem ?? '', new RegExp(expected), label);
  }
  // ignoreColour / ignoreShade against a pattern that has both kinds of restriction
  const grid = emptyGrid();
  put(grid, 0, 0, 'ruby', 6);
  // blank pattern row 1: '.3.T.'; (1,1) wants a 3, (1,3) wants topaz
  assert.match(cellProblem(grid, blank, at(1, 1), die('jade', 4)), /showing 3/);
  assert.equal(cellProblem(grid, blank, at(1, 1), die('jade', 4), { ignoreShade: true }), null);
  assert.match(cellProblem(grid, blank, at(1, 1), die('jade', 4), { ignoreColour: true }), /showing 3/);
  put(grid, 0, 3, 'amethyst', 2);
  assert.match(cellProblem(grid, blank, at(1, 3), die('jade', 4)), /needs a Topaz/);
  assert.equal(cellProblem(grid, blank, at(1, 3), die('jade', 4), { ignoreColour: true }), null);
  assert.match(cellProblem(grid, blank, at(1, 3), die('jade', 4), { ignoreShade: true }), /Topaz/);
  assert.match(cellProblem(grid, blank, at(1, 3), die('amethyst', 4), { ignoreColour: true }), /Amethyst die cannot sit beside/, 'neighbours still count');
  assert.match(cellProblem(grid, blank, 99, die('jade', 4)), /no such space/);
  assert.match(cellProblem(grid, blank, 1.5, die('jade', 4)), /no such space/);
});

test('moving a die: the die lifts first, so it is not its own neighbour', () => {
  const grid = emptyGrid();
  put(grid, 0, 0, 'ruby', 1);
  put(grid, 0, 1, 'jade', 2);
  assert.equal(moveProblem(grid, free, at(0, 1), at(1, 1)), null, 'still touches (0,0) diagonally');
  assert.match(moveProblem(grid, free, at(0, 1), at(3, 4)), /touch/);
  assert.match(moveProblem(grid, free, at(0, 1), at(0, 1)), /different space/);
  assert.match(moveProblem(grid, free, at(2, 2), at(2, 3)), /no die/);
  assert.match(moveProblem(grid, free, at(0, 0), at(0, 1)), /already holds/);
  assert.equal(moveProblem(grid, free, at(0, 0), at(1, 0)), null, 'next to the jade die at (0,1)? (1,0) touches it diagonally');
  assert.match(moveProblem(grid, free, 'x', 1), /no die/);
});

test('a dead space cannot take any die', () => {
  const grid = emptyGrid();
  // (1,1) needs a 3; a 3 above, any colour: every colour is allowed but the shade is fixed, so a 3 beside kills it.
  put(grid, 0, 1, 'ruby', 3);
  assert.equal(isDeadSpace(grid, blank, at(1, 1)), true);
  assert.equal(isDeadSpace(grid, blank, at(1, 2)), false);
  assert.equal(isDeadSpace(grid, blank, at(0, 1)), false, 'a filled space is never dead');
});

// ---- objectives ----

const fromRows = (rows) => {
  const grid = emptyGrid();
  rows.forEach((row, r) => row.split(' ').forEach((token, c) => {
    if (token === '..') return;
    const colour = { R: 'ruby', T: 'topaz', J: 'jade', S: 'sapphire', A: 'amethyst' }[token[0]];
    grid[at(r, c)] = die(colour, Number(token[1]), r * 10 + c);
  }));
  return grid;
};

test('there are ten public objectives with distinct names and positive values', () => {
  assert.equal(OBJECTIVES.length, 10);
  assert.equal(new Set(OBJECTIVES.map((o) => o.id)).size, 10);
  assert.equal(new Set(OBJECTIVES.map((o) => o.name)).size, 10);
  for (const o of OBJECTIVES) assert.ok(o.points > 0 && o.text && o.unit);
  for (const o of OBJECTIVES) assert.deepEqual(objectivePoints(o.id, emptyGrid()), { sets: 0, points: 0 });
});

test('objective scoring on a hand-computed window', () => {
  // Row 0: all colours different, shades 1 2 3 4 5.  Row 1: ruby repeated, shades 6 5 4 3 2 (all different).
  // Row 2: three dice.  Row 3: empty.
  const grid = fromRows([
    'R1 T2 J3 S4 A5',
    'R6 T5 R4 J3 S2',
    'A1 .. J6 .. T2',
    '.. .. .. .. ..',
  ]);
  assert.deepEqual(objectivePoints('rainbow-rows', grid), { sets: 1, points: 6 }, 'only row 0 has five different colours');
  assert.deepEqual(objectivePoints('tonal-rows', grid), { sets: 2, points: 10 }, 'rows 0 and 1 have no shade repeated; row 2 is incomplete');
  // Columns have only three dice at most (row 3 empty), so none is complete.
  assert.deepEqual(objectivePoints('rainbow-columns', grid), { sets: 0, points: 0 });
  assert.deepEqual(objectivePoints('tonal-columns', grid), { sets: 0, points: 0 });
  // Shades present: 1 x2, 2 x3, 3 x2, 4 x2, 5 x2, 6 x2.
  assert.deepEqual(objectivePoints('pale-pairs', grid), { sets: 2, points: 4 });
  assert.deepEqual(objectivePoints('middle-pairs', grid), { sets: 2, points: 4 });
  assert.deepEqual(objectivePoints('deep-pairs', grid), { sets: 2, points: 4 });
  assert.deepEqual(objectivePoints('full-spectrum', grid), { sets: 2, points: 10 });
  // Colours: ruby 3, topaz 3, jade 3, sapphire 2, amethyst 2 -> two full palettes.
  assert.deepEqual(objectivePoints('full-palette', grid), { sets: 2, points: 8 });
});

test('column objectives on a full-height window', () => {
  const grid = fromRows([
    'R1 T2 J3 S4 A5',
    'T2 J3 S4 A5 R6',
    'J3 S4 A5 R6 T1',
    'S4 A5 R6 T1 J2',
  ]);
  assert.deepEqual(objectivePoints('rainbow-columns', grid), { sets: 5, points: 25 });
  assert.deepEqual(objectivePoints('rainbow-rows', grid), { sets: 4, points: 24 });
  assert.deepEqual(objectivePoints('tonal-columns', grid), { sets: 5, points: 20 });
  grid[at(3, 0)] = die('ruby', 4); // column 0 now has ruby twice (rows 0 and 3), shades 1 2 3 4 still different
  assert.deepEqual(objectivePoints('rainbow-columns', grid), { sets: 4, points: 20 });
  assert.deepEqual(objectivePoints('tonal-columns', grid), { sets: 5, points: 20 });
  grid[at(3, 0)] = die('sapphire', 1); // shade 1 twice in column 0
  assert.deepEqual(objectivePoints('tonal-columns', grid), { sets: 4, points: 16 });
});

test('colour chains count each die with a same-colour diagonal neighbour', () => {
  const grid = fromRows([
    'R1 T2 .. .. ..',
    'J3 R4 T5 .. ..',
    '.. .. J6 .. ..',
    '.. .. .. .. ..',
  ]);
  // ruby (0,0)-(1,1) diagonal: 2 dice. topaz (0,1)-(1,2) diagonal: 2 dice. jade (1,0) and (2,2) are not diagonal.
  assert.deepEqual(objectivePoints('colour-chains', grid), { sets: 4, points: 4 });
  grid[at(2, 1)] = die('jade', 2);
  grid[at(2, 2)] = die('jade', 6);
  // jade (1,0)-(2,1) diagonal now; (2,1) beside (2,2) is orthogonal, which does not count.
  assert.equal(objectivePoints('colour-chains', grid).sets, 6);
});

test('private objective hand-computed: 6, 2 and 4 score 12 by default and 9 with bad private scoring', () => {
  const grid = emptyGrid();
  put(grid, 0, 0, 'jade', 6);
  put(grid, 0, 2, 'jade', 2);
  put(grid, 1, 1, 'jade', 4);
  put(grid, 0, 1, 'ruby', 5);
  put(grid, 2, 2, 'topaz', 1);
  assert.equal(privatePoints(grid, 'jade'), 12);
  assert.equal(privatePoints(grid, 'jade', false), 12);
  assert.equal(privatePoints(grid, 'jade', true), 9);
  assert.equal(BAD_PRIVATE_POINTS, 3);
  for (const bad of [false, true]) {
    assert.equal(privatePoints(grid, 'amethyst', bad), 0, 'no dice of that colour');
    assert.equal(privatePoints(emptyGrid(), 'ruby', bad), 0);
  }
  assert.equal(privatePoints(grid, 'ruby'), 5);
  assert.equal(privatePoints(grid, 'ruby', true), 3);
});

test('provisional score: public objectives + favour tokens - empty spaces', () => {
  const grid = fromRows([
    'R1 T2 J3 S4 A5',
    '.. .. .. .. ..',
    '.. .. .. .. ..',
    '.. .. .. .. ..',
  ]);
  // rainbow-rows: row 0 complete = 6 (others empty); 15 empty spaces; 4 tokens.
  assert.equal(provisionalScore(grid, ['rainbow-rows'], 4), 6 + 4 - 15);
  assert.equal(provisionalScore(grid, ['rainbow-rows', 'tonal-rows'], 4), 6 + 5 + 4 - 15);
  assert.equal(provisionalScore(emptyGrid(), ['rainbow-rows'], 5), 5 - 20);
});

test('each objective has a most it can be completed in a window, and a perfect window reaches it for every public objective', () => {
  assert.deepEqual(Object.fromEntries(OBJECTIVES.map((o) => [o.id, o.max])), {
    'rainbow-rows': 4,
    'rainbow-columns': 5,
    'tonal-rows': 4,
    'tonal-columns': 5,
    'pale-pairs': 10,
    'middle-pairs': 10,
    'deep-pairs': 10,
    'full-spectrum': 3,
    'full-palette': 4,
    'colour-chains': 20,
  });
  const ruby = Array.from({ length: CELLS }, (_, i) => ({ c: 'ruby', v: (i % 6) + 1 })); // full, one colour: every die has a diagonal neighbour of its colour
  assert.equal(objectivePoints('colour-chains', ruby).sets, 20);
  assert.equal(isPerfect(ruby, ['colour-chains', 'full-spectrum']), true, 'the shades come round three or more times');
  assert.equal(isPerfect(ruby, ['colour-chains', 'full-palette']), false, 'only one colour');
  const gap = ruby.slice();
  gap[3] = null;
  assert.equal(isPerfect(gap, ['full-spectrum']), false, 'an empty space is never perfect');
});
