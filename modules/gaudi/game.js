// The rules of Gaudi, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }; an error never names hidden information.
//
// Seats 0..size-1 run clockwise. A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer player
// ({ kind: 'bot', id: 'bot:<n>', name, ai: <id of its AI, set when the game starts> }) or null (empty, lobby only).
//
// Dice: { id, c: colour, v: 1-6 }. The bag holds { id, c } only (a die has no face until it is rolled). Every die is in
// exactly one place: the bag, the pool, a round-track entry or a window. There is no discard pile: every tool keeps
// every die in play, so bag + pool + track + windows is always 10 x (2n + 1).
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
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
export const SIZES = [2, 3, 4, 5];
export const DEFAULT_SIZE = 4;
export const DEFAULT_SETTINGS = { badPrivate: false };
export const STAT_KEYS = ['dicePlaced', 'toolsUsed', 'perfectWindows', 'bestPublicObjective', 'perfectBoards', 'privateTotal', 'emptySpaces'];
export const BOT_NAMES = ['Gaudi', 'Jujol', 'Lluis', 'Pau', 'Mercè', 'Rosa', 'Enric', 'Núria', 'Joan', 'Elena'];
export const TOOL_COUNT = 3;
export const PUBLIC_COUNT = 3;
export const WINDOW_OPTIONS = 4;

const LIVE = ['lobby', 'windows', 'playing'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInt = Number.isInteger;

export const isLive = (room) => LIVE.includes(room.phase);
export const isHuman = (seat) => seat?.kind === 'human';
export const isBot = (seat) => seat?.kind === 'bot';
export const seatOf = (room, userId) => room.seats.findIndex((s) => isHuman(s) && s.id === userId);
export const hasPlayer = (room, userId) => seatOf(room, userId) !== -1;
export const humanSeats = (room) => room.seats.flatMap((s, i) => (isHuman(s) ? [i] : []));
export const seatName = (room, seat) => room.seats[seat]?.name ?? 'Someone';

/** A seat order for one round: clockwise from the first player, then back again (A B C C B A). */
export function snakeOrder(first, players) {
  const forward = Array.from({ length: players }, (_, i) => (first + i) % players);
  return [...forward, ...forward.slice().reverse()];
}

/** In-place Fisher-Yates shuffle. */
export function shuffle(items, rng = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
const pickOne = (items, rng) => items[Math.floor(rng() * items.length)];
const rollFace = (rng) => 1 + Math.floor(rng() * 6);

/** A new bag for this many players: dicePerColour of each colour, in a random order. */
export function makeBag(players, rng = Math.random) {
  const dice = [];
  for (const c of COLOURS) for (let n = 0; n < dicePerColour(players); n++) dice.push({ id: dice.length, c });
  return shuffle(dice, rng);
}

// ---- the tool cards ----
// Each tool's prepare() checks everything and changes nothing: it returns { error } or { commit(), note }. useTool()
// charges the favour tokens and calls commit() only when the whole request is valid, so a tool is atomic.

const poolIndex = (room, id) => (isInt(id) ? room.pool.findIndex((d) => d.id === id) : -1);
const NO_POOL_DIE = 'Choose a die from the pool.';

function trackEntry(room, id) {
  if (!isInt(id)) return null;
  for (const dice of room.track) {
    const index = dice.findIndex((d) => d.id === id);
    if (index !== -1) return { dice, index };
  }
  return null;
}

/** Applies a list of { from, to } moves to a copy of the window; every step must obey the placement rules. */
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

export const TOOLS = [
  {
    id: 'lathe',
    name: 'Lathe',
    text: 'Change a die in the pool by one shade, up or down. A 6 cannot become a 1, nor a 1 a 6.',
    how: 'Choose a pool die, then raise or lower it.',
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
    prepare(room, seat, params, rng) {
      const at = poolIndex(room, params.die);
      if (at === -1) return { error: NO_POOL_DIE };
      return { commit: () => (room.pool[at].v = rollFace(rng)), note: `re-fired a ${COLOUR_NAMES[room.pool[at].c]} die` };
    },
  },
  {
    id: 'kiln',
    name: 'Great Kiln',
    text: 'Roll every die in the pool again. Only on your second turn of the round, before you place a die.',
    how: 'Just confirm.',
    prepare(room, seat, params, rng) {
      if (room.turn.number !== 2) return { error: 'The Great Kiln can only be used on your second turn of a round.' };
      if (room.turn.placements > 0) return { error: 'The Great Kiln has to be used before you place a die.' };
      if (!room.pool.length) return { error: 'There are no dice in the pool.' };
      return { commit: () => room.pool.forEach((d) => (d.v = rollFace(rng))), note: 're-fired every die in the pool' };
    },
  },
  {
    id: 'mirror',
    name: 'Mirror',
    text: 'Turn a die in the pool over to its opposite face (1 and 6, 2 and 5, 3 and 4).',
    how: 'Choose a pool die.',
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
export const TOOL_IDS = TOOLS.map((t) => t.id);
export const toolOf = (id) => TOOLS.find((t) => t.id === id) ?? null;

// ---- creating a room ----

export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  if (isObject(input) && input.badPrivate !== undefined) {
    if (typeof input.badPrivate !== 'boolean') return fail('Bad private scoring must be on or off.');
    next.badPrivate = input.badPrivate;
  }
  return ok({ settings: next });
}

export function createRoom({ code, hostId, hostName, size = DEFAULT_SIZE, settings = {}, now = Date.now() }) {
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

const addLog = (room, seat, text) => {
  room.log.push({ seat, text });
  if (room.log.length > 60) room.log.splice(0, room.log.length - 60);
};

// ---- seats and settings ----

const firstEmpty = (room) => room.seats.findIndex((s) => s === null);

/** A name nobody at the table has: "Ann", then "Ann (2)", "Ann (3)". */
export function uniqueName(room, name) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} (${n})`)) return `${name} (${n})`;
}

export function addHuman(room, userId, name) {
  if (hasPlayer(room, userId)) return ok({ seat: seatOf(room, userId) });
  if (room.phase !== 'lobby') return fail('That game has already started.');
  const seat = firstEmpty(room);
  if (seat === -1) return fail('That game is full.');
  room.seats[seat] = { kind: 'human', id: userId, name: uniqueName(room, name) };
  return ok({ seat });
}

/** A new computer player. A replacement joining mid-game passes the rng and picks its AI now; lobby bots get one at the start. */
function newBot(room, rng = null) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
  const base = BOT_NAMES.find((n) => !used.has(n)) ?? 'Computer';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
  const seat = { kind: 'bot', id: `bot:${room.nextBot++}`, name };
  if (rng) seat.ai = pickAI(AIS, rng).id;
  return seat;
}

/** The AI a computer seat plays with (rooms saved before AIs existed fall back to the first). */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat]?.ai);

/**
 * Removes a human. Before the game starts (or after it ends) the seat is freed; mid-game a computer player takes
 * it over. `empty` is true when no human is left, so the room should be discarded.
 */
export function removeHuman(room, userId, rng = Math.random) {
  const seat = seatOf(room, userId);
  if (seat === -1) return fail('You are not in this game.');
  const midGame = room.phase === 'windows' || room.phase === 'playing';
  room.seats[seat] = midGame ? newBot(room, rng) : null;
  if (midGame) addLog(room, seat, `${room.seats[seat].name} takes over from a player who left`);
  const humans = humanSeats(room);
  if (!humans.length) return ok({ empty: true, seat });
  if (room.hostId === userId) room.hostId = room.seats[humans[0]].id;
  return ok({ empty: false, seat, replaced: midGame });
}

const asHost = (room, userId) => (room.hostId === userId ? null : fail('Only the host can do that.'));
const inLobby = (room) => (room.phase === 'lobby' ? null : fail('You can only change that before the game starts.'));
const hostInLobby = (room, userId) => asHost(room, userId) ?? inLobby(room);

export function setSettings(room, userId, input) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  const next = normaliseSettings(input, room.settings);
  if (!next.ok) return next;
  room.settings = next.settings;
  return ok();
}

/** The host chooses how many seats there are (2-5). People and computer players are kept, in order. */
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

export function addBot(room, userId, seat) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  const index = seat === undefined ? firstEmpty(room) : seat;
  if (index === -1) return fail('Every seat is taken.');
  if (!isInt(index) || index < 0 || index >= room.size) return fail('There is no such seat.');
  if (room.seats[index]) return fail('That seat is taken.');
  room.seats[index] = newBot(room);
  return ok({ seat: index });
}

/**
 * The host removes another person, at any time before the game is over: in the lobby their seat is freed, and in a
 * game a computer player takes it over (as when someone leaves). The result names the person so the server can send
 * them home.
 */
export function kick(room, hostId, seat, rng = Math.random) {
  const problem = asHost(room, hostId);
  if (problem) return problem;
  const target = isInt(seat) ? room.seats[seat] : null;
  if (!isHuman(target) || target.id === hostId) return fail('There is no one else in that seat.');
  if (room.phase === 'finished') return fail('The game is over: there is nobody to remove.');
  const removed = removeHuman(room, target.id, rng);
  return removed.ok ? ok({ userId: target.id, replaced: Boolean(removed.replaced) }) : removed;
}

export function removeBot(room, userId, seat) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (!isInt(seat) || !isBot(room.seats[seat])) return fail('There is no computer player in that seat.');
  room.seats[seat] = null;
  return ok();
}

export function fillWithBots(room, userId) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  for (let i = 0; i < room.size; i++) if (!room.seats[i]) room.seats[i] = newBot(room);
  return ok();
}

// ---- starting: choosing windows ----

export function start(room, userId, rng = Math.random) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('Every seat needs a player. Add computer players to fill the empty ones.');
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  // Two double-sided cards (four windows) each, no card dealt twice.
  const cards = shuffle(PATTERN_CARDS.slice(), rng);
  room.options = room.seats.map((_, seat) => cards.slice(seat * 2, seat * 2 + 2).flatMap((card) => card.faces.map((f) => f.pid)));
  // As in Sagrada, the tools, the public objectives and each player's private objective are dealt before the windows
  // are chosen, so that the choice can take them into account.
  room.tools = shuffle(TOOL_IDS.slice(), rng).slice(0, TOOL_COUNT);
  room.spent = room.tools.map(() => 0);
  room.publicIds = shuffle(OBJECTIVE_IDS.slice(), rng).slice(0, PUBLIC_COUNT);
  room.privateColours = shuffle(COLOURS.slice(), rng).slice(0, room.size);
  room.picked = room.seats.map(() => null);
  room.phase = 'windows';
  // Each computer player gets one AI for the whole game (picked last, so it does not change the deal).
  const botSeats = room.seats.flatMap((s, i) => (isBot(s) ? [i] : []));
  const picked = assignAIs(AIS, botSeats, rng);
  for (const i of botSeats) room.seats[i].ai = picked[i];
  return ok();
}

export function chooseWindow(room, seat, pid, rng = Math.random) {
  if (room.phase !== 'windows') return fail('It is not time to choose a window.');
  if (room.picked[seat]) return fail('You have already chosen your window.');
  if (typeof pid !== 'string' || !room.options[seat].includes(pid)) return fail('Choose one of your four windows.');
  room.picked[seat] = pid;
  if (room.picked.every(Boolean)) beginGame(room, rng);
  return ok();
}

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
 * is exact and never rolls anything again. It is saved with the room and never sent to anyone.
 */
function saveTurnStart(room) {
  const seat = room.turn.seat;
  room.undo = {
    seat,
    turn: { ...room.turn },
    logLength: room.log.length,
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
}

const turnChanged = (room) => Boolean(room.turn) && (room.turn.placements > 0 || room.turn.toolUsed);

/** Takes the whole of the current turn back to its start (the player's own turn only; never across End turn). */
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
  room.log.length = copy.logLength;
  return ok();
}

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

/** The current provisional score of a seat: public objectives + favour tokens - empty spaces. */
export const provisionalOf = (room, seat) => provisionalScore(room.grids[seat], room.publicIds, room.tokens[seat]);
export const privateOf = (room, seat) => privatePoints(room.grids[seat], room.privateColours[seat], room.settings.badPrivate);
const publicTotal = (room, seat) => room.publicIds.reduce((sum, id) => sum + objectivePoints(id, room.grids[seat]).points, 0);

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

/** Orders the players for the tie-break rules; lower rank is better. Everything is read from the finished windows. */
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
  const key = (r) => [r.total, r.privatePoints, r.tokens, r.lastTurn];
  const compare = (a, b) => {
    for (let k = 0; k < 4; k++) if (key(a)[k] !== key(b)[k]) return key(b)[k] - key(a)[k];
    return 0;
  };
  const ranked = rows.slice().sort(compare);
  for (const row of rows) row.placement = 1 + rows.filter((other) => compare(other, row) < 0).length;
  return { rows, winners: ranked.filter((r) => compare(r, ranked[0]) === 0).map((r) => r.seat) };
}

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

const allowedPlacements = () => 1; // one die per turn; Swift Hand gives a whole extra turn instead

function myTurn(room, seat) {
  if (room.phase !== 'playing' || !room.turn) return fail('The game is not being played.');
  if (room.turn.seat !== seat) return fail('It is not your turn.');
  return null;
}

function putDie(room, seat, poolAt, cell) {
  const [die] = room.pool.splice(poolAt, 1);
  room.grids[seat][cell] = die;
  room.turn.placements++;
  room.tally[seat].dicePlaced++;
  addLog(room, seat, `${seatName(room, seat)} placed a ${COLOUR_NAMES[die.c]} ${die.v} at row ${rowOf(cell) + 1}, column ${colOf(cell) + 1}`);
}

export function placeDie(room, seat, args, rng = Math.random) {
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

export const toolCost = (room, index) => (room.spent[index] > 0 ? 2 : 1);

export function useTool(room, seat, args, rng = Math.random) {
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

export function endTurn(room, seat, rng = Math.random) {
  const problem = myTurn(room, seat);
  if (problem) return problem;
  advanceTurn(room, rng);
  return ok();
}

export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over.');
  resetGame(room);
  for (const seat of room.seats) if (isBot(seat)) delete seat.ai; // a new game picks new AIs
  room.phase = 'lobby';
  return ok();
}

/** What the statistics should record for a finished game: one entry per human still seated. */
export function statsPlayers(room) {
  const rows = room.final.players;
  return room.seats.flatMap((seat, i) =>
    isHuman(seat)
      ? [
          {
            userId: seat.id,
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
          },
        ]
      : [],
  );
}

// ---- what each player may see ----

function windowView(room, seat) {
  const pattern = patternOf(room.patterns[seat]);
  return { pid: pattern.pid, name: pattern.name, difficulty: pattern.difficulty, rows: pattern.rows, grid: room.grids[seat] };
}

const pickToolText = (id) => {
  const { name, text, how } = toolOf(id);
  return { name, text, how };
};
const publicText = (id) => {
  const { name, text, points, unit } = objectiveOf(id);
  return { id, name, text, points, unit };
};

/** Everything one account may know: the public table and its own secrets, never anybody else's. */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const started = room.phase === 'playing' || room.phase === 'finished';
  const finished = room.phase === 'finished';
  const view = {
    code: room.code,
    phase: room.phase,
    you: me,
    hostSeat: seatOf(room, room.hostId),
    size: room.size,
    settings: room.settings,
    seats: room.seats.map((seat, i) =>
      seat
        ? {
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
          }
        : null,
    ),
    scoreboard: {
      players: room.seats.flatMap((seat, i) => {
        if (!seat) return [];
        const score = !started ? 0 : finished ? room.final.players[i].total : provisionalOf(room, i);
        const player = { id: i, name: seat.name, userId: isHuman(seat) ? seat.id : undefined, score, isMe: i === me, bot: isBot(seat), current: room.turn?.seat === i, away: isHuman(seat) && !online(seat.id) };
        if (started && !finished && i === me) player.note = `+${privateOf(room, i)} secret`;
        return [player];
      }),
      rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: false,
      provisional: !finished,
    },
    winners: room.winners,
    limits: { sizes: SIZES, rounds: ROUNDS },
    log: room.log.slice(-14),
  };
  if (room.phase === 'windows') {
    view.options = me === -1 ? [] : room.options[me].map((pid) => {
      const { name, difficulty, rows } = patternOf(pid);
      return { pid, name, difficulty, rows };
    });
    view.chosen = me === -1 ? null : room.picked[me];
  }
  if (room.phase === 'windows' && room.privateColours.length) {
    // Dealt before the windows: the viewer's own private objective (nobody else's) and the table's public cards.
    view.tools = room.tools.map((id, i) => ({ id, ...pickToolText(id), spent: room.spent[i], cost: toolCost(room, i) }));
    view.publicObjectives = room.publicIds.map((id) => ({ ...publicText(id), mine: null }));
    view.privateObjective = me === -1 ? null : { colour: room.privateColours[me], points: 0 };
    view.badPrivate = room.settings.badPrivate;
  }
  if (started) {
    view.round = room.round;
    view.first = room.first;
    view.order = room.order;
    view.turnIndex = room.turnIndex;
    view.turn = room.turn ? { ...room.turn, allowed: allowedPlacements(room), canUndo: Boolean(room.undo) && room.undo.seat === room.turn.seat && turnChanged(room) } : null;
    view.pool = room.pool;
    view.track = room.track;
    view.bagCount = room.bag.length;
    view.tools = room.tools.map((id, i) => {
      const { name, text, how } = toolOf(id);
      return { id, name, text, how, spent: room.spent[i], cost: toolCost(room, i) };
    });
    view.publicObjectives = room.publicIds.map((id) => {
      const { name, text, points, unit } = objectiveOf(id);
      return { id, name, text, points, unit, mine: me === -1 ? null : objectivePoints(id, room.grids[me]) };
    });
    view.privateObjective = me === -1 || finished ? null : { colour: room.privateColours[me], points: privateOf(room, me) };
    view.badPrivate = room.settings.badPrivate;
    view.final = finished ? room.final : null;
  }
  return view;
}

export { BAD_PRIVATE_POINTS, CELLS, OBJECTIVES, privatePoints };
