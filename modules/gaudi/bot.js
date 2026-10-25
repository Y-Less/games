// The computer players of Gaudi. They only ever make moves the rules allow (the same functions check them): they
// choose windows by difficulty, place dice to satisfy restrictions while keeping future spaces open and chasing the
// objectives, and use a tool only when stuck or when it is clearly worth the favour tokens.
import * as game from './game.js';
import { isDeadSpace, legalCells, objectivePoints, patternOf, privatePoints, CELLS, COLS, ROWS, restrictionOf } from './rules.js';

const isBot = game.isBot;

/** The next thing a computer has to do, or null when the game waits for a person. */
export function pendingAction(room) {
  if (room.phase === 'windows') {
    const seat = room.seats.findIndex((s, i) => isBot(s) && !room.picked[i]);
    return seat === -1 ? null : { type: 'window', seat };
  }
  if (room.phase !== 'playing' || !room.turn) return null;
  return isBot(room.seats[room.turn.seat]) ? { type: 'turn', seat: room.turn.seat } : null;
}

/** Windows with more restrictions give more favour tokens: the computer likes difficulty 5 and 6, with some variety. */
export function botWindow(options, rng = Math.random) {
  return options.reduce((best, pid) => {
    const score = patternOf(pid).difficulty + rng() * 1.8;
    return !best || score > best.score ? { pid, score } : best;
  }, null).pid;
}

const publicPoints = (room, grid) => room.publicIds.reduce((sum, id) => sum + objectivePoints(id, grid).points, 0);

/** How good it is to put `die` on `cell`, for this seat. Higher is better. */
export function placementScore(room, seat, die, cell, options, rng) {
  const grid = room.grids[seat];
  const pattern = patternOf(room.patterns[seat]);
  const after = grid.slice();
  after[cell] = die;
  let score = 1; // one fewer empty space
  score += publicPoints(room, after) - publicPoints(room, grid);
  const colour = room.privateColours[seat];
  score += 0.8 * (privatePoints(after, colour, room.settings.badPrivate) - privatePoints(grid, colour, room.settings.badPrivate));
  const wanted = restrictionOf(pattern.cells[cell]);
  if (wanted) score += 2.5; // restricted spaces are the hard ones: fill them when a die fits
  let dead = 0;
  for (let i = 0; i < CELLS; i++) if (isDeadSpace(after, pattern, i) && !isDeadSpace(grid, pattern, i)) dead++;
  score -= 7 * dead;
  const r = Math.floor(cell / COLS);
  const c = cell % COLS;
  const line = (cells, key) => cells.filter((i) => i !== cell && after[i]?.[key] === die[key]).length;
  const rowCells = Array.from({ length: COLS }, (_, k) => r * COLS + k);
  const colCells = Array.from({ length: ROWS }, (_, k) => k * COLS + c);
  if (room.publicIds.includes('rainbow-rows')) score -= 2 * line(rowCells, 'c');
  if (room.publicIds.includes('rainbow-columns')) score -= 2 * line(colCells, 'c');
  if (room.publicIds.includes('tonal-rows')) score -= 2 * line(rowCells, 'v');
  if (room.publicIds.includes('tonal-columns')) score -= 2 * line(colCells, 'v');
  if (!grid.some(Boolean) && [0, COLS - 1, CELLS - COLS, CELLS - 1].includes(cell)) score += 1;
  if (options?.ignoreTouch) score -= 0.5;
  return score + rng() * 0.4;
}

/** The best (die, cell) for the seat among the dice in the pool, or null when nothing can be placed. */
export function bestPlacement(room, seat, rng) {
  const grid = room.grids[seat];
  const pattern = patternOf(room.patterns[seat]);
  let best = null;
  for (const die of room.pool) {
    for (const cell of legalCells(grid, pattern, die)) {
      const score = placementScore(room, seat, die, cell, null, rng);
      if (!best || score > best.score) best = { die: die.id, cell, score };
    }
  }
  return best;
}

/** Looks for a tool use that is worth its tokens. Returns { tool, params, score } or null. */
function bestTool(room, seat, rng, current) {
  const { turn } = room;
  if (turn.toolUsed) return null;
  const grid = room.grids[seat];
  const pattern = patternOf(room.patterns[seat]);
    if (turn.placements >= (turn.extra ? 2 : 1)) return null;
  const stuck = !current;
  const candidates = [];
  const affordable = (id) => {
    const index = room.tools.indexOf(id);
    return index !== -1 && room.tokens[seat] >= game.toolCost(room, index) ? game.toolCost(room, index) : 0;
  };
  const evaluate = (die, cost, make) => {
    for (const cell of legalCells(grid, pattern, die)) {
      candidates.push({ ...make, score: placementScore(room, seat, die, cell, null, rng) - 3 * cost });
    }
  };
  for (const pooled of room.pool) {
    for (const id of ['lathe', 'mirror']) {
      const cost = affordable(id);
      if (!cost) continue;
      const faces = id === 'mirror' ? [7 - pooled.v] : [pooled.v - 1, pooled.v + 1].filter((v) => v >= 1 && v <= 6);
      for (const v of faces) {
        const params = id === 'mirror' ? { die: pooled.id } : { die: pooled.id, delta: v - pooled.v };
        evaluate({ ...pooled, v }, cost, { tool: id, params });
      }
    }
    const free = affordable('free-pane');
    if (free && stuck) {
      for (const cell of legalCells(grid, pattern, pooled, { ignoreTouch: true })) {
        candidates.push({ tool: 'free-pane', params: { die: pooled.id, cell }, score: placementScore(room, seat, pooled, cell, { ignoreTouch: true }, rng) - 3 * free });
      }
    }
    const swap = affordable('exchange');
    if (swap && stuck) {
      for (const dice of room.track) for (const other of dice) evaluate(other, swap, { tool: 'exchange', params: { die: pooled.id, trackDie: other.id } });
    }
  }
  if (!candidates.length && stuck) {
    const refire = affordable('refire');
    if (refire && room.pool.length) return { tool: 'refire', params: { die: room.pool[Math.floor(rng() * room.pool.length)].id }, score: 0 };
    if (affordable('kiln') && turn.number === 2 && turn.placements === 0 && room.pool.length) return { tool: 'kiln', params: {}, score: 0 };
    return null;
  }
  const top = candidates.reduce((best, c) => (!best || c.score > best.score ? c : best), null);
  if (!top) return null;
  if (stuck) return top;
  // Not stuck: only a clear improvement over the best ordinary placement, and only with tokens to spare.
  return room.tokens[seat] >= 3 && top.score - current.score >= 5 ? top : null;
}

/** One decision for the seat whose turn it is. */
export function botStep(room, seat, rng = Math.random) {
  const { turn } = room;
  const canPlace = turn.placements < (turn.extra ? 2 : 1);
  const best = canPlace ? bestPlacement(room, seat, rng) : null;
  const tool = canPlace ? bestTool(room, seat, rng, best) : null;
  if (tool) return { type: 'tool', tool: tool.tool, params: tool.params };
  if (best) return { type: 'place', die: best.die, cell: best.cell };
  return { type: 'end' };
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'window') result = game.chooseWindow(room, action.seat, botWindow(room.options[action.seat], rng), rng);
  else {
    const step = botStep(room, action.seat, rng);
    action.step = step;
    if (step.type === 'place') result = game.placeDie(room, action.seat, step, rng);
    else if (step.type === 'tool') result = game.useTool(room, action.seat, { tool: step.tool, params: step.params }, rng);
    else result = game.endTurn(room, action.seat, rng);
  }
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}
