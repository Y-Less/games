// Helpers shared by the Gaudi AIs.  Plain data in, plain data out: nothing here touches a room, a socket, or Math.random.
//
// The `state` an AI is given is a read-only snapshot of what the seat deciding could know (never the bag, nor other
// players' secret colours or window choices):
//   { seat, size, settings: { badPrivate }, round, order, turnIndex, turn: { seat, number, placements, toolUsed, extra },
//     pool, track, tools (ids), spent, tokens, grids, patterns (ids), publicIds, privateColour }
// An AI's decisions are `chooseWindow(options, rng)` -> a pattern id, and `chooseStep(state, seat, rng)` ->
// { type: 'place', die, cell } | { type: 'tool', tool, params } | { type: 'end' }.
import { pickOne } from '../../../shared/random.js';
import { CELLS, COLOURS, COLS, ORTHOGONAL, ROWS, SHADES, isDeadSpace, legalCells, objectivePoints, objectiveOf, patternOf, privatePoints, restrictionOf } from '../rules.js';

// The AIs pick from lists with the shared pickOne; it is re-exported here so that they need only import from this file.
export { pickOne };

/**
 * How many dice a seat may place in one turn: one (Swift Hand gives a whole extra turn, never two dice in one).
 *
 * @returns {number} always 1
 *
 * Side effects: none.
 */
export const allowedPlacements = () => 1;

/**
 * What a tool costs in favour tokens now: one, or two once somebody has used it.
 *
 * @param {object} state  the AI's snapshot (see the top of this file)
 * @param {number} index  the tool's place among the game's three tools
 * @returns {number} 1 or 2 favour tokens
 *
 * Side effects: none.
 */
export const toolCost = (state, index) => (state.spent[index] > 0 ? 2 : 1);

/**
 * The cost of a tool in this game if the seat can pay for it right now, otherwise 0.
 *
 * @param {object} state  the AI's snapshot
 * @param {number} seat   the seat deciding
 * @param {string} id     a tool id, such as 'lathe'
 * @returns {number} 1 or 2 favour tokens, or 0 when the tool is not in this game or the seat cannot afford it
 *
 * Side effects: none.
 */
export function affordable(state, seat, id) {
  const index = state.tools.indexOf(id);
  return index !== -1 && state.tokens[seat] >= toolCost(state, index) ? toolCost(state, index) : 0;
}

/**
 * Points a window scores from the three public objectives on the table.
 *
 * @param {object} state  the AI's snapshot (its publicIds are used)
 * @param {(object | null)[]} grid  a window, as it is or as it might become
 * @returns {number} the total points those three objectives give for the window
 *
 * Side effects: none.
 */
export const publicPoints = (state, grid) => state.publicIds.reduce((sum, id) => sum + objectivePoints(id, grid).points, 0);
/**
 * Points a window scores from the deciding seat's own private colour (flat points on "bad private scoring").
 *
 * @param {object} state  the AI's snapshot
 * @param {(object | null)[]} grid  a window, as it is or as it might become
 * @returns {number} the private-objective points for the window
 *
 * Side effects: none.
 */
export const privateOf = (state, grid) => privatePoints(grid, state.privateColour, state.settings.badPrivate);
/**
 * A copy of a window with a die put on one space (the original is not changed), to try a placement out.
 *
 * @param {(object | null)[]} grid  the window to copy
 * @param {number} cell  the space
 * @param {object} die   { id, c, v }
 * @returns {(object | null)[]} the new window
 *
 * Side effects: none (grid is copied, not modified).
 */
export const withDie = (grid, cell, die) => {
  const next = grid.slice();
  next[cell] = die;
  return next;
};

/**
 * How many empty spaces newly become spaces that nothing could ever fill.
 *
 * @param {(object | null)[]} grid   the window before
 * @param {(object | null)[]} after  the window after the move being considered
 * @param {object} pattern           the window's pattern
 * @returns {number} how many spaces are dead after the move that were not dead before
 *
 * Side effects: none.
 */
export function newDeadSpaces(grid, after, pattern) {
  let dead = 0;
  for (let i = 0; i < CELLS; i++) if (isDeadSpace(after, pattern, i) && !isDeadSpace(grid, pattern, i)) dead++;
  return dead;
}

/**
 * The space numbers of one row of a window.
 *
 * @param {number} r  the row number
 * @returns {number[]} the COLS space numbers in that row
 *
 * Side effects: none.
 */
const rowCells = (r) => Array.from({ length: COLS }, (_, c) => r * COLS + c);
/**
 * The space numbers of one column of a window.
 *
 * @param {number} c  the column number
 * @returns {number[]} the ROWS space numbers in that column
 *
 * Side effects: none.
 */
const colCells = (c) => Array.from({ length: ROWS }, (_, r) => r * COLS + c);
const ROW_LINES = Array.from({ length: ROWS }, (_, r) => rowCells(r));
const COL_LINES = Array.from({ length: COLS }, (_, c) => colCells(c));

/**
 * Progress on a line objective: all-different dice so far (n of len) count as (n/len)^2 of its points; a repeat is worth
 * nothing.
 *
 * @param {(object | null)[]} grid  the window
 * @param {number[][]} lines        the rows or the columns, as lists of space numbers
 * @param {'c' | 'v'} key           what must differ along a line: colour or shade
 * @param {number} points           what a finished line is worth
 * @returns {number} the summed progress over all lines, in points
 *
 * Why: squaring the fraction values nearly complete lines far more than barely started ones, so the AI finishes lines
 * rather than scattering a few dice across many.
 *
 * Side effects: none.
 */
function lineProgress(grid, lines, key, points) {
  let total = 0;
  for (const cells of lines) {
    const dice = cells.map((i) => grid[i]).filter(Boolean);
    if (new Set(dice.map((d) => d[key])).size !== dice.length) continue;
    total += points * (dice.length === cells.length ? 1 : (dice.length / cells.length) ** 2);
  }
  return total;
}

/**
 * How close a window is to each public objective, in points: whole sets exactly, unfinished ones by their progress.
 *
 * @param {object} state  the AI's snapshot
 * @param {(object | null)[]} grid  the window, as it is or as it might become
 * @returns {number} fractional points: exact for finished sets, partial credit for unfinished ones
 *
 * Why: the real scoring is all-or-nothing per set, which gives an AI no gradient to follow; the partial credit does.
 *
 * Side effects: none.
 */
export function publicPotential(state, grid) {
  let total = 0;
  /** How many dice in the window satisfy a test.  (Side effects: none.) */
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
 *
 * @param {(object | null)[]} grid  the window
 * @param {object} pattern  the window's pattern
 * @param {number} index    the space
 * @param {number} [chances]  how many more dice are expected to be tried on it
 * @returns {number} a probability from 0 to 1 (1 for a space that already holds a die)
 *
 * Side effects: none.
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

/**
 * Every legal (die, cell) among the pool.
 *
 * @param {object} state  the AI's snapshot
 * @param {number} seat
 * @param {object} [options]  placement rules to relax (see cellProblem in rules.js)
 * @returns {{ die: number, cell: number, dice: object }[]} die is the die id, dice the die itself
 *
 * Side effects: none.
 */
export function placementsOf(state, seat, options) {
  const grid = state.grids[seat];
  const pattern = patternOf(state.patterns[seat]);
  return state.pool.flatMap((die) => legalCells(grid, pattern, die, options).map((cell) => ({ die: die.id, cell, dice: die })));
}

/**
 * The shared shape of a step decision.  A `policy` supplies:
 *   score(state, seat, die, cell, options, context) - how good a placement is (higher is better)
 *   context(state, seat)                              - anything worth working out once per decision (optional)
 *   tools: 'never' | 'stuck' | 'eager'                - when a tool may be used; 'stuck' is only with nothing to place
 *   tokenValue, margin, reserve                       - for 'eager': a tool must beat the best plain placement by
 *                                                       (cost x tokenValue + margin) and leave `reserve` tokens
 *   noise                                             - random jitter added to every score (default 0.3)
 *
 * @param {object} state  the AI's snapshot
 * @param {number} seat   the seat deciding
 * @param {() => number} rng  random source returning [0, 1); jitters scores and picks a die to refire
 * @param {object} policy  as described above
 * @returns {{ type: 'place', die: number, cell: number } | { type: 'tool', tool: string, params: object } | { type: 'end' }}
 *
 * Why: tools are only considered when stuck (nothing to place) or, for 'eager' policies, when a tool's best placement
 * beats the best plain one by more than its token cost; that stops an AI burning tokens that are worth points.
 *
 * Side effects: none (other than advancing rng).
 */
/**
 * The two tools that change the face of a die in the pool and then place it under the ordinary rules.  They differ
 * only in which faces they can reach and what the move is called, so they are written as a pair of descriptors rather
 * than as two branches; the others each do something of their own shape and are written out below.
 */
const FACE_TOOLS = [
  { id: 'lathe', faces: (v) => [v - 1, v + 1].filter((f) => f >= 1 && f <= 6), params: (die, v) => ({ die: die.id, delta: v - die.v }) },
  { id: 'mirror', faces: (v) => [7 - v], params: (die) => ({ die: die.id }) },
];

/**
 * The best placement available without any tool, and the best each pool die can manage on its own (which is how the
 * exchange tool decides whose die to give away).
 * @param {object} state  the AI's snapshot
 * @param {object} grid  the seat's grid
 * @param {object} pattern  the seat's pattern
 * @param {(die: object, cell: number, options?: object) => number} scoreOf  the jittered score of one placement
 * @returns {{ best: { die: *, cell: number, score: number } | null, bestPerDie: Map<*, number> }}
 * Side effects: advances rng once for every placement considered, through `scoreOf`.
 */
function bestPlacement(state, grid, pattern, scoreOf) {
  let best = null;
  const bestPerDie = new Map();
  for (const die of state.pool) {
    for (const cell of legalCells(grid, pattern, die)) {
      const score = scoreOf(die, cell);
      if (!best || score > best.score) best = { die: die.id, cell, score };
      if (!bestPerDie.has(die.id) || score > bestPerDie.get(die.id)) bestPerDie.set(die.id, score);
    }
  }
  return { best, bestPerDie };
}

/**
 * Every placement a tool would make possible, each already charged for what the tool costs, so that they can be
 * compared with one another and with the best plain placement on one scale.
 * @param {object} state  the AI's snapshot
 * @param {number} seat  the seat deciding
 * @param {object} ctx  { grid, pattern, scoreOf, tokenValue, stuck, policy, bestPerDie }
 * @returns {object[]} candidates of { tool, params, score }
 * Side effects: advances rng once per candidate, through `scoreOf`.
 */
function toolCandidates(state, seat, { grid, pattern, scoreOf, tokenValue, stuck, policy, bestPerDie }) {
  const candidates = [];
  /** Adds every placement this die would make possible, charged for the tool's cost.  Side effects: pushes onto candidates. */
  const consider = (die, cost, make, options) => {
    for (const cell of legalCells(grid, pattern, die, options)) candidates.push({ ...make, score: scoreOf(die, cell, options) - tokenValue * cost });
  };
  for (const pooled of state.pool) {
    for (const tool of FACE_TOOLS) {
      const cost = affordable(state, seat, tool.id);
      if (!cost) continue;
      for (const v of tool.faces(pooled.v)) consider({ ...pooled, v }, cost, { tool: tool.id, params: tool.params(pooled, v) });
    }
    // Not a face tool: the die is unchanged and it is the placement rule that gives way.
    const free = affordable(state, seat, 'free-pane');
    if (free && (stuck || policy.freePane)) {
      for (const cell of legalCells(grid, pattern, pooled, { ignoreTouch: true })) {
        candidates.push({ tool: 'free-pane', params: { die: pooled.id, cell }, score: scoreOf(pooled, cell, { ignoreTouch: true }) - tokenValue * free });
      }
    }
  }
  // Nor is this one: the die comes from the track rather than the pool.
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
  return candidates;
}

/**
 * What to do when there is nothing to place and no tool can make a placement either: shake up the pool, or take the
 * one-off opening tool while it is still the opening, or give the turn up.
 * @param {object} state  the AI's snapshot
 * @param {number} seat  the seat deciding
 * @param {object} turn  state.turn
 * @param {() => number} rng  random source, for which die to refire
 * @returns {object} the move
 * Side effects: advances rng when it refires.
 */
function lastResort(state, seat, turn, rng) {
  if (affordable(state, seat, 'refire') && state.pool.length) return { type: 'tool', tool: 'refire', params: { die: pickOne(state.pool, rng).id } };
  if (affordable(state, seat, 'kiln') && turn.number === 2 && turn.placements === 0 && state.pool.length) return { type: 'tool', tool: 'kiln', params: {} };
  return { type: 'end' };
}

export function chooseStep(state, seat, rng, policy) {
  const { turn } = state;
  if (turn.placements >= allowedPlacements(state)) return { type: 'end' };
  const grid = state.grids[seat];
  const pattern = patternOf(state.patterns[seat]);
  const context = policy.context?.(state, seat) ?? null;
  const noise = policy.noise ?? 0.3;
  /** The policy's score for a placement, plus a little random jitter so equal choices are not always broken the same way.
   * Side effects: advances rng. */
  const scoreOf = (die, cell, options) => policy.score(state, seat, die, cell, options ?? null, context) + rng() * noise;

  const { best, bestPerDie } = bestPlacement(state, grid, pattern, scoreOf);
  /** The plain placement chosen so far (or ending the turn when nothing fits).  Side effects: none. */
  const place = () => (best ? { type: 'place', die: best.die, cell: best.cell } : { type: 'end' });
  if (turn.toolUsed || policy.tools === 'never' || !state.tools.length) return place();
  const stuck = !best;
  if (!stuck && policy.tools !== 'eager') return place();

  const tokenValue = policy.tokenValue ?? 3;
  const candidates = toolCandidates(state, seat, { grid, pattern, scoreOf, tokenValue, stuck, policy, bestPerDie });
  if (!candidates.length && stuck) return lastResort(state, seat, turn, rng);

  const top = candidates.reduce((winner, c) => (!winner || c.score > winner.score ? c : winner), null);
  if (!top) return place();
  if (stuck) return { type: 'tool', tool: top.tool, params: top.params };
  const spare = state.tokens[seat] - (policy.reserve ?? 0);
  const cost = state.tools.includes(top.tool) ? toolCost(state, state.tools.indexOf(top.tool)) : 1;
  if (spare >= cost && top.score - best.score >= (policy.margin ?? 1)) return { type: 'tool', tool: top.tool, params: top.params };
  return place();
}
