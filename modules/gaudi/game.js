// The rules of Gaudi, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }; an error never names hidden information.
//
// Seats 0..size-1 run clockwise. A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer player
// ({ kind: 'bot', id: 'bot:<n>', name, ai: <id of its AI, set when the game starts> }) or null (empty, lobby only).
//
// Dice: { id, c: colour, v: 1-6 }. The bag holds { id, c } only (a die has no face until it is rolled). Every die is in
// exactly one place: the bag, the pool, a round-track entry or a window. There is no discard pile: every tool keeps
// every die in play, so bag + pool + track + windows is always 10 x (2n + 1).
//
// The seat and lobby rules (joining, leaving, kicking, computer players) are the shared ones from shared/seats.js; this
// file adds what is particular to Gaudi.
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { shuffle } from '../../shared/cards.js';
import { addMove, recentMoves } from '../../shared/moveLog.js';
import { seatScoreboardEntry } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { asHost, botSeats, createSeatRules, fail, hasPlayer, hostInLobby, humanSeats, isBot, isHuman, ok, seatOf, uniqueName } from '../../shared/seats.js';
import { AIS } from './ai/index.js';
import {
  BAD_PRIVATE_POINTS,
  CELLS,
  COLOUR_NAMES,
  COLOURS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  OBJECTIVES,
  OBJECTIVE_IDS,
  PATTERN_CARDS,
  ROUNDS,
  bagSize,
  cellProblem,
  colOf,
  dicePerColour,
  emptyGrid,
  emptySpaces,
  moveProblem,
  isPerfect,
  objectiveOf,
  objectivePoints,
  patternOf,
  poolSize,
  privatePoints,
  provisionalScore,
  rowOf,
} from './rules.js';

export { MAX_PLAYERS, MIN_PLAYERS, ROUNDS, bagSize, dicePerColour, poolSize };
// The seat vocabulary the shared room server and the tests import from this module (the rules themselves live in
// shared/seats.js).
export { hasPlayer, humanSeats, isBot, isHuman, seatOf, uniqueName };
// The number of seats a game may have, and the default for a new room.
export const SIZES = [2, 3, 4, 5];
export const DEFAULT_SIZE = 4;
// The one setting: whether private-colour dice are worth a flat 3 (see rules.js privatePoints).
export const DEFAULT_SETTINGS = { badPrivate: false };
// The extra statistics recorded for each finished game (see statsPlayers).
export const STAT_KEYS = ['dicePlaced', 'toolsUsed', 'perfectWindows', 'bestPublicObjective', 'perfectBoards', 'privateTotal', 'emptySpaces'];
/** The names computer players are given, in order (Gaudi uses the architect and his circle, not the shared default list). */
export const BOT_NAMES = ['Gaudi', 'Jujol', 'Lluis', 'Pau', 'Mercè', 'Rosa', 'Enric', 'Núria', 'Joan', 'Elena'];
// How many tools and public objectives a game deals, and how many window patterns each player chooses between.
export const TOOL_COUNT = 3;
export const PUBLIC_COUNT = 3;
export const WINDOW_OPTIONS = 4;

/** The phases in which a game is still going; a finished game is only kept so that its result can be looked at. */
const LIVE = ['lobby', 'windows', 'playing'];
// Shorthand for validating client-supplied numbers (die ids, spaces), which may be any type.
const isInt = Number.isInteger;

/**
 * Is this a plain object (not null, not an array)? Used to validate the payloads clients send.
 *
 * @param {unknown} value  anything
 * @returns {boolean} true for a plain object
 *
 * Side effects: none.
 */
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Is the game still going (lobby, choosing windows or playing)? The server keeps live rooms longer and lets a person be
 * in only one of them at a time.
 *
 * @param {object} room  the room
 * @returns {boolean} true while the game is live
 *
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);

/**
 * The name to show for a seat in the log: the player's name, or "Someone" for an empty or unknown seat.
 *
 * @param {object} room  the room
 * @param {number} seat  the seat number
 * @returns {string} the name to show
 *
 * Side effects: none.
 */
export const seatName = (room, seat) => room.seats[seat]?.name ?? 'Someone';

/**
 * A seat order for one round: clockwise from the first player, then back again (A B C C B A).
 *
 * @param {number} first    the seat that goes first this round
 * @param {number} players  how many seats there are
 * @returns {number[]} 2 x players seat numbers, one per turn of the round
 *
 * Why a snake: whoever goes last in the first pass goes first in the second, which evens out the advantage of choosing first.
 *
 * Side effects: none.
 */
export function snakeOrder(first, players) {
  const forward = Array.from({ length: players }, (_, i) => (first + i) % players);
  return [...forward, ...forward.slice().reverse()];
}

/**
 * Rolls one die.
 *
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {number} a face from 1 to 6
 *
 * Side effects: advances rng.
 */
const rollFace = (rng) => 1 + Math.floor(rng() * 6);

/**
 * The next face of this turn's roll list, for a tool that rolls dice (Re-fire, Great Kiln).
 *
 * Why a list: Undo turn puts the dice back as they were before the roll and refunds the favour tokens, so without this a
 * player could use Re-fire, look at the result, undo and try again for free until they liked it. Every face a turn rolls
 * is therefore remembered in `room.rolls`, in order, and Undo only rewinds `room.rollsUsed` to 0: when the same tools are
 * used again after an undo they read the same faces back, so undoing never produces a different outcome. Only faces beyond
 * the ones already seen are rolled afresh (the first time that roll is made).
 *
 * Side effects: may push a new face onto room.rolls, and always advances room.rollsUsed.
 *
 * @param {object} room
 * @param {() => number} rng  random numbers, used only when the list has no face left to repeat
 * @returns {number} a face from 1 to 6
 */
function nextFace(room, rng) {
  room.rolls ??= []; // rooms saved before the roll list existed
  room.rollsUsed ??= 0;
  if (room.rollsUsed >= room.rolls.length) room.rolls.push(rollFace(rng));
  return room.rolls[room.rollsUsed++];
}

/**
 * A new bag for this many players: dicePerColour of each colour, in a random order.
 *
 * @param {number} players  2 to 5
 * @param {() => number} rng  random source returning [0, 1), used to shuffle
 * @returns {{ id: number, c: string }[]} the dice, shuffled; a die has no face until it is rolled
 *
 * Side effects: advances rng.
 */
export function makeBag(players, rng) {
  const dice = [];
  for (const c of COLOURS) for (let n = 0; n < dicePerColour(players); n++) dice.push({ id: dice.length, c });
  return shuffle(dice, rng);
}

// ---- the tool cards ----
// Each tool's prepare() checks everything and changes nothing: it returns { error } or { commit(), note }. useTool()
// charges the favour tokens and calls commit() only when the whole request is valid, so a tool is atomic.

/**
 * Where a die is in the pool.
 *
 * @param {object} room  the room
 * @param {unknown} id  a die id from a client (may be anything)
 * @returns {number} the index in room.pool, or -1 if the id is not a whole number or no such die is in the pool
 *
 * Side effects: none.
 */
const poolIndex = (room, id) => (isInt(id) ? room.pool.findIndex((d) => d.id === id) : -1);
// The message shared by every tool and placement that needs a pool die the client did not name correctly.
const NO_POOL_DIE = 'Choose a die from the pool.';

/**
 * Finds a die on the round track.
 *
 * @param {object} room  the room
 * @param {unknown} id  a die id from a client (may be anything)
 * @returns {{ dice: object[], index: number } | null} the round's entry holding it and its place there, or null
 *
 * Side effects: none (the entry returned is the live array, so a caller that edits it edits the room).
 */
function trackEntry(room, id) {
  if (!isInt(id)) return null;
  for (const dice of room.track) {
    const index = dice.findIndex((d) => d.id === id);
    if (index !== -1) return { dice, index };
  }
  return null;
}

/**
 * Applies a list of { from, to } moves to a copy of the window; every step must obey the placement rules.
 *
 * @param {(object | null)[]} grid  the window now (not changed)
 * @param {object} pattern          the window's pattern
 * @param {unknown} moves           the moves a client asked for
 * @param {object} limits
 * @param {number} limits.min        fewest moves allowed
 * @param {number} limits.max        most moves allowed
 * @param {object} [limits.options]  placement rules to relax (see cellProblem)
 * @param {boolean} [limits.sameColour]  every moved die must be the same colour
 * @returns {{ grid: (object | null)[] } | { error: string }} the window after the moves, or why they are not allowed
 *
 * Side effects: none (works on a copy of the window).
 */
function planMoves(grid, pattern, moves, { min, max, options = {}, sameColour = false }) {
  if (!Array.isArray(moves) || moves.length < min || moves.length > max) return { error: min === max ? `Move exactly ${min === 1 ? 'one die' : `${min} dice`}.` : `Move ${min} to ${max} dice.` };
  const next = grid.slice();
  const touched = new Set();
  for (const move of moves) {
    if (!isObject(move) || !isInt(move.from) || !isInt(move.to)) return { error: 'Each move needs a space to take a die from and a space to put it on.' };
    if (touched.has(move.from)) return { error: 'A die can only be moved once.' };
    const problem = moveProblem(next, pattern, move.from, move.to, options);
    if (problem) return { error: problem };
    next[move.to] = next[move.from];
    next[move.from] = null;
    touched.add(move.to);
  }
  if (sameColour && new Set(moves.map((m) => grid[m.from]?.c)).size > 1) return { error: 'Both dice must be the same colour.' };
  return { grid: next };
}

/**
 * The twelve tool cards (three are dealt each game). Each has id, name, text (rules), how (how to use it) and
 * prepare(room, seat, params, rng), which validates a request without changing anything and returns { error } or
 * { commit(), note }; see useTool for how the two halves are used.
 */
export const TOOLS = [
  {
    id: 'lathe',
    name: 'Lathe',
    text: 'Change a die in the pool by one shade, up or down. A 6 cannot become a 1, nor a 1 a 6.',
    how: 'Choose a pool die, then raise or lower it.',
    /**
     * Checks a Lathe request (params: die, delta of +1 or -1); changes nothing until commit() is called.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      const at = poolIndex(room, params.die);
      if (at === -1) return { error: NO_POOL_DIE };
      if (params.delta !== 1 && params.delta !== -1) return { error: 'Choose to raise or to lower the shade by one.' };
      const next = room.pool[at].v + params.delta;
      if (next < 1 || next > 6) return { error: 'A 6 cannot go up and a 1 cannot go down.' };
      return { commit: () => (room.pool[at].v = next), note: `changed a ${COLOUR_NAMES[room.pool[at].c]} die to ${next}` };
    },
  },
  {
    id: 'exchange',
    name: 'Exchange',
    text: 'Swap a die from the pool with a die on the round track.',
    how: 'Choose a pool die, then a die on the round track.',
    /**
     * Checks an Exchange request (params: die from the pool, trackDie from the track); commit() swaps them.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      const at = poolIndex(room, params.die);
      if (at === -1) return { error: NO_POOL_DIE };
      const found = trackEntry(room, params.trackDie);
      if (!found) return { error: 'Choose a die from the round track.' };
      return {
        commit() {
          [room.pool[at], found.dice[found.index]] = [found.dice[found.index], room.pool[at]];
        },
        note: 'swapped a pool die with one from the round track',
      };
    },
  },
  {
    id: 'refire',
    name: 'Re-fire',
    text: 'Roll one die in the pool again.',
    how: 'Choose a pool die.',
    /**
     * Checks a Re-fire request (params: die); commit() gives the die the next face of this turn's roll list (see nextFace).
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @param {() => number} rng  random source, used only by commit() when a die is rolled
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params, rng) {
      const at = poolIndex(room, params.die);
      if (at === -1) return { error: NO_POOL_DIE };
      return { commit: () => (room.pool[at].v = nextFace(room, rng)), note: `re-fired a ${COLOUR_NAMES[room.pool[at].c]} die` };
    },
  },
  {
    id: 'kiln',
    name: 'Great Kiln',
    text: 'Roll every die in the pool again. Only on your second turn of the round, before you place a die.',
    how: 'Just confirm.',
    /**
     * Checks a Great Kiln request (no params); commit() gives every pool die the next face of this turn's roll list.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @param {() => number} rng  random source, used only by commit() when a die is rolled
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params, rng) {
      if (room.turn.number !== 2) return { error: 'The Great Kiln can only be used on your second turn of a round.' };
      if (room.turn.placements > 0) return { error: 'The Great Kiln has to be used before you place a die.' };
      if (!room.pool.length) return { error: 'There are no dice in the pool.' };
      return { commit: () => room.pool.forEach((d) => (d.v = nextFace(room, rng))), note: 're-fired every die in the pool' };
    },
  },
  {
    id: 'mirror',
    name: 'Mirror',
    text: 'Turn a die in the pool over to its opposite face (1 and 6, 2 and 5, 3 and 4).',
    how: 'Choose a pool die.',
    /**
     * Checks a Mirror request (params: die); commit() turns the die to the opposite face.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      const at = poolIndex(room, params.die);
      if (at === -1) return { error: NO_POOL_DIE };
      return { commit: () => (room.pool[at].v = 7 - room.pool[at].v), note: `turned a ${COLOUR_NAMES[room.pool[at].c]} die over` };
    },
  },
  {
    id: 'slide',
    name: 'Slide Rule',
    text: 'Move one die in your window to another space, obeying every placement rule.',
    how: 'Click the die to move, then the space to move it to.',
    /**
     * Checks a Slide Rule request (params: from, to); commit() replaces the seat's window with the moved one.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      const plan = planMoves(room.grids[seat], patternOf(room.patterns[seat]), [{ from: params.from, to: params.to }], { min: 1, max: 1 });
      return plan.error ? plan : { commit: () => (room.grids[seat] = plan.grid), note: 'slid a die in their window' };
    },
  },
  {
    id: 'twin',
    name: 'Twin Slide',
    text: 'Move exactly two dice in your window, one after the other, obeying every placement rule.',
    how: 'Click a die and its new space, then a second die and its space.',
    /**
     * Checks a Twin Slide request (params: moves, exactly two { from, to }); commit() replaces the window.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      const plan = planMoves(room.grids[seat], patternOf(room.patterns[seat]), params.moves, { min: 2, max: 2 });
      return plan.error ? plan : { commit: () => (room.grids[seat] = plan.grid), note: 'slid two dice in their window' };
    },
  },
  {
    id: 'tint',
    name: 'Tint Shifter',
    text: 'Move one die in your window, ignoring the colour of the space it moves to (shades and neighbours still count).',
    how: 'Click the die to move, then the space to move it to.',
    /**
     * Checks a Tint Shifter request (params: from, to), ignoring the colour restriction of the target space.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      const plan = planMoves(room.grids[seat], patternOf(room.patterns[seat]), [{ from: params.from, to: params.to }], { min: 1, max: 1, options: { ignoreColour: true } });
      return plan.error ? plan : { commit: () => (room.grids[seat] = plan.grid), note: 'shifted a die, ignoring colour' };
    },
  },
  {
    id: 'gauge',
    name: 'Gauge Breaker',
    text: 'Move one die in your window, ignoring the shade of the space it moves to (colours and neighbours still count).',
    how: 'Click the die to move, then the space to move it to.',
    /**
     * Checks a Gauge Breaker request (params: from, to), ignoring the shade restriction of the target space.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      const plan = planMoves(room.grids[seat], patternOf(room.patterns[seat]), [{ from: params.from, to: params.to }], { min: 1, max: 1, options: { ignoreShade: true } });
      return plan.error ? plan : { commit: () => (room.grids[seat] = plan.grid), note: 'shifted a die, ignoring shade' };
    },
  },
  {
    id: 'echo',
    name: 'Track Echo',
    text: 'Move one or two dice in your window, all of one colour that also appears on the round track, obeying every placement rule.',
    how: 'Click a die and its new space (and a second die of the same colour and its space).',
    /**
     * Checks a Track Echo request (params: moves, one or two { from, to } of one colour that is on the round track).
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      const grid = room.grids[seat];
      const plan = planMoves(grid, patternOf(room.patterns[seat]), params.moves, { min: 1, max: 2, sameColour: true });
      if (plan.error) return plan;
      const colour = grid[params.moves[0].from].c;
      if (!room.track.some((dice) => dice.some((d) => d.c === colour))) return { error: `There is no ${COLOUR_NAMES[colour]} die on the round track.` };
      return { commit: () => (room.grids[seat] = plan.grid), note: `moved ${COLOUR_NAMES[colour]} dice in their window` };
    },
  },
  {
    id: 'free-pane',
    name: 'Free Pane',
    text: 'Place a die from the pool on any space that accepts it, even one that touches nothing (neighbours of the same colour or shade still count). This is your die for the turn.',
    how: 'Choose a pool die, then the space.',
    /**
     * Checks a Free Pane request (params: die, cell); commit() places the die like a normal placement but without the touching rule.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @param {object} params  the tool's parameters from the client (already known to be an object, but not to be valid)
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat, params) {
      if (room.turn.placements >= allowedPlacements(room)) return { error: 'You have already placed a die this turn.' };
      const at = poolIndex(room, params.die);
      if (at === -1) return { error: NO_POOL_DIE };
      const problem = cellProblem(room.grids[seat], patternOf(room.patterns[seat]), params.cell, room.pool[at], { ignoreTouch: true });
      if (problem) return { error: problem };
      return { commit: () => putDie(room, seat, at, params.cell), note: null };
    },
  },
  {
    id: 'swift-hand',
    name: 'Swift Hand',
    text: 'On your first turn of a round, take a second full turn straight after this one (choose another die, use more favour tokens if you wish). You then skip your second turn of the round.',
    how: 'Just confirm, then finish this turn as usual: your extra turn starts at once.',
    /**
     * Checks a Swift Hand request (no params); commit() marks the turn so that advanceTurn gives the same player another.
     *
     * @param {object} room  the room (not changed by prepare)
     * @param {number} seat  the seat using the tool
     * @returns {{ error: string } | { commit: () => void, note: string | null }} why it cannot be used, or what to do to apply it
     *
     * Side effects: none here; the returned commit() mutates the room (called by useTool once the tokens are paid).
     */
    prepare(room, seat) {
      if (room.turn.number !== 1) return { error: 'Swift Hand can only be used on your first turn of a round.' };
      if (room.turn.extra) return { error: 'You are already taking an extra turn.' };
      return {
        commit() {
          room.turn.swift = true; // when this turn ends, the same player starts another full turn
          room.skip[seat] = true;
        },
        note: 'will take an extra turn now, and skip their second turn',
      };
    },
  },
];
// The ids of every tool, for dealing a game's three.
export const TOOL_IDS = TOOLS.map((t) => t.id);

/**
 * The definition of a tool.
 *
 * @param {string} id  one of TOOL_IDS
 * @returns {object | null} the tool (id, name, text, how, prepare), or null if there is no such tool
 *
 * Side effects: none.
 */
export const toolOf = (id) => TOOLS.find((t) => t.id === id) ?? null;

// ---- creating a room ----

/**
 * Checks the game's settings (there is only one: bad private scoring) and fills in the ones not given.
 *
 * @param {unknown} input     what a client sent (anything; non-objects are ignored)
 * @param {object} [current]  the settings to start from
 * @returns {{ ok: true, settings: object } | { ok: false, error: string }} a new settings object; `current` is not changed
 *
 * Side effects: none.
 */
export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  if (isObject(input) && input.badPrivate !== undefined) {
    if (typeof input.badPrivate !== 'boolean') return fail('Bad private scoring must be on or off.');
    next.badPrivate = input.badPrivate;
  }
  return ok({ settings: next });
}

/**
 * Makes a new room in the lobby, with the host in the first seat.
 *
 * @param {object} args
 * @param {string} args.code      the invite code
 * @param {number} args.hostId    the host's account id
 * @param {string} args.hostName  the host's name
 * @param {number} [args.size]    how many seats (one of SIZES)
 * @param {object} [args.settings]  settings from the client (checked here)
 * @param {number} args.now     the creation time in milliseconds
 * @returns {object} the room
 * @throws {Error} when the size or the settings are not allowed (the message is fit to show to a person)
 *
 * Side effects: none (builds a new room; nothing is stored).
 */
export function createRoom({ code, hostId, hostName, size = DEFAULT_SIZE, settings = {}, now }) {
  if (!SIZES.includes(size)) throw new Error(`A game is for ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`);
  const normalised = normaliseSettings(settings);
  if (!normalised.ok) throw new Error(normalised.error);
  const room = {
    code,
    hostId,
    phase: 'lobby',
    size,
    settings: normalised.settings,
    seats: Array.from({ length: size }, (_, i) => (i === 0 ? { kind: 'human', id: hostId, name: hostName } : null)),
    nextBot: 1,
    createdAt: now,
    updatedAt: now,
  };
  resetGame(room);
  return room;
}

/**
 * Puts everything about a game in progress back to "nothing dealt yet" (used when a room is made, when the seats change
 * size, when a game starts and for "play again"). The seats, settings and host are kept.
 *
 * Side effect: mutates room.
 *
 * @param {object} room
 */
function resetGame(room) {
  Object.assign(room, {
    options: [],
    picked: [],
    bag: [],
    pool: [],
    track: [],
    patterns: [],
    grids: [],
    tokens: [],
    tokenTotal: 0,
    tools: [],
    spent: [],
    publicIds: [],
    privateColours: [],
    round: 0,
    first: 0,
    order: [],
    turnIndex: 0,
    turn: null,
    undo: null,
    rolls: [],
    rollsUsed: 0,
    skip: [],
    history: [],
    snapshot: [],
    log: [],
    tally: Array.from({ length: room.size }, () => ({ dicePlaced: 0, toolsUsed: 0 })),
    final: null,
    winners: null,
    recorded: false,
  });
}

/**
 * Adds a line to the game log (only the newest 60 lines are kept).
 *
 * Side effect: mutates room.log.
 *
 * @param {object} room
 * @param {number | null} seat  whose move it was, or null for something that happened to the table
 * @param {string} text         the line, which must not reveal anything hidden
 */
function addLog(room, seat, text) {
  addMove(room, { seat, text });
}

// ---- seats and settings ----

/**
 * The seat rules (join, leave, kick, computer players) are the shared ones. In Gaudi a person who leaves while windows are
 * being chosen or the game is being played is replaced by a computer player that picks its own AI at once (lobby bots get
 * theirs when the game starts), and the log says so. Nothing else needs doing when somebody leaves: the next computer move
 * is found by the server from the room itself.
 */
// (The shared seat rules, configured for Gaudi; addHuman, addBot, etc. below are taken from it.)
const seats = createSeatRules({
  isMidGame: (room) => room.phase === 'windows' || room.phase === 'playing',
  botNames: BOT_NAMES,
  /**
   * Called with the computer player about to replace a person who left. Writes the log line and chooses its AI.
   *
   * Side effect: mutates room.log (and uses the rng, after the bot's name was chosen, as before).
   *
   * @param {object} room  the room
   * @param {object} bot  the new computer player, with its name
   * @param {number} seat  the seat it takes
   * @param {() => number} rng  random source returning [0, 1), used to choose its AI
   * @returns {object} the bot, with its `ai` id, to put in the seat
   */
  takeOver(room, bot, seat, rng) {
    const taken = { ...bot, ai: pickAI(AIS, rng).id };
    addLog(room, seat, `${taken.name} takes over from a player who left`);
    return taken;
  },
});
export const { addHuman, addBot, removeBot, fillWithBots, kick, removeHuman } = seats;

/**
 * The AI a computer seat plays with (rooms saved before AIs existed fall back to the first).
 *
 * @param {object} room  the room
 * @param {number} seat  the computer's seat
 * @returns {object} an entry of AIS
 *
 * Side effects: none.
 */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat]?.ai);

/**
 * The host changes the game's settings. Lobby only.
 *
 * Side effect: mutates room.settings.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {unknown} input  the settings from the client
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 */
export function setSettings(room, userId, input) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  const next = normaliseSettings(input, room.settings);
  if (!next.ok) return next;
  room.settings = next.settings;
  return ok();
}

/**
 * The host chooses how many seats there are (2-5). People and computer players are kept, in order. Lobby only.
 *
 * Side effects: mutates room (the seats and size) and resets the game state.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {unknown} size   one of SIZES
 * @returns {{ ok: boolean, error?: string }}
 */
export function setSize(room, userId, size) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (!SIZES.includes(size)) return fail(`A game is for ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`);
  const seated = room.seats.filter(Boolean);
  if (seated.length > size) return fail('Remove some players before choosing fewer seats.');
  room.size = size;
  room.seats = [...seated, ...Array.from({ length: size - seated.length }, () => null)];
  resetGame(room);
  return ok();
}

// ---- starting: choosing windows ----

/**
 * The host starts the game: every seat must be filled and at least one must be a person. This deals the window cards, the
 * three tools, the three public objectives and each player's private colour, and gives every computer player its AI.
 * Everyone then chooses a window at the same time.
 *
 * Side effects: mutates room (resets the game, deals, moves to the 'windows' phase).
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 */
export function start(room, userId, rng) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('Every seat needs a player. Add computer players to fill the empty ones.');
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  // Two double-sided cards (four windows) each, no card dealt twice.
  const cards = shuffle(PATTERN_CARDS, rng);
  room.options = room.seats.map((_, seat) => cards.slice(seat * 2, seat * 2 + 2).flatMap((card) => card.faces.map((f) => f.pid)));
  // As in Sagrada, the tools, the public objectives and each player's private objective are dealt before the windows
  // are chosen, so that the choice can take them into account.
  room.tools = shuffle(TOOL_IDS, rng).slice(0, TOOL_COUNT);
  room.spent = room.tools.map(() => 0);
  room.publicIds = shuffle(OBJECTIVE_IDS, rng).slice(0, PUBLIC_COUNT);
  room.privateColours = shuffle(COLOURS, rng).slice(0, room.size);
  room.picked = room.seats.map(() => null);
  room.phase = 'windows';
  // Each computer player gets one AI for the whole game (picked last, so it does not change the deal).
  const bots = botSeats(room);
  const picked = assignAIs(AIS, bots, rng);
  for (const i of bots) room.seats[i].ai = picked[i];
  return ok();
}

/**
 * A player chooses one of their four windows. When everybody has chosen, the game begins.
 *
 * Side effects: mutates room.picked; may start the game (see beginGame).
 *
 * @param {object} room
 * @param {number} seat  who is choosing
 * @param {unknown} pid  the pattern id from the client
 * @param {() => number} rng  used for the first round's dice if this was the last choice
 * @returns {{ ok: boolean, error?: string }}
 */
export function chooseWindow(room, seat, pid, rng) {
  if (room.phase !== 'windows') return fail('It is not time to choose a window.');
  if (room.picked[seat]) return fail('You have already chosen your window.');
  if (typeof pid !== 'string' || !room.options[seat].includes(pid)) return fail('Choose one of your four windows.');
  room.picked[seat] = pid;
  if (room.picked.every(Boolean)) beginGame(room, rng);
  return ok();
}

/**
 * Starts play once every window is chosen: empty windows, favour tokens from the windows' difficulty, a shuffled bag,
 * and round one.
 *
 * Side effects: mutates room (moves to the 'playing' phase, writes the log, starts the first round).
 *
 * @param {object} room
 * @param {() => number} rng
 */
function beginGame(room, rng) {
  const n = room.size;
  room.patterns = room.picked.slice();
  room.grids = room.seats.map(() => emptyGrid());
  room.tokens = room.patterns.map((pid) => patternOf(pid).difficulty);
  room.tokenTotal = room.tokens.reduce((a, b) => a + b, 0);
  room.bag = makeBag(n, rng);
  room.pool = [];
  room.track = [];
  room.snapshot = room.seats.map(() => 0);
  room.round = 0;
  room.first = 0;
  room.phase = 'playing';
  addLog(room, null, 'The windows are set. Round 1 begins.');
  startRound(room, rng);
}

// ---- rounds and turns ----

/**
 * Begins the next round: works out the turn order, draws the pool from the bag (rolling each die) and starts the first turn.
 *
 * Side effects: mutates room (round, order, skip, pool, bag, turn).
 *
 * @param {object} room
 * @param {() => number} rng
 */
function startRound(room, rng) {
  room.round++;
  room.order = snakeOrder(room.first, room.size);
  room.skip = room.seats.map(() => false);
  room.pool = [];
  for (let i = 0; i < poolSize(room.size) && room.bag.length; i++) {
    const { id, c } = room.bag.pop();
    room.pool.push({ id, c, v: rollFace(rng) });
  }
  room.turnIndex = -1;
  advanceTurn(room, rng);
}

/**
 * Remembers how the table was when the current turn began, so that the player can take the whole turn back until they
 * press End turn. It holds everything a turn can change (the window, the pool, the round track, the bag, the favour tokens,
 * the tool markers and the tallies, and the Swift Hand skip), including the dice values already rolled, so that undoing
 * is exact. It is saved with the room and never sent to anyone.
 *
 * Also starts this turn's roll list empty (see nextFace): faces rolled by tools are remembered for the length of one turn.
 *
 * Side effects: mutates room.undo, room.rolls and room.rollsUsed.
 *
 * @param {object} room  a room with a current turn
 */
function saveTurnStart(room) {
  const seat = room.turn.seat;
  room.undo = {
    seat,
    turn: { ...room.turn },
    log: room.log, // the whole log (at most LOG_KEPT lines): a length alone cannot undo lines once the oldest are being dropped
    grid: room.grids[seat],
    pool: room.pool,
    track: room.track,
    bag: room.bag,
    tokens: room.tokens,
    spent: room.spent,
    tally: room.tally[seat],
    skip: room.skip,
  };
  room.undo = JSON.parse(JSON.stringify(room.undo));
  room.rolls = [];
  room.rollsUsed = 0;
}

/**
 * Has the current turn changed anything yet (so that there is something to undo)?
 *
 * @param {object} room  the room
 * @returns {boolean} true once a die has been placed or a tool used this turn
 *
 * Side effects: none.
 */
const turnChanged = (room) => Boolean(room.turn) && (room.turn.placements > 0 || room.turn.toolUsed);

/**
 * Takes the whole of the current turn back to its start (the player's own turn only; never across End turn). The dice go
 * back as they were, favour tokens are refunded and the log is cut back. The faces the turn has rolled stay on the turn's
 * roll list, so doing the same again gives the same result (see nextFace).
 *
 * Side effects: mutates room (window, pool, track, bag, tokens, tally, skip, turn, log, rollsUsed).
 *
 * @param {object} room
 * @param {number} seat  who is asking (must be the player whose turn it is)
 * @returns {{ ok: boolean, error?: string }}
 */
export function undoTurn(room, seat) {
  const problem = myTurn(room, seat);
  if (problem) return problem;
  const saved = room.undo;
  if (!saved || saved.seat !== seat || !turnChanged(room)) return fail('There is nothing to undo this turn.');
  const copy = JSON.parse(JSON.stringify(saved));
  room.grids[seat] = copy.grid;
  room.pool = copy.pool;
  room.track = copy.track;
  room.bag = copy.bag;
  room.tokens = copy.tokens;
  room.spent = copy.spent;
  room.tally[seat] = copy.tally;
  room.skip = copy.skip;
  room.turn = copy.turn;
  room.log = copy.log ?? room.log.slice(0, copy.logLength); // rooms saved before the log was kept whole hold only its length
  room.rollsUsed = 0; // the faces already rolled this turn are read back again, not rolled afresh
  return ok();
}

/**
 * Moves on to the next turn: an extra turn for the same player after Swift Hand, otherwise the next entry of the round's
 * order (skipping a second turn that Swift Hand gave up), or the end of the round when the order is used up.
 *
 * Side effects: mutates room (turn, turnIndex, log, undo, rolls) and may end the round or the game.
 *
 * @param {object} room
 * @param {() => number} rng  used if a new round has to be started
 */
function advanceTurn(room, rng) {
  if (room.turn?.swift && room.phase === 'playing') {
    // Swift Hand: a fresh full turn for the same player, before anyone else moves.
    const { seat, number } = room.turn;
    room.turn = { seat, number, placements: 0, toolUsed: false, extra: true, swift: false };
    addLog(room, seat, `${seatName(room, seat)} takes an extra turn`);
    saveTurnStart(room);
    return;
  }
  for (;;) {
    room.turnIndex++;
    if (room.turnIndex >= room.order.length) return endRound(room, rng);
    const seat = room.order[room.turnIndex];
    const number = room.turnIndex < room.size ? 1 : 2;
    if (number === 2 && room.skip[seat]) {
      addLog(room, seat, `${seatName(room, seat)} skips their second turn`);
      continue;
    }
    room.turn = { seat, number, placements: 0, toolUsed: false, extra: false, swift: false };
    saveTurnStart(room);
    return;
  }
}

/**
 * The current provisional score of a seat: public objectives + favour tokens - empty spaces.
 *
 * @param {object} room  the room
 * @param {number} seat  the seat
 * @returns {number} the provisional score
 *
 * Side effects: none.
 */
export const provisionalOf = (room, seat) => provisionalScore(room.grids[seat], room.publicIds, room.tokens[seat]);

/**
 * A seat's private objective points so far (known only to that player until the end).
 *
 * @param {object} room  the room
 * @param {number} seat  the seat
 * @returns {number} the private points so far
 *
 * Side effects: none.
 */
export const privateOf = (room, seat) => privatePoints(room.grids[seat], room.privateColours[seat], room.settings.badPrivate);

/**
 * Ends the round: the pool goes onto the round track, the round's score changes are recorded, and either the game ends
 * after the last round or the next round starts with the first player moved on by one seat.
 *
 * Side effects: mutates room (track, pool, turn, undo, history, snapshot, log, first) and may finish the game.
 *
 * @param {object} room
 * @param {() => number} rng
 */
function endRound(room, rng) {
  room.track.push(room.pool);
  room.pool = [];
  room.turn = null;
  room.undo = null;
  const now = room.seats.map((_, seat) => provisionalOf(room, seat));
  room.history.push({
    label: `Round ${room.round}`,
    deltas: Object.fromEntries(now.map((score, seat) => [seat, score - room.snapshot[seat]])),
    notes: {},
  });
  room.snapshot = now;
  addLog(room, null, `Round ${room.round} is over.`);
  if (room.round >= ROUNDS) return finishGame(room);
  room.first = (room.first + 1) % room.size;
  startRound(room, rng);
}

/**
 * Orders the players for the tie-break rules; lower rank is better. Everything is read from the finished windows.
 *
 * @param {object} room  a room whose windows are final
 * @returns {{ rows: object[], winners: number[] }} one row per seat (scores, objectives, placement) and the winning seats
 *
 * Why this order: the total decides, then private points, then favour tokens left, then whoever played last in the final
 * round (the tie-break of the board game); seats equal on all four share the win.
 *
 * Side effects: none.
 */
export function finalTable(room) {
  const last = room.order.length ? room.order : snakeOrder(room.first, room.size);
  const rows = room.seats.map((seat, i) => {
    const publics = room.publicIds.map((id) => ({ id, ...objectivePoints(id, room.grids[i]) }));
    const publicSum = publics.reduce((sum, p) => sum + p.points, 0);
    const priv = privateOf(room, i);
    const empty = emptySpaces(room.grids[i]);
    return {
      seat: i,
      name: seat?.name ?? `Player ${i + 1}`,
      pattern: room.patterns[i],
      publics,
      publicTotal: publicSum,
      privateColour: room.privateColours[i],
      privatePoints: priv,
      tokens: room.tokens[i],
      empty,
      total: publicSum + priv + room.tokens[i] - empty,
      lastTurn: last.lastIndexOf(i),
    };
  });
  // The tie-break keys of a row, best-first; higher is better for every one of them.
  const key = (r) => [r.total, r.privatePoints, r.tokens, r.lastTurn];
  // Sort comparison: negative when a ranks above b, zero when they are tied on all four keys.
  const compare = (a, b) => {
    for (let k = 0; k < 4; k++) if (key(a)[k] !== key(b)[k]) return key(b)[k] - key(a)[k];
    return 0;
  };
  const ranked = rows.slice().sort(compare);
  for (const row of rows) row.placement = 1 + rows.filter((other) => compare(other, row) < 0).length;
  return { rows, winners: ranked.filter((r) => compare(r, ranked[0]) === 0).map((r) => r.seat) };
}

/**
 * Finishes the game: works out the final table, records the winners and the private-objective round, and logs the result.
 *
 * Side effects: mutates room (phase, winners, final, history, log).
 *
 * @param {object} room
 */
function finishGame(room) {
  const { rows, winners } = finalTable(room);
  room.phase = 'finished';
  room.winners = winners;
  room.final = { players: rows };
  room.history.push({
    label: 'Private objectives',
    deltas: Object.fromEntries(rows.map((r) => [r.seat, r.privatePoints])),
    notes: Object.fromEntries(winners.map((s) => [s, 'wins'])),
  });
  addLog(room, null, `The game is over. ${winners.map((s) => rows[s].name).join(' and ')} ${winners.length > 1 ? 'share the win' : 'wins'}.`);
}

/**
 * How many dice a player may place in one turn. One: Swift Hand gives a whole extra turn instead of a second die.
 *
 * @returns {number} always 1
 *
 * Side effects: none.
 */
const allowedPlacements = () => 1;

/**
 * Checks that it is this seat's turn in a game being played.
 *
 * @param {object} room  the room
 * @param {number} seat  the seat trying to act
 * @returns {{ ok: false, error: string } | null} the failure to return, or null if the seat may act
 *
 * Side effects: none.
 */
function myTurn(room, seat) {
  if (room.phase !== 'playing' || !room.turn) return fail('The game is not being played.');
  if (room.turn.seat !== seat) return fail('It is not your turn.');
  return null;
}

/**
 * Moves a die from the pool into a space of a window and counts it. The caller has checked that this is legal.
 *
 * Side effects: mutates room (pool, the seat's window, turn.placements, tally, log).
 *
 * @param {object} room
 * @param {number} seat
 * @param {number} poolAt  the die's index in room.pool
 * @param {number} cell    the space, 0-19
 */
function putDie(room, seat, poolAt, cell) {
  const [die] = room.pool.splice(poolAt, 1);
  room.grids[seat][cell] = die;
  room.turn.placements++;
  room.tally[seat].dicePlaced++;
  addLog(room, seat, `${seatName(room, seat)} placed a ${COLOUR_NAMES[die.c]} ${die.v} at row ${rowOf(cell) + 1}, column ${colOf(cell) + 1}`);
}

/**
 * The player places a die from the pool in their window (one per turn).
 *
 * Side effects: on success, see putDie.
 *
 * @param {object} room
 * @param {number} seat
 * @param {{ die: number, cell: number }} args  the pool die's id and the space, as sent by the client
 * @param {() => number} rng  not used; accepted so that every action has the same signature
 * @returns {{ ok: boolean, error?: string }}
 */
export function placeDie(room, seat, args, rng) {
  const { die, cell } = isObject(args) ? args : {};
  const problem = myTurn(room, seat);
  if (problem) return problem;
  if (room.turn.placements >= allowedPlacements(room)) return fail('You have already placed a die this turn.');
  const at = poolIndex(room, die);
  if (at === -1) return fail(NO_POOL_DIE);
  const reason = cellProblem(room.grids[seat], patternOf(room.patterns[seat]), cell, room.pool[at]);
  if (reason) return fail(reason);
  putDie(room, seat, at, cell);
  return ok();
}

/**
 * What using a tool costs now: one favour token, or two once somebody has already used that tool.
 *
 * @param {object} room  the room
 * @param {number} index  the tool's place among the game's three tools
 * @returns {number} 1 or 2 favour tokens
 *
 * Side effects: none.
 */
export const toolCost = (room, index) => (room.spent[index] > 0 ? 2 : 1);

/**
 * The player uses a tool card (one per turn). The request is checked as a whole first and nothing changes unless all of it
 * is valid; then the favour tokens are paid and the tool takes effect.
 *
 * Side effects: on success mutates room (tokens, spent, turn.toolUsed, tally, log, and whatever the tool changes).
 *
 * @param {object} room
 * @param {number} seat
 * @param {{ tool: string, params: object }} args  the tool id and its parameters, as sent by the client
 * @param {() => number} rng  random numbers for a roll that has not been made yet this turn (see nextFace)
 * @returns {{ ok: boolean, cost?: number, error?: string }}
 */
export function useTool(room, seat, args, rng) {
  const { tool, params } = isObject(args) ? args : {};
  const problem = myTurn(room, seat);
  if (problem) return problem;
  const index = typeof tool === 'string' ? room.tools.indexOf(tool) : -1;
  if (index === -1) return fail('That tool is not in this game.');
  if (room.turn.toolUsed) return fail('You have already used a tool this turn.');
  const cost = toolCost(room, index);
  if (room.tokens[seat] < cost) return fail(`That tool costs ${cost} favour ${cost === 1 ? 'token' : 'tokens'} and you have ${room.tokens[seat]}.`);
  const def = toolOf(tool);
  const prepared = def.prepare(room, seat, isObject(params) ? params : {}, rng);
  if (prepared.error) return fail(prepared.error);
  room.tokens[seat] -= cost;
  room.spent[index] += cost;
  room.turn.toolUsed = true;
  room.tally[seat].toolsUsed++;
  prepared.commit();
  addLog(room, seat, `${seatName(room, seat)} used ${def.name}${prepared.note ? `: ${prepared.note}` : ''} (${cost} ${cost === 1 ? 'token' : 'tokens'})`);
  return ok({ cost });
}

/**
 * The player ends their turn (they may end it without placing a die). The turn passes on; after the last turn of the round
 * the round ends, and after the last round the game does.
 *
 * Side effects: see advanceTurn.
 *
 * @param {object} room
 * @param {number} seat
 * @param {() => number} rng  used if a new round starts
 * @returns {{ ok: boolean, error?: string }}
 */
export function endTurn(room, seat, rng) {
  const problem = myTurn(room, seat);
  if (problem) return problem;
  advanceTurn(room, rng);
  return ok();
}

/**
 * The host sends everyone back to the lobby after a finished game. The seats stay; computer players will pick new AIs.
 *
 * Side effects: mutates room (resets the game, removes the bots' AIs, back to the 'lobby' phase).
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @returns {{ ok: boolean, error?: string }}
 */
export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over.');
  resetGame(room);
  for (const seat of room.seats) if (isBot(seat)) delete seat.ai; // a new game picks new AIs
  room.phase = 'lobby';
  return ok();
}

/**
 * What the statistics should record for a finished game: one entry per human still seated.
 *
 * @param {object} room  a finished room
 * @returns {object[]} { userId, outcome, placement, score, extras } for each person
 *
 * Side effects: none.
 */
export function statsPlayers(room) {
  const rows = room.final.players;
  return statsRows(room.seats, (seat, i) => ({
    outcome: room.winners.includes(i) ? 'win' : 'loss',
    placement: rows[i].placement,
    score: rows[i].total,
    extras: {
      dicePlaced: room.tally[i].dicePlaced,
      toolsUsed: room.tally[i].toolsUsed,
      perfectWindows: emptySpaces(room.grids[i]) === 0 ? 1 : 0,
      bestPublicObjective: Math.max(0, ...rows[i].publics.map((p) => p.points)),
      perfectBoards: isPerfect(room.grids[i], room.publicIds) ? 1 : 0,
      privateTotal: rows[i].privatePoints,
      emptySpaces: rows[i].empty,
    },
  }));
}

// ---- what each player may see ----

/**
 * One seat's window as shown to everybody: its pattern and the dice placed so far.
 *
 * @param {object} room  a room that has started
 * @param {number} seat
 * @returns {{ pid: string, name: string, difficulty: number, rows: string[], grid: (object | null)[] }} the window, to be sent to everybody
 *
 * Side effects: none.
 */
function windowView(room, seat) {
  const pattern = patternOf(room.patterns[seat]);
  return { pid: pattern.pid, name: pattern.name, difficulty: pattern.difficulty, rows: pattern.rows, grid: room.grids[seat] };
}

/**
 * The words on a tool card.
 *
 * @param {string} id  a tool id
 * @returns {{ name: string, text: string, how: string }} the card text
 *
 * Side effects: none.
 */
const pickToolText = (id) => {
  const { name, text, how } = toolOf(id);
  return { name, text, how };
};

/**
 * The words on a public objective card (before the game starts there is no score to show).
 *
 * @param {string} id  an objective id
 * @returns {{ id: string, name: string, text: string, points: number, unit: string }} the card text
 *
 * Side effects: none.
 */
const publicText = (id) => {
  const { name, text, points, unit } = objectiveOf(id);
  return { id, name, text, points, unit };
};

/**
 * Has the game been dealt in this phase (so that windows, scores and dice mean something)?
 *
 * @param {object} room  not changed
 * @returns {boolean} true once play has started
 *
 * Side effects: none.
 */
const hasStarted = (room) => room.phase === 'playing' || room.phase === 'finished';

/**
 * One occupied seat as the table shows it to everybody.
 *
 * @param {object} room  not changed
 * @param {number} i  the seat's index
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object} the seat's public details (never its secrets)
 *
 * Side effects: none.
 */
function seatView(room, i, online) {
  const seat = room.seats[i];
  const started = hasStarted(room);
  return {
    seat: i,
    name: seat.name,
    bot: isBot(seat),
    ...(isBot(seat) && room.phase !== 'lobby' ? { ai: { id: aiOf(room, i).id, name: aiOf(room, i).name } } : {}),
    online: isBot(seat) || online(seat.id),
    picked: room.phase === 'windows' ? Boolean(room.picked[i]) : started,
    window: started ? windowView(room, i) : null,
    tokens: started ? room.tokens[i] : 0,
    score: started ? provisionalOf(room, i) : 0,
    empty: started ? emptySpaces(room.grids[i]) : 0,
    skipping: started && Boolean(room.skip[i]),
  };
}

/**
 * The standard scoreboard (shared/scores.js). While the game is on, the scores are provisional and the viewer sees a note of
 * their own secret points.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object} the scoreboard view
 *
 * Side effects: none.
 */
function scoreboardView(room, me, online) {
  const started = hasStarted(room);
  const finished = room.phase === 'finished';
  // One scoreboard entry; the viewer's own entry also shows their secret points so far. Side effects: none.
  const player = (seat, i) => {
    const score = !started ? 0 : finished ? room.final.players[i].total : provisionalOf(room, i);
    const entry = seatScoreboardEntry(seat, i, { score, me, current: room.turn?.seat === i, online });
    if (started && !finished && i === me) entry.note = `+${privateOf(room, i)} secret`;
    return entry;
  };
  return {
    players: room.seats.flatMap((seat, i) => (seat ? [player(seat, i)] : [])),
    rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
    lowIsBetter: false,
    provisional: !finished,
  };
}

/**
 * The window patterns the viewer may choose from while the windows are being picked (nobody else's choices).
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {{ options: object[], chosen: string | null }} the viewer's four windows and their choice (empty for a spectator)
 *
 * Side effects: none.
 */
function windowChoiceView(room, me) {
  return {
    options: me === -1 ? [] : room.options[me].map((pid) => {
      const { name, difficulty, rows } = patternOf(pid);
      return { pid, name, difficulty, rows };
    }),
    chosen: me === -1 ? null : room.picked[me],
  };
}

/**
 * What is dealt before the windows are picked: the tools, the public objectives and the viewer's own private objective (nobody
 * else's).
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {object} fields to add to the view
 *
 * Side effects: none.
 */
function dealtView(room, me) {
  return {
    tools: room.tools.map((id, i) => ({ id, ...pickToolText(id), spent: room.spent[i], cost: toolCost(room, i) })),
    publicObjectives: room.publicIds.map((id) => ({ ...publicText(id), mine: null })),
    privateObjective: me === -1 ? null : { colour: room.privateColours[me], points: 0 },
    badPrivate: room.settings.badPrivate,
  };
}

/**
 * The dice pool, the round track, the tools and objectives and the turn: what a viewer may see once the game has started.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {object} fields to add to the view when the game has started
 *
 * Side effects: none.
 */
function playView(room, me) {
  const finished = room.phase === 'finished';
  return {
    round: room.round,
    first: room.first,
    order: room.order,
    turnIndex: room.turnIndex,
    turn: room.turn ? { ...room.turn, allowed: allowedPlacements(room), canUndo: Boolean(room.undo) && room.undo.seat === room.turn.seat && turnChanged(room) } : null,
    pool: room.pool,
    track: room.track,
    bagCount: room.bag.length,
    tools: room.tools.map((id, i) => {
      const { name, text, how } = toolOf(id);
      return { id, name, text, how, spent: room.spent[i], cost: toolCost(room, i) };
    }),
    publicObjectives: room.publicIds.map((id) => {
      const { name, text, points, unit } = objectiveOf(id);
      return { id, name, text, points, unit, mine: me === -1 ? null : objectivePoints(id, room.grids[me]) };
    }),
    privateObjective: me === -1 || finished ? null : { colour: room.privateColours[me], points: privateOf(room, me) },
    badPrivate: room.settings.badPrivate,
    final: finished ? room.final : null,
  };
}

/**
 * Everything one account may know: the public table and its own secrets, never anybody else's.
 *
 * @param {object} room
 * @param {number} userId  the viewer (a spectator or somebody not seated gets seat -1 and no secrets)
 * @param {object} [options]
 * @param {(id: number) => boolean} [options.online]  whether a person is connected, to show who is away
 * @returns {object} the view the client draws; it never contains the bag, the undo state or the roll list
 *
 * Side effects: none.
 */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const view = {
    code: room.code,
    phase: room.phase,
    you: me,
    hostSeat: seatOf(room, room.hostId),
    size: room.size,
    settings: room.settings,
    seats: room.seats.map((seat, i) => (seat ? seatView(room, i, online) : null)),
    scoreboard: scoreboardView(room, me, online),
    winners: room.winners,
    limits: { sizes: SIZES, rounds: ROUNDS },
    log: recentMoves(room, 14),
  };
  if (room.phase === 'windows') Object.assign(view, windowChoiceView(room, me));
  if (room.phase === 'windows' && room.privateColours.length) Object.assign(view, dealtView(room, me)); // dealt before the windows
  if (hasStarted(room)) Object.assign(view, playView(room, me));
  return view;
}

export { BAD_PRIVATE_POINTS, CELLS, OBJECTIVES, privatePoints };
