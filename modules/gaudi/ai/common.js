// Helpers shared by the Gaudi AIs. Plain data in, plain data out: nothing here touches a room, a socket or Math.random.
//
// The `state` an AI is given is a read-only snapshot of what the seat deciding could know (never the bag, nor other
// players' secret colours or window choices):
//   { seat, size, settings: { badPrivate }, round, order, turnIndex, turn: { seat, number, placements, toolUsed, extra },
//     pool, track, tools (ids), spent, tokens, grids, patterns (ids), publicIds, privateColour }
// An AI's decisions are `chooseWindow(options, rng)` -> a pattern id, and `chooseStep(state, seat, rng)` ->
// { type: 'place', die, cell } | { type: 'tool', tool, params } | { type: 'end' }.
import { CELLS, COLOURS, COLS, ORTHOGONAL, ROWS, SHADES, isDeadSpace, legalCells, objectivePoints, objectiveOf, patternOf, privatePoints, restrictionOf } from '../rules.js';

export const pickOne = (items, rng) => items[Math.floor(rng() * items.length)];
export const allowedPlacements = () => 1; // Swift Hand gives a whole extra turn, never two dice in one
export const toolCost = (state, index) => (state.spent[index] > 0 ? 2 : 1);

/** The cost of a tool in this game if the seat can pay for it right now, otherwise 0. */
export function affordable(state, seat, id) {
  const index = state.tools.indexOf(id);
  return index !== -1 && state.tokens[seat] >= toolCost(state, index) ? toolCost(state, index) : 0;
}

export const publicPoints = (state, grid) => state.publicIds.reduce((sum, id) => sum + objectivePoints(id, grid).points, 0);
export const privateOf = (state, grid) => privatePoints(grid, state.privateColour, state.settings.badPrivate);
export const withDie = (grid, cell, die) => {
  const next = grid.slice();
  next[cell] = die;
  return next;
};

/** How many empty spaces newly become spaces that nothing could ever fill. */
export function newDeadSpaces(grid, after, pattern) {
  let dead = 0;
  for (let i = 0; i < CELLS; i++) if (isDeadSpace(after, pattern, i) && !isDeadSpace(grid, pattern, i)) dead++;
  return dead;
}

const rowCells = (r) => Array.from({ length: COLS }, (_, c) => r * COLS + c);
const colCells = (c) => Array.from({ length: ROWS }, (_, r) => r * COLS + c);
const ROW_LINES = Array.from({ length: ROWS }, (_, r) => rowCells(r));
const COL_LINES = Array.from({ length: COLS }, (_, c) => colCells(c));

/** Progress on a line objective: all-different dice so far (n of len) count as (n/len)^2 of its points; a repeat is worth nothing. */
function lineProgress(grid, lines, key, points) {
  let total = 0;
  for (const cells of lines) {
    const dice = cells.map((i) => grid[i]).filter(Boolean);
    if (new Set(dice.map((d) => d[key])).size !== dice.length) continue;
    total += points * (dice.length === cells.length ? 1 : (dice.length / cells.length) ** 2);
  }
  return total;
}

/** How close a window is to each public objective, in points: whole sets exactly, unfinished ones by their progress. */
export function publicPotential(state, grid) {
  let total = 0;
  const count = (test) => grid.filter((d) => d && test(d)).length;
  for (const id of state.publicIds) {
    const points = objectiveOf(id).points;
    if (id === 'rainbow-rows') total += lineProgress(grid, ROW_LINES, 'c', points);
    else if (id === 'rainbow-columns') total += lineProgress(grid, COL_LINES, 'c', points);
    else if (id === 'tonal-rows') total += lineProgress(grid, ROW_LINES, 'v', points);
    else if (id === 'tonal-columns') total += lineProgress(grid, COL_LINES, 'v', points);
    else if (id === 'pale-pairs' || id === 'middle-pairs' || id === 'deep-pairs') {
      const [a, b] = id === 'pale-pairs' ? [1, 2] : id === 'middle-pairs' ? [3, 4] : [5, 6];
      const x = count((d) => d.v === a);
      const y = count((d) => d.v === b);
      total += points * (Math.min(x, y) + (x !== y ? 0.4 : 0));
    } else if (id === 'full-spectrum' || id === 'full-palette') {
      const [values, key] = id === 'full-spectrum' ? [SHADES, 'v'] : [COLOURS, 'c'];
      const counts = values.map((value) => count((d) => d[key] === value));
      const sets = Math.min(...counts);
      total += points * (sets + (0.6 * counts.filter((n) => n > sets).length) / values.length);
    } else total += objectivePoints(id, grid).points;
  }
  return total;
}

/**
 * How likely an empty space is to be filled by some die over the rest of the game: the dice its neighbours and its own
 * restriction still allow (out of 30 colour-and-shade faces), seen over about six chances.
 */
export function fillChance(grid, pattern, index, chances = 6) {
  if (grid[index]) return 1;
  const wanted = restrictionOf(pattern.cells[index]);
  let allowed = 0;
  for (const c of wanted?.colour ? [wanted.colour] : COLOURS) {
    for (const v of wanted?.shade ? [wanted.shade] : SHADES) {
      if (!ORTHOGONAL[index].some((n) => grid[n]?.c === c || grid[n]?.v === v)) allowed++;
    }
  }
  return 1 - (1 - allowed / (COLOURS.length * SHADES.length)) ** chances;
}

/** Every legal (die, cell) among the pool. */
export function placementsOf(state, seat, options) {
  const grid = state.grids[seat];
  const pattern = patternOf(state.patterns[seat]);
  return state.pool.flatMap((die) => legalCells(grid, pattern, die, options).map((cell) => ({ die: die.id, cell, dice: die })));
}

/**
 * The shared shape of a step decision. A `policy` supplies:
 *   score(state, seat, die, cell, options, context) - how good a placement is (higher is better)
 *   context(state, seat)                              - anything worth working out once per decision (optional)
 *   tools: 'never' | 'stuck' | 'eager'                - when a tool may be used; 'stuck' is only with nothing to place
 *   tokenValue, margin, reserve                       - for 'eager': a tool must beat the best plain placement by
 *                                                       (cost x tokenValue + margin) and leave `reserve` tokens
 *   noise                                             - random jitter added to every score (default 0.3)
 */
export function chooseStep(state, seat, rng, policy) {
  const { turn } = state;
  if (turn.placements >= allowedPlacements(state)) return { type: 'end' };
  const grid = state.grids[seat];
  const pattern = patternOf(state.patterns[seat]);
  const context = policy.context?.(state, seat) ?? null;
  const noise = policy.noise ?? 0.3;
  const scoreOf = (die, cell, options) => policy.score(state, seat, die, cell, options ?? null, context) + rng() * noise;

  let best = null;
  const bestPerDie = new Map();
  for (const die of state.pool) {
    for (const cell of legalCells(grid, pattern, die)) {
      const score = scoreOf(die, cell);
      if (!best || score > best.score) best = { die: die.id, cell, score };
      if (!bestPerDie.has(die.id) || score > bestPerDie.get(die.id)) bestPerDie.set(die.id, score);
    }
  }
  const place = () => (best ? { type: 'place', die: best.die, cell: best.cell } : { type: 'end' });
  if (turn.toolUsed || policy.tools === 'never' || !state.tools.length) return place();
  const stuck = !best;
  if (!stuck && policy.tools !== 'eager') return place();

  const tokenValue = policy.tokenValue ?? 3;
  const candidates = [];
  const consider = (die, cost, make, options) => {
    for (const cell of legalCells(grid, pattern, die, options)) candidates.push({ ...make, score: scoreOf(die, cell, options) - tokenValue * cost });
  };
  for (const pooled of state.pool) {
    for (const id of ['lathe', 'mirror']) {
      const cost = affordable(state, seat, id);
      if (!cost) continue;
      const faces = id === 'mirror' ? [7 - pooled.v] : [pooled.v - 1, pooled.v + 1].filter((v) => v >= 1 && v <= 6);
      for (const v of faces) consider({ ...pooled, v }, cost, { tool: id, params: id === 'mirror' ? { die: pooled.id } : { die: pooled.id, delta: v - pooled.v } });
    }
    const free = affordable(state, seat, 'free-pane');
    if (free && (stuck || policy.freePane)) {
      for (const cell of legalCells(grid, pattern, pooled, { ignoreTouch: true })) {
        candidates.push({ tool: 'free-pane', params: { die: pooled.id, cell }, score: scoreOf(pooled, cell, { ignoreTouch: true }) - tokenValue * free });
      }
    }
  }
  const swap = affordable(state, seat, 'exchange');
  if (swap && state.pool.length && (stuck || policy.exchange)) {
    // Give away the pool die that is least use to us, and try each kind of die on the track once.
    const giveaway = state.pool.reduce((worst, d) => ((bestPerDie.get(d.id) ?? -Infinity) < (bestPerDie.get(worst.id) ?? -Infinity) ? d : worst), state.pool[0]);
    const seen = new Set();
    for (const dice of state.track) {
      for (const other of dice) {
        const key = `${other.c}${other.v}`;
        if (seen.has(key)) continue;
        seen.add(key);
        consider(other, swap, { tool: 'exchange', params: { die: giveaway.id, trackDie: other.id } });
      }
    }
  }
  if (!candidates.length && stuck) {
    if (affordable(state, seat, 'refire') && state.pool.length) return { type: 'tool', tool: 'refire', params: { die: pickOne(state.pool, rng).id } };
    if (affordable(state, seat, 'kiln') && turn.number === 2 && turn.placements === 0 && state.pool.length) return { type: 'tool', tool: 'kiln', params: {} };
    return { type: 'end' };
  }
  const top = candidates.reduce((winner, c) => (!winner || c.score > winner.score ? c : winner), null);
  if (!top) return place();
  if (stuck) return { type: 'tool', tool: top.tool, params: top.params };
  const spare = state.tokens[seat] - (policy.reserve ?? 0);
  const cost = state.tools.includes(top.tool) ? toolCost(state, state.tools.indexOf(top.tool)) : 1;
  if (spare >= cost && top.score - best.score >= (policy.margin ?? 1)) return { type: 'tool', tool: top.tool, params: top.params };
  return place();
}
