// "Standard": the original computer player. It chooses windows by difficulty, places dice to satisfy restrictions while
// keeping future spaces open and chasing the objectives, and uses a tool only when stuck or when it is clearly worth
// the favour tokens.
import { legalCells, patternOf, privatePoints, CELLS, COLS, ROWS, restrictionOf } from '../rules.js';
import { affordable, newDeadSpaces, pickOne, publicPoints } from './common.js';

/**
 * Windows with more restrictions give more favour tokens: the computer likes difficulty 5 and 6, with some variety.
 *
 * @param {string[]} options  the pattern ids on offer
 * @param {() => number} [rng]
 * @returns {string} one of the options
 */
export function chooseWindow(options, rng = Math.random) {
  return options.reduce((best, pid) => {
    const score = patternOf(pid).difficulty + rng() * 1.8;
    return !best || score > best.score ? { pid, score } : best;
  }, null).pid;
}

/**
 * How good it is to put `die` on `cell`, for this seat. Higher is better.
 *
 * @param {object} state  the AI's snapshot
 * @param {number} seat
 * @param {object} die    { id, c, v }
 * @param {number} cell   the space
 * @param {object | null} options  placement rules relaxed by a tool (only ignoreTouch matters here)
 * @param {() => number} rng       for a little random jitter
 * @returns {number}
 */
export function placementScore(state, seat, die, cell, options, rng) {
  const grid = state.grids[seat];
  const pattern = patternOf(state.patterns[seat]);
  const after = grid.slice();
  after[cell] = die;
  let score = 1; // one fewer empty space
  score += publicPoints(state, after) - publicPoints(state, grid);
  const colour = state.privateColour;
  score += 0.8 * (privatePoints(after, colour, state.settings.badPrivate) - privatePoints(grid, colour, state.settings.badPrivate));
  const wanted = restrictionOf(pattern.cells[cell]);
  if (wanted) score += 2.5; // restricted spaces are the hard ones: fill them when a die fits
  score -= 7 * newDeadSpaces(grid, after, pattern);
  const r = Math.floor(cell / COLS);
  const c = cell % COLS;
  /** How many other dice in these spaces match the die being placed in colour ('c') or shade ('v'). */
  const line = (cells, key) => cells.filter((i) => i !== cell && after[i]?.[key] === die[key]).length;
  const rowCells = Array.from({ length: COLS }, (_, k) => r * COLS + k);
  const colCells = Array.from({ length: ROWS }, (_, k) => k * COLS + c);
  if (state.publicIds.includes('rainbow-rows')) score -= 2 * line(rowCells, 'c');
  if (state.publicIds.includes('rainbow-columns')) score -= 2 * line(colCells, 'c');
  if (state.publicIds.includes('tonal-rows')) score -= 2 * line(rowCells, 'v');
  if (state.publicIds.includes('tonal-columns')) score -= 2 * line(colCells, 'v');
  if (!grid.some(Boolean) && [0, COLS - 1, CELLS - COLS, CELLS - 1].includes(cell)) score += 1;
  if (options?.ignoreTouch) score -= 0.5;
  return score + rng() * 0.4;
}

/**
 * The best (die, cell) for the seat among the dice in the pool, or null when nothing can be placed.
 *
 * @param {object} state  the AI's snapshot
 * @param {number} seat
 * @param {() => number} rng
 * @returns {{ die: number, cell: number, score: number } | null}
 */
export function bestPlacement(state, seat, rng) {
  const grid = state.grids[seat];
  const pattern = patternOf(state.patterns[seat]);
  let best = null;
  for (const die of state.pool) {
    for (const cell of legalCells(grid, pattern, die)) {
      const score = placementScore(state, seat, die, cell, null, rng);
      if (!best || score > best.score) best = { die: die.id, cell, score };
    }
  }
  return best;
}

/**
 * Looks for a tool use that is worth its tokens.
 *
 * @param {object} state  the AI's snapshot
 * @param {number} seat
 * @param {() => number} rng
 * @param {{ die: number, cell: number, score: number } | null} current  the best plain placement, or null if the seat is stuck
 * @returns {{ tool: string, params: object, score: number } | null}
 */
function bestTool(state, seat, rng, current) {
  const { turn } = state;
  if (turn.toolUsed) return null;
  const grid = state.grids[seat];
  const pattern = patternOf(state.patterns[seat]);
  if (turn.placements >= 1) return null;
  const stuck = !current;
  const candidates = [];
  /** Adds every placement that a tool would make possible (with this die, as the tool would leave it) as a candidate. */
  const evaluate = (die, cost, make) => {
    for (const cell of legalCells(grid, pattern, die)) {
      candidates.push({ ...make, score: placementScore(state, seat, die, cell, null, rng) - 3 * cost });
    }
  };
  for (const pooled of state.pool) {
    for (const id of ['lathe', 'mirror']) {
      const cost = affordable(state, seat, id);
      if (!cost) continue;
      const faces = id === 'mirror' ? [7 - pooled.v] : [pooled.v - 1, pooled.v + 1].filter((v) => v >= 1 && v <= 6);
      for (const v of faces) {
        const params = id === 'mirror' ? { die: pooled.id } : { die: pooled.id, delta: v - pooled.v };
        evaluate({ ...pooled, v }, cost, { tool: id, params });
      }
    }
    const free = affordable(state, seat, 'free-pane');
    if (free && stuck) {
      for (const cell of legalCells(grid, pattern, pooled, { ignoreTouch: true })) {
        candidates.push({ tool: 'free-pane', params: { die: pooled.id, cell }, score: placementScore(state, seat, pooled, cell, { ignoreTouch: true }, rng) - 3 * free });
      }
    }
    const swap = affordable(state, seat, 'exchange');
    if (swap && stuck) {
      for (const dice of state.track) for (const other of dice) evaluate(other, swap, { tool: 'exchange', params: { die: pooled.id, trackDie: other.id } });
    }
  }
  if (!candidates.length && stuck) {
    const refire = affordable(state, seat, 'refire');
    if (refire && state.pool.length) return { tool: 'refire', params: { die: pickOne(state.pool, rng).id }, score: 0 };
    if (affordable(state, seat, 'kiln') && turn.number === 2 && turn.placements === 0 && state.pool.length) return { tool: 'kiln', params: {}, score: 0 };
    return null;
  }
  const top = candidates.reduce((best, c) => (!best || c.score > best.score ? c : best), null);
  if (!top) return null;
  if (stuck) return top;
  // Not stuck: only a clear improvement over the best ordinary placement, and only with tokens to spare.
  return state.tokens[seat] >= 3 && top.score - current.score >= 5 ? top : null;
}

export default {
  id: 'standard',
  name: 'Standard',
  description: 'The classic computer player: likes hard windows, fills restricted spaces first, chases the objectives and uses a tool only when stuck or when it is clearly worth it.',
  weight: 4,
  chooseWindow,
  /**
   * Decides one step of this computer player's turn: place a die, use a tool, or end the turn. Changes nothing.
   *
   * @param {object} state  the read-only snapshot described in common.js
   * @param {number} seat   the seat deciding
   * @param {() => number} rng
   * @returns {{ type: 'place', die: number, cell: number } | { type: 'tool', tool: string, params: object } | { type: 'end' }}
   */
  chooseStep(state, seat, rng) {
    const { turn } = state;
    const canPlace = turn.placements < 1;
    const best = canPlace ? bestPlacement(state, seat, rng) : null;
    const tool = canPlace ? bestTool(state, seat, rng, best) : null;
    if (tool) return { type: 'tool', tool: tool.tool, params: tool.params };
    if (best) return { type: 'place', die: best.die, cell: best.cell };
    return { type: 'end' };
  },
};

