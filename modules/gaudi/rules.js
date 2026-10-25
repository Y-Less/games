// The pure rules of Gaudi that need no room, sockets or randomness: colours, window patterns, the placement rules,
// the public and private objectives and window scoring. The server and the client both import this file (the client
// uses it to highlight legal spaces and explain illegal ones), so it must not import anything from node.

export const ROWS = 4;
export const COLS = 5;
export const CELLS = ROWS * COLS;
export const SHADES = [1, 2, 3, 4, 5, 6];
export const ROUNDS = 10;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

/** The five colours of glass. The letter is how a colour is written in a window pattern. */
export const COLOURS = ['ruby', 'topaz', 'jade', 'sapphire', 'amethyst'];
export const COLOUR_LETTERS = { R: 'ruby', T: 'topaz', J: 'jade', S: 'sapphire', A: 'amethyst' };
export const COLOUR_NAMES = { ruby: 'Ruby', topaz: 'Topaz', jade: 'Jade', sapphire: 'Sapphire', amethyst: 'Amethyst' };
export const COLOUR_SHAPES = { ruby: 'diamond', topaz: 'circle', jade: 'triangle', sapphire: 'square', amethyst: 'star' };

/** Each round the pool holds two dice per player and one more. */
export const poolSize = (players) => 2 * players + 1;
/** The bag holds exactly the dice the ten rounds use: 10 x (2n + 1), shared evenly by the five colours. */
export const bagSize = (players) => ROUNDS * poolSize(players);
/** Dice of each colour in the bag: 2 x (2n + 1), i.e. 10, 14, 18 and 22 for two to five players. */
export const dicePerColour = (players) => bagSize(players) / COLOURS.length;

/** Points per die of the private colour when the host switches on "bad private scoring". */
export const BAD_PRIVATE_POINTS = 3;

// ---- window patterns ----
// Twelve double-sided cards, 24 patterns. A pattern is four rows of five characters: '.' is a blank space, a letter
// (R T J S A) a colour restriction and a digit 1-6 a shade restriction. Difficulty (3-6) is the number of favour
// tokens the window gives its owner. The two faces of a card are one light and one heavy window.

const CARD_DATA = [
  [
    ['Dawn Rose', 3, ['R....', '.3.T.', '..5..', '.J.2S']],
    ['Kaleidoscope', 6, ['R4J2S', '3.5.1', 'J6.3A', '5T1S.']],
  ],
  [
    ['Harbour Lights', 4, ['..J..', '3.R.5', '.T.2.', 'S.4.A']],
    ['Mosaic Court', 5, ['T.4.S', '5J.3.', '.2A.R', '1.S4.']],
  ],
  [
    ['Quiet Pond', 3, ['...S.', '4...J', '.R.3.', '..A..']],
    ['Stormglass', 6, ['6R.JS', 'T3A.2', '.5T4R', 'J.1S6']],
  ],
  [
    ['Weather Vane', 4, ['A.3.A', '.S.5.', 'J.R.2', '.4.T.']],
    ['Orchard Gate', 5, ['J2.4T', '.S5.R', 'A.3J.', '6R.A1']],
  ],
  [
    ['Spindle', 3, ['..R..', '.2.4.', 'S...5', '.1T.A']],
    ['Cathedral Rose', 6, ['S5.4A', '3J.R2', '.T6S.', 'R1A.3']],
  ],
  [
    ['Chime', 4, ['T...6', '.A.2.', '4.S..', '.J.R3']],
    ['Fretwork', 5, ['.4S.J', '2.A5.', 'R3.T4', '.J1.S']],
  ],
  [
    ['Fanlight', 3, ['R.S.J', '.....', '.3.5.', '1...6']],
    ['Prism', 6, ['4T1RS', 'J.5.A', '2R.3T', 'S6J.1']],
  ],
  [
    ['Compass', 4, ['.J.3.', 'S...A', '.5.R.', '4.T.2']],
    ['Wickerwork', 5, ['R.2.J', '4S.5A', '.J3.T', 'S.1R.']],
  ],
  [
    ['Seedling', 3, ['..4..', '.R.S.', 'J...3', '..A..']],
    ['Kiln', 6, ['A3.S6', '5R4.1', 'J.T2.', '6S.A3']],
  ],
  [
    ['Tidewrack', 4, ['T.5.J', '.2.S.', 'A...6', '.R.4.']],
    ['Trellis', 5, ['3.R.5', 'S4.J.', '.A6.T', '1.S2.']],
  ],
  [
    ['Feather', 3, ['.S.4.', 'J...2', '.R.T.', '5...A']],
    ['Labyrinth', 6, ['R6.3A', '2J5.S', 'T.4R1', '.S3A.']],
  ],
  [
    ['Mirror Pool', 4, ['S.4.S', '.J.J.', '3.R.3', '.A.T.']],
    ['Chorus Window', 5, ['5.A.T', 'J4.2R', '.S6.3', 'A.1J.']],
  ],
];

export const PATTERNS = {};
export const PATTERN_CARDS = CARD_DATA.map((faces, card) => ({
  card,
  faces: faces.map(([name, difficulty, rows], face) => {
    const pattern = { pid: `${card}.${face}`, card, face, name, difficulty, rows, cells: rows.join('').split('') };
    PATTERNS[pattern.pid] = pattern;
    return pattern;
  }),
}));
export const PATTERN_IDS = Object.keys(PATTERNS);

export const patternOf = (pid) => (typeof pid === 'string' && Object.hasOwn(PATTERNS, pid) ? PATTERNS[pid] : null);

/** What a pattern character asks of a die: { colour } | { shade } | null. */
export function restrictionOf(char) {
  if (Object.hasOwn(COLOUR_LETTERS, char)) return { colour: COLOUR_LETTERS[char] };
  if (/^[1-6]$/.test(char)) return { shade: Number(char) };
  return null;
}

// ---- the grid ----

export const rowOf = (index) => Math.floor(index / COLS);
export const colOf = (index) => index % COLS;
export const isEdge = (index) => rowOf(index) === 0 || rowOf(index) === ROWS - 1 || colOf(index) === 0 || colOf(index) === COLS - 1;

function neighbours(index, diagonal) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      if (!diagonal && dr && dc) continue;
      const r = rowOf(index) + dr;
      const c = colOf(index) + dc;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) out.push(r * COLS + c);
    }
  }
  return out;
}
export const ORTHOGONAL = Array.from({ length: CELLS }, (_, i) => neighbours(i, false));
export const SURROUNDING = Array.from({ length: CELLS }, (_, i) => neighbours(i, true));
export const emptyGrid = () => Array.from({ length: CELLS }, () => null);
export const diceIn = (grid) => grid.filter(Boolean);
export const emptySpaces = (grid) => grid.filter((d) => !d).length;

/**
 * Why `die` cannot go on space `index` of a window, or null when it can. Options relax one rule each:
 * `ignoreColour` and `ignoreShade` skip the space's own restriction of that kind; `ignoreTouch` skips the rule that a
 * die must touch the dice already placed (and that the first one is on an edge).
 */
export function cellProblem(grid, pattern, index, die, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) return 'There is no such space.';
  if (grid[index]) return 'That space already holds a die.';
  const wanted = restrictionOf(pattern.cells[index]);
  if (wanted?.colour && !options.ignoreColour && die.c !== wanted.colour) return `That space needs a ${COLOUR_NAMES[wanted.colour]} die.`;
  if (wanted?.shade && !options.ignoreShade && die.v !== wanted.shade) return `That space needs a die showing ${wanted.shade}.`;
  if (!options.ignoreTouch) {
    if (!grid.some(Boolean)) {
      if (!isEdge(index)) return 'Your first die must go on an edge or corner space.';
    } else if (!SURROUNDING[index].some((n) => grid[n])) {
      return 'A die must touch a die already in your window (diagonally counts).';
    }
  }
  for (const n of ORTHOGONAL[index]) {
    if (grid[n]?.c === die.c) return `A ${COLOUR_NAMES[die.c]} die cannot sit beside another ${COLOUR_NAMES[die.c]} die.`;
    if (grid[n]?.v === die.v) return `A die showing ${die.v} cannot sit beside another die showing ${die.v}.`;
  }
  return null;
}

/** Why the die in `from` cannot be moved to `to`, or null. The die is lifted first, so it cannot count as its own neighbour. */
export function moveProblem(grid, pattern, from, to, options = {}) {
  if (!Number.isInteger(from) || from < 0 || from >= CELLS || !grid[from]) return 'There is no die on that space to move.';
  if (!Number.isInteger(to) || to < 0 || to >= CELLS) return 'There is no such space.';
  if (from === to) return 'Move the die to a different space.';
  const lifted = grid.slice();
  lifted[from] = null;
  return cellProblem(lifted, pattern, to, grid[from], options);
}

export const legalCells = (grid, pattern, die, options) => grid.flatMap((_, i) => (cellProblem(grid, pattern, i, die, options) === null ? [i] : []));

/** True if no die at all could ever go on this space (ignoring touching and the first-die rule). */
export function isDeadSpace(grid, pattern, index) {
  if (grid[index]) return false;
  const wanted = restrictionOf(pattern.cells[index]);
  for (const c of wanted?.colour ? [wanted.colour] : COLOURS) {
    for (const v of wanted?.shade ? [wanted.shade] : SHADES) {
      if (!ORTHOGONAL[index].some((n) => grid[n]?.c === c || grid[n]?.v === v)) return false;
    }
  }
  return true;
}

/** A complete valid filling of a pattern with unlimited dice, or null. Used by the tests to prove patterns are playable. */
export function solvePattern(pattern) {
  const grid = emptyGrid();
  const place = (index) => {
    if (index === CELLS) return true;
    const wanted = restrictionOf(pattern.cells[index]);
    for (const c of wanted?.colour ? [wanted.colour] : COLOURS) {
      for (const v of wanted?.shade ? [wanted.shade] : SHADES) {
        if (ORTHOGONAL[index].some((n) => n < index && (grid[n].c === c || grid[n].v === v))) continue;
        grid[index] = { c, v };
        if (place(index + 1)) return true;
        grid[index] = null;
      }
    }
    return false;
  };
  return place(0) ? grid : null;
}

// ---- objectives ----

const rowCells = (r) => Array.from({ length: COLS }, (_, c) => r * COLS + c);
const colCells = (c) => Array.from({ length: ROWS }, (_, r) => r * COLS + c);
const lines = (cellsOf, count) => Array.from({ length: count }, (_, i) => cellsOf(i));
const allDifferent = (grid, cells, key) => {
  if (cells.some((i) => !grid[i])) return false;
  return new Set(cells.map((i) => grid[i][key])).size === cells.length;
};
const countWhere = (grid, test) => diceIn(grid).filter(test).length;
const shadePair = (a, b) => (grid) => Math.min(countWhere(grid, (d) => d.v === a), countWhere(grid, (d) => d.v === b));

/** Ten public objectives. `sets(grid)` is how many times it is completed; each is worth `points`. */
export const OBJECTIVES = [
  { id: 'rainbow-rows', name: 'Rainbow rows', points: 6, unit: 'row', text: 'Rows with no colour repeated.', sets: (g) => lines(rowCells, ROWS).filter((c) => allDifferent(g, c, 'c')).length },
  { id: 'rainbow-columns', name: 'Rainbow columns', points: 5, unit: 'column', text: 'Columns with no colour repeated.', sets: (g) => lines(colCells, COLS).filter((c) => allDifferent(g, c, 'c')).length },
  { id: 'tonal-rows', name: 'Tonal rows', points: 5, unit: 'row', text: 'Rows with no shade repeated.', sets: (g) => lines(rowCells, ROWS).filter((c) => allDifferent(g, c, 'v')).length },
  { id: 'tonal-columns', name: 'Tonal columns', points: 4, unit: 'column', text: 'Columns with no shade repeated.', sets: (g) => lines(colCells, COLS).filter((c) => allDifferent(g, c, 'v')).length },
  { id: 'pale-pairs', name: 'Pale pairs', points: 2, unit: 'pair', text: 'Pairs of a 1 and a 2, anywhere in the window.', sets: shadePair(1, 2) },
  { id: 'middle-pairs', name: 'Middle pairs', points: 2, unit: 'pair', text: 'Pairs of a 3 and a 4, anywhere in the window.', sets: shadePair(3, 4) },
  { id: 'deep-pairs', name: 'Deep pairs', points: 2, unit: 'pair', text: 'Pairs of a 5 and a 6, anywhere in the window.', sets: shadePair(5, 6) },
  { id: 'full-spectrum', name: 'Full spectrum', points: 5, unit: 'set', text: 'Sets of all six shades, anywhere in the window.', sets: (g) => Math.min(...SHADES.map((s) => countWhere(g, (d) => d.v === s))) },
  { id: 'full-palette', name: 'Full palette', points: 4, unit: 'set', text: 'Sets of all five colours, anywhere in the window.', sets: (g) => Math.min(...COLOURS.map((c) => countWhere(g, (d) => d.c === c))) },
  {
    id: 'colour-chains',
    name: 'Colour chains',
    points: 1,
    unit: 'die',
    text: 'Each die that touches a die of its own colour diagonally.',
    sets: (g) => g.filter((d, i) => d && SURROUNDING[i].some((n) => !ORTHOGONAL[i].includes(n) && g[n]?.c === d.c)).length,
  },
];
export const OBJECTIVE_IDS = OBJECTIVES.map((o) => o.id);
export const objectiveOf = (id) => OBJECTIVES.find((o) => o.id === id) ?? null;

export function objectivePoints(id, grid) {
  const objective = objectiveOf(id);
  const sets = objective.sets(grid);
  return { sets, points: sets * objective.points };
}

/**
 * The private objective: by default the shades of every die of your secret colour, added up. With "bad private
 * scoring" every such die is worth a flat 3 whatever it shows.
 */
export function privatePoints(grid, colour, bad = false) {
  return diceIn(grid).reduce((sum, d) => sum + (d.c === colour ? (bad ? BAD_PRIVATE_POINTS : d.v) : 0), 0);
}

/** A window's score without the private objective: public objectives + favour tokens - empty spaces. */
export function provisionalScore(grid, objectiveIds, tokens) {
  return objectiveIds.reduce((sum, id) => sum + objectivePoints(id, grid).points, 0) + tokens - emptySpaces(grid);
}
