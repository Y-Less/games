// The rules of Azulejo, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }; an error never names hidden information.
//
// Seats 0..size-1 run clockwise. A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer player
// ({ kind: 'bot', id: 'bot:<n>', name, ai: <id of its AI, set when the game starts> }) or null (empty, lobby only).
//
// Tiles are colour numbers 0..4 (see rules.js). Every one of the 100 tiles is in exactly one place: the bag, the lid
// (the discards), a factory display, the centre, a pattern line, a wall or a floor line. The bag's contents and order
// are the only secret, and they never leave the server.
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { addMove, recentMoves } from '../../shared/moveLog.js';
import { placements, seatScoreboardEntry, winnersOf } from '../../shared/scores.js';
import { asHost, botSeats, createSeatRules, fail, hasPlayer, hostInLobby, humanSeats, isBot, isHuman, ok, seatOf } from '../../shared/seats.js';
import { bump, extrasOf, statsRows } from '../../shared/tally.js';
import { AIS } from './ai/index.js';
import { newTally, STAT_KEYS, tallyTake } from './tally.js';
import {
  COLOUR_NAMES,
  COLOURS,
  FACTORY_TILES,
  FLOOR_SLOTS,
  MARKER,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PER_COLOUR,
  SIZE,
  TILES,
  bonuses,
  columnsFor,
  completeColumns,
  completeRows,
  completeSets,
  countOf,
  emptyLines,
  emptyWall,
  factoryCount,
  floorPenalty,
  lineCapacity,
  lineProblem,
  rowComplete,
  sourceTiles,
  takesMarker,
  tileScore,
  tilesText,
} from './rules.js';

export { MAX_PLAYERS, MIN_PLAYERS, factoryCount, takesMarker };
// The seat vocabulary the server, the AIs and the tests import from here: it is the shared one (shared/seats.js).
export { hasPlayer, humanSeats, isBot, isHuman, seatOf };
export const SIZES = [2, 3, 4, 5];
export const DEFAULT_SIZE = 4;
export const DEFAULT_SETTINGS = { freeWall: false };
export { STAT_KEYS };
export const BOT_NAMES = ['Isabel', 'Tomas', 'Beatriz', 'Duarte', 'Ines', 'Rui', 'Carmo', 'Vasco', 'Leonor', 'Nuno'];

const LIVE = ['lobby', 'playing', 'tiling'];
/** Is this a plain object (not null, not an array)? Payloads from clients are checked with it. */
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInt = Number.isInteger;

/** Is the game still going (in the lobby, being played or being tiled)? Finished games are kept for less time. */
export const isLive = (room) => LIVE.includes(room.phase);
/** The name to show for a seat in the log ("Someone" for an empty seat). */
export const seatName = (room, seat) => room.seats[seat]?.name ?? 'Someone';

/**
 * In-place Fisher-Yates shuffle.
 *
 * @param {any[]} items  the list to shuffle (mutated and returned)
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {any[]} the same list
 */
export function shuffle(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * A new bag: 20 tiles of each colour, in a random order.
 *
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {number[]} the 100 colour numbers
 */
export function makeBag(rng) {
  const tiles = [];
  for (const colour of COLOURS) for (let n = 0; n < PER_COLOUR; n++) tiles.push(colour);
  return shuffle(tiles, rng);
}

// ---- creating a room ----

/**
 * Checks a settings message and merges it into the current settings.
 *
 * @param {any} input  what the client sent (anything; only a boolean `freeWall` is read)
 * @param {{ freeWall: boolean }} [current]  the settings to start from
 * @returns {{ ok: true, settings: object } | { ok: false, error: string }} a new settings object; `current` is not changed
 */
export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  if (isObject(input) && input.freeWall !== undefined) {
    if (typeof input.freeWall !== 'boolean') return fail('The free wall option must be on or off.');
    next.freeWall = input.freeWall;
  }
  return ok({ settings: next });
}

/**
 * Makes a new room in the lobby with the host in seat 0.
 *
 * @param {object} args
 * @param {string} args.code  the invite code
 * @param {number} args.hostId  the host's account id
 * @param {string} args.hostName  the host's display name
 * @param {number} [args.size]  seats at the table (one of SIZES)
 * @param {object} [args.settings]  settings to validate (see normaliseSettings)
 * @param {number} args.now  the creation time in milliseconds
 * @returns {object} the room
 * @throws {Error} if the size or the settings are invalid (the message is shown to the player)
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
 * Puts every game-related field back to its starting value (an empty table, no scores, no log), keeping the seats.
 * Side effects: mutates `room` (the lid, bag, boards, scores, tally...).
 *
 * @param {object} room
 */
function resetGame(room) {
  const n = room.size;
  Object.assign(room, {
    bag: [],
    lid: [],
    factories: [],
    centre: [],
    markerInCentre: true,
    lines: Array.from({ length: n }, emptyLines),
    walls: Array.from({ length: n }, emptyWall),
    floors: Array.from({ length: n }, () => []),
    scores: Array(n).fill(0),
    round: 0,
    playedRounds: 0,
    first: 0,
    nextFirst: null,
    turn: null,
    tiling: [],
    pending: [],
    lastTiling: null,
    history: [],
    log: [],
    tally: Array.from({ length: n }, newTally),
    final: null,
    winners: null,
    recorded: false,
  });
}

/**
 * Adds a line to the game log (the newest 60 are kept).
 * Side effects: mutates `room.log`.
 *
 * @param {object} room
 * @param {number | null} seat  the seat the line is about, or null for the table as a whole
 * @param {string} text
 */
const addLog = (room, seat, text) => addMove(room, { seat, text });

// ---- seats and settings ----

/**
 * The AI a computer seat plays with (rooms saved before AIs existed fall back to the first).
 *
 * @param {object} room
 * @param {number} seat
 * @returns {object} an AI from ./ai/index.js
 */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat]?.ai);

/**
 * The seat rules (join, leave, kick, computer players) are the shared ones. In Azulejo a person who leaves while the game
 * is being played (or tiled) is replaced by a computer player that picks its AI straight away (lobby computer players get
 * theirs when the game starts), and the log says so. Nothing else has to happen after somebody leaves.
 */
const seats = createSeatRules({
  isMidGame: (room) => room.phase === 'playing' || room.phase === 'tiling',
  botNames: BOT_NAMES,
  /**
   * Turns the shared computer player into the one that replaces a person who left.
   * Side effects: mutates `room` (adds a log line); uses `rng` once to pick the AI.
   *
   * @param {object} room
   * @param {object} bot  the new computer player from the shared newBot (not yet seated)
   * @param {number} seat  the seat it will take
   * @param {() => number} rng  random numbers in [0, 1)
   * @returns {object} the seat object to store
   */
  takeOver: (room, bot, seat, rng) => {
    addLog(room, seat, `${bot.name} takes over from a player who left`);
    return { ...bot, ai: pickAI(AIS, rng).id };
  },
});
export const { addHuman, addBot, removeBot, fillWithBots, kick, removeHuman } = seats;

/**
 * The host changes the settings (lobby only).
 * Side effects: mutates `room.settings`.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {any} input  the settings message (see normaliseSettings)
 * @returns {{ ok: boolean, error?: string }}
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
 * The host chooses how many seats there are (2-5). People and computer players are kept, in order.
 * Side effects: mutates `room` (the seats and the whole game state are reset).
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host, in the lobby)
 * @param {number} size  one of SIZES
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

// ---- starting ----

/**
 * The host starts the game: shuffles the bag, picks who goes first, deals the first round and gives each computer
 * player its AI. Needs every seat filled and at least one person.
 * Side effects: mutates `room` (phase, bag, factories, log, the computer seats' `ai`).
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host, in the lobby)
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {{ ok: boolean, error?: string }}
 */
export function start(room, userId, rng) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('Every seat needs a player. Add computer players to fill the empty ones.');
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  room.bag = makeBag(rng);
  room.first = Math.floor(rng() * room.size);
  room.phase = 'playing';
  addLog(room, null, `The game begins. ${seatName(room, room.first)} goes first.`);
  startRound(room, rng);
  // Each computer player gets one AI for the whole game (picked last, so it does not change the deal).
  const bots = botSeats(room);
  const picked = assignAIs(AIS, bots, rng);
  for (const i of bots) room.seats[i].ai = picked[i];
  return ok();
}

/**
 * Draws one tile blindly from the bag; when the bag is empty the lid is shuffled into it. (Named for the bag because a
 * "draw" elsewhere in the platform, such as Rummikub's, is a public action.)
 * Side effects: mutates `room.bag` and, when it refills, `room.lid`.
 *
 * @param {object} room
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {number | undefined} a colour, or undefined when both bag and lid are empty
 */
function drawFromBag(room, rng) {
  if (!room.bag.length && room.lid.length) {
    room.bag = shuffle(room.lid, rng);
    room.lid = [];
  }
  return room.bag.pop();
}

/**
 * Starts a round: fills every factory display from the bag and makes the first player's turn. If there are no tiles at all
 * (every one is on a board) the game ends instead.
 * Side effects: mutates `room` (round, factories, centre, marker, turn, log; may finish the game).
 *
 * @param {object} room
 * @param {() => number} rng  random numbers in [0, 1) (for refilling the bag from the lid)
 */
function startRound(room, rng) {
  const factories = [];
  for (let f = 0; f < factoryCount(room.size); f++) {
    const tiles = [];
    for (let i = 0; i < FACTORY_TILES; i++) {
      const tile = drawFromBag(room, rng);
      if (tile !== undefined) tiles.push(tile);
    }
    factories.push(tiles);
  }
  // If there is nothing at all to play with (every tile is on a board), the game cannot go on.
  if (factories.every((f) => !f.length)) return finishGame(room);
  room.round++;
  room.factories = factories;
  room.centre = [];
  room.markerInCentre = true;
  room.nextFirst = null;
  room.turn = room.first;
  addLog(room, null, `Round ${room.round}: ${seatName(room, room.first)} is the first player.`);
}

// ---- taking and placing ----

/** Is this a source a player may take from: the centre, or the index of a factory that exists? */
const validSource = (room, source) => source === 'centre' || (isInt(source) && source >= 0 && source < room.factories.length);
/** The name of a source for the log and for error messages. */
const sourceName = (source) => (source === 'centre' ? 'the centre' : `factory ${source + 1}`);

/**
 * Every move the seat could make.
 *
 * @param {object} room  (not changed)
 * @param {number} seat
 * @returns {{ source: 'centre' | number, colour: number, line: number | 'floor' }[]} empty unless it is this seat's turn
 */
export function legalMoves(room, seat) {
  const moves = [];
  if (room.phase !== 'playing' || room.turn !== seat) return moves;
  const free = room.settings.freeWall;
  const sources = ['centre', ...room.factories.keys()];
  for (const source of sources) {
    const tiles = sourceTiles(room, source);
    for (const colour of new Set(tiles)) {
      for (let line = 0; line < SIZE; line++) if (lineProblem(room.lines[seat], room.walls[seat], line, colour, free) === null) moves.push({ source, colour, line });
      moves.push({ source, colour, line: 'floor' });
    }
  }
  return moves;
}

/** Has every tile been taken from the factories and the centre? Then the round is over and the walls are tiled. */
const roundOver = (room) => room.centre.length === 0 && room.factories.every((f) => f.length === 0);

/**
 * A player takes every tile of one colour from a factory display or the centre and puts them on a pattern line (or the
 * floor). The rest of a factory slides into the centre; taking from the centre first also takes the first-player marker.
 * Tiles that do not fit on the line fall to the floor, and past the floor's seventh slot go to the lid. When the last tile
 * is taken, the walls are tiled (see startTiling); otherwise the turn passes clockwise.
 * Side effects: mutates `room` (sources, lines, floor, lid, tally, log, turn; may start tiling and the next round).
 *
 * @param {object} room
 * @param {number} seat  the seat taking
 * @param {{ source: 'centre' | number, colour: number, line: number | 'floor' }} args  the move, from the client (checked here)
 * @param {() => number} rng  random numbers in [0, 1) (used if the round ends and the bag has to be refilled)
 * @returns {{ ok: boolean, error?: string }} an error never names hidden information
 */
export function takeTiles(room, seat, args, rng) {
  if (room.phase !== 'playing') return fail('The game is not being played.');
  if (room.turn !== seat) return fail('It is not your turn.');
  const { source, colour, line } = isObject(args) ? args : {};
  if (!validSource(room, source)) return fail('Choose a factory display or the centre.');
  if (!isInt(colour) || colour < 0 || colour >= COLOURS.length) return fail('Choose a colour.');
  const tiles = sourceTiles(room, source);
  const count = countOf(tiles, colour);
  if (!count) return fail(`There is no ${COLOUR_NAMES[colour]} in ${sourceName(source)}.`);
  if (line !== 'floor') {
    const problem = lineProblem(room.lines[seat], room.walls[seat], line, colour, room.settings.freeWall);
    if (problem) return fail(problem);
  }

  // Take them: the rest of a factory slides into the centre.
  if (source === 'centre') room.centre = room.centre.filter((c) => c !== colour);
  else {
    room.centre.push(...tiles.filter((c) => c !== colour));
    room.factories[source] = [];
  }
  const floor = room.floors[seat];
  const floorBefore = floor.length;
  const marker = takesMarker(room, source);
  if (marker) {
    room.markerInCentre = false;
    room.nextFirst = seat;
    if (floor.length < FLOOR_SLOTS) floor.push(MARKER);
  }
  let overflow = count;
  if (line !== 'floor') {
    const put = Math.min(count, lineCapacity(line) - room.lines[seat][line].count);
    room.lines[seat][line] = { colour, count: room.lines[seat][line].count + put };
    overflow = count - put;
  }
  for (let i = 0; i < overflow; i++) {
    if (floor.length < FLOOR_SLOTS) floor.push(colour);
    else room.lid.push(colour);
  }
  const placed = count - overflow;
  tallyTake(room.tally[seat], { taken: count, dropped: overflow + (marker ? 1 : 0), floorBefore, floorAfter: floor.length });
  const result = line === 'floor' ? 'all to the floor' : `${placed} on line ${line + 1}${overflow ? `, ${overflow} to the floor` : ''}`;
  addLog(room, seat, `${seatName(room, seat)} took ${tilesText(count, colour)} from ${sourceName(source)}${marker ? ' and the first-player marker' : ''}: ${result}`);

  if (roundOver(room)) startTiling(room, rng);
  else room.turn = (seat + 1) % room.size;
  return ok();
}

// ---- the wall-tiling phase ----

/**
 * Begins the wall-tiling phase after the last take of a round: every seat's full lines are tiled as far as they can be
 * without a choice, then the phase finishes unless somebody has to pick a column (free wall).
 * Side effects: mutates `room` (phase, turn, tiling and pending state, boards).
 *
 * @param {object} room
 * @param {() => number} rng  random numbers in [0, 1) (for the next round, if tiling finishes at once)
 */
function startTiling(room, rng) {
  room.phase = 'tiling';
  room.turn = null;
  room.tiling = room.seats.map(() => ({ cursor: 0, placed: [], gained: 0, newRows: 0, dropped: [] }));
  room.pending = room.seats.map(() => null);
  for (let seat = 0; seat < room.size; seat++) advanceTiling(room, seat);
  settleTiling(room, rng);
}

/**
 * Puts the rightmost tile of a full line on the wall, scores it, and discards the rest of the line.
 * Side effects: mutates `room` (the wall, the seat's tiling record, the lid, the pattern line).
 *
 * @param {object} room
 * @param {number} seat
 * @param {number} row  the pattern line (and wall row) being tiled
 * @param {number} col  the wall column the tile goes in
 */
function placeOnWall(room, seat, row, col) {
  const { colour, count } = room.lines[seat][row];
  const wall = room.walls[seat];
  wall[row][col] = colour;
  const points = tileScore(wall, row, col);
  const t = room.tiling[seat];
  t.gained += points;
  t.placed.push({ row, col, colour, points });
  if (rowComplete(wall, row)) t.newRows++;
  for (let i = 1; i < count; i++) room.lid.push(colour);
  room.lines[seat][row] = { colour: null, count: 0 };
}

/**
 * Works down a player's pattern lines from their cursor; stops at a line that needs the player to choose a column (free wall).
 * Side effects: mutates `room` (boards, lid, the seat's tiling record, `room.pending[seat]` when a choice is needed).
 *
 * @param {object} room
 * @param {number} seat
 */
function advanceTiling(room, seat) {
  const t = room.tiling[seat];
  const free = room.settings.freeWall;
  while (t.cursor < SIZE) {
    const row = t.cursor;
    const line = room.lines[seat][row];
    if (line.count === lineCapacity(row)) {
      const columns = columnsFor(room.walls[seat], row, line.colour, free);
      if (columns.length === 0) {
        // Only possible with a free wall: earlier tiles this phase used the last free place for this colour.
        for (let i = 0; i < line.count; i++) room.lid.push(line.colour);
        t.dropped.push({ row, colour: line.colour });
        room.lines[seat][row] = { colour: null, count: 0 };
      } else if (columns.length === 1) placeOnWall(room, seat, row, columns[0]);
      else {
        room.pending[seat] = { row, colour: line.colour, columns };
        return;
      }
    }
    t.cursor++;
  }
}

/**
 * A player picks the column for the tile their line has just completed (free wall only), then tiling carries on.
 * Side effects: mutates `room` (the wall, pending choices; may finish the round and start the next).
 *
 * @param {object} room
 * @param {number} seat  the seat choosing
 * @param {{ col: number }} args  from the client (checked here: it must be one of the highlighted columns)
 * @param {() => number} rng  random numbers in [0, 1)
 * @returns {{ ok: boolean, error?: string }}
 */
export function chooseColumn(room, seat, args, rng) {
  if (room.phase !== 'tiling') return fail('It is not time to place a tile on the wall.');
  const pending = room.pending[seat];
  if (!pending) return fail('You have nothing to place on the wall.');
  const { col } = isObject(args) ? args : {};
  if (!isInt(col) || !pending.columns.includes(col)) return fail(`Choose one of the highlighted columns in row ${pending.row + 1}.`);
  placeOnWall(room, seat, pending.row, col);
  room.pending[seat] = null;
  room.tiling[seat].cursor++;
  advanceTiling(room, seat);
  settleTiling(room, rng);
  return ok();
}

/**
 * Finishes the tiling phase once nobody has a column left to choose; until then does nothing.
 * Side effects: see finishTiling.
 *
 * @param {object} room
 * @param {() => number} rng  random numbers in [0, 1)
 */
function settleTiling(room, rng) {
  if (room.pending.some(Boolean)) return;
  finishTiling(room, rng);
}

/**
 * Ends the tiling phase: applies each seat's floor penalty (the score never drops below 0), empties the floors into the
 * lid, records the round in the history and log, then either ends the game (somebody completed a row) or starts the next
 * round with the player who took the marker first.
 * Side effects: mutates `room` (scores, tally, floors, lid, history, lastTiling, phase, log; may finish the game).
 *
 * @param {object} room
 * @param {() => number} rng  random numbers in [0, 1) (for refilling the bag at the start of the next round)
 */
function finishTiling(room, rng) {
  const deltas = {};
  const notes = {};
  const summary = [];
  for (let seat = 0; seat < room.size; seat++) {
    const t = room.tiling[seat];
    const floor = room.floors[seat];
    const before = room.scores[seat];
    const penalty = floorPenalty(floor);
    const after = Math.max(0, before + t.gained - penalty);
    const lost = before + t.gained - after;
    for (const slot of floor) if (slot !== MARKER) room.lid.push(slot);
    room.floors[seat] = [];
    room.scores[seat] = after;
    bump(room.tally[seat], 'floorPenalties', lost); // bump, not +=: a room saved before this counter existed has no key
    deltas[seat] = after - before;
    const parts = [];
    if (lost) parts.push(`floor -${lost}`); // only when points were really lost: a score already at 0 loses nothing
    if (t.newRows) parts.push(t.newRows > 1 ? `${t.newRows} rows complete` : 'row complete');
    if (t.dropped.length) parts.push('no room on the wall for a full line');
    if (parts.length) notes[seat] = parts.join(', ');
    summary.push({ seat, placed: t.placed, dropped: t.dropped, gained: t.gained, penalty, lost, before, after });
    addLog(room, seat, `${seatName(room, seat)} scored ${t.gained}${penalty ? `, then lost ${lost} to the floor` : ''}`);
  }
  room.playedRounds++;
  room.history.push({ label: `Round ${room.round}`, deltas, notes });
  room.lastTiling = { round: room.round, players: summary };
  room.tiling = [];
  room.pending = [];
  room.phase = 'playing';
  if (room.walls.some((_, seat) => completeRows(room.walls[seat]) > 0)) {
    addLog(room, null, `Round ${room.round} is over, and a row is complete.`);
    return finishGame(room);
  }
  room.first = room.nextFirst ?? room.first;
  startRound(room, rng);
}

// ---- the end ----

/**
 * Ends the game: adds each wall's end-of-game bonuses (rows, columns, colour sets), ranks the players (score, then complete
 * rows) and records the winners.
 * Side effects: mutates `room` (scores, history, final, winners, phase, turn, log).
 *
 * @param {object} room
 */
function finishGame(room) {
  const deltas = {};
  const notes = {};
  const rows = room.seats.map((seat, i) => {
    const b = bonuses(room.walls[i]);
    const before = room.scores[i];
    room.scores[i] = before + b.points;
    deltas[i] = b.points;
    const parts = [];
    if (b.rows) parts.push(`${b.rows} ${b.rows === 1 ? 'row' : 'rows'}`);
    if (b.columns) parts.push(`${b.columns} ${b.columns === 1 ? 'column' : 'columns'}`);
    if (b.sets) parts.push(`${b.sets} colour ${b.sets === 1 ? 'set' : 'sets'}`);
    notes[i] = parts.length ? parts.join(', ') : 'no bonuses';
    return { seat: i, name: seat?.name ?? `Player ${i + 1}`, before, rows: b.rows, columns: b.columns, sets: b.sets, bonus: b.points, total: room.scores[i] };
  });
  room.history.push({ label: 'Bonuses', deltas, notes });
  // Highest score, then the most complete rows; placements() orders a combined number (rows never reach 100).
  const ranking = Object.fromEntries(rows.map((r) => [r.seat, r.total * 100 + r.rows]));
  const place = placements(ranking);
  for (const row of rows) row.placement = place[row.seat];
  room.winners = winnersOf(ranking).map(Number).sort((a, b) => a - b);
  room.final = { players: rows };
  room.phase = 'finished';
  room.turn = null;
  addLog(room, null, `The game is over. ${room.winners.map((s) => rows[s].name).join(' and ')} ${room.winners.length > 1 ? 'share the win' : 'wins'}.`);
}

/**
 * The host starts a new game with the same people: the table is reset, the computer players lose their AIs (a new game
 * picks new ones) and the room goes back to the lobby.
 * Side effects: mutates `room` (everything resetGame resets, the seats' `ai`, the phase).
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
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: 'win' | 'loss', placement: number, score: number, extras: object }[]}
 */
export function statsPlayers(room) {
  return statsRows(room.seats, (seat, i) => ({
    outcome: room.winners.includes(i) ? 'win' : 'loss',
    placement: room.final.players[i].placement,
    score: room.final.players[i].total,
    extras: {
      ...extrasOf(room.tally[i], STAT_KEYS),
      rowsCompleted: completeRows(room.walls[i]),
      columnsCompleted: completeColumns(room.walls[i]),
      colourSetsCompleted: completeSets(room.walls[i]),
      bottomRows: rowComplete(room.walls[i], SIZE - 1) ? 1 : 0,
      gridsFilled: completeRows(room.walls[i]) === SIZE ? 1 : 0, // the whole wall filled: all five rows complete
      wallTiles: room.walls[i].flat().filter((tile) => tile !== null).length,
      roundsPlayed: room.playedRounds,
    },
  }));
}

// ---- what each player may see ----

/**
 * The number of tiles in every place (bag, lid, factories, centre, lines, walls, floors; not the marker). Always 100 in a
 * correct game: used by the tests (tile conservation) and nothing else.
 *
 * @param {object} room  (not changed)
 * @returns {number}
 */
export function tileCount(room) {
  const lines = room.lines.flat().reduce((n, l) => n + l.count, 0);
  const walls = room.walls.flat(2).filter((c) => c !== null).length;
  const floors = room.floors.flat().filter((c) => c !== MARKER).length;
  return room.bag.length + room.lid.length + room.factories.flat().length + room.centre.length + lines + walls + floors;
}

/** How many tiles of each colour are in the lid (shown to everyone; the lid's order is not). */
const lidCounts = (room) => COLOURS.map((colour) => countOf(room.lid, colour));

/**
 * Has the game been dealt in this phase (so that scores, walls and floors mean something)?
 *
 * @param {object} room  not changed
 * @returns {boolean}
 */
const hasStarted = (room) => room.phase === 'playing' || room.phase === 'tiling' || room.phase === 'finished';

/**
 * One occupied seat as the table shows it to everybody (the walls and floors are public).
 *
 * @param {object} room  not changed
 * @param {number} i  the seat's index
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object}
 */
function seatView(room, i, online) {
  const seat = room.seats[i];
  const started = hasStarted(room);
  return {
    seat: i,
    name: seat.name,
    bot: isBot(seat),
    ...(isBot(seat) && started ? { ai: { id: aiOf(room, i).id, name: aiOf(room, i).name } } : {}),
    online: isBot(seat) || online(seat.id),
    score: started ? room.scores[i] : 0,
    lines: started ? room.lines[i] : null,
    wall: started ? room.walls[i] : null,
    floor: started ? room.floors[i] : null,
    penalty: started ? floorPenalty(room.floors[i]) : 0,
  };
}

/**
 * The standard scoreboard (shared/scores.js): the players and the rounds scored so far.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online
 * @returns {object}
 */
function scoreboardView(room, me, online) {
  const started = hasStarted(room);
  const player = (seat, i) => seatScoreboardEntry(seat, i, { score: started ? room.scores[i] : 0, me, current: room.phase === 'playing' && room.turn === i, online });
  return {
    players: room.seats.flatMap((seat, i) => (seat ? [player(seat, i)] : [])),
    rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
    lowIsBetter: false,
  };
}

/**
 * The factories, the centre and the bag's size, and what the viewer is choosing: what a viewer may see once the game has started.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {object} fields to add to the view when the game has started
 */
function playView(room, me) {
  const tiling = room.phase === 'tiling';
  return {
    round: room.round,
    first: room.first,
    turn: room.turn,
    factories: room.factories,
    centre: room.centre,
    markerInCentre: room.markerInCentre,
    bagCount: room.bag.length,
    lid: lidCounts(room),
    lastTiling: room.lastTiling,
    choosing: tiling ? room.pending.flatMap((p, i) => (p ? [i] : [])) : [],
    choice: tiling && me !== -1 ? room.pending[me] : null,
    final: room.phase === 'finished' ? room.final : null,
  };
}

/**
 * Everything one account may know: the whole table (all of it is public) but never the bag's contents or order.
 *
 * @param {object} room  (not changed)
 * @param {number} userId  the account the view is for (may be a spectator: `you` is then -1)
 * @param {{ online?: (id: number) => boolean }} [options]  says whether a person is connected, to show who is away
 * @returns {object} plain data for the client
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
    limits: { sizes: SIZES, tiles: TILES },
    log: recentMoves(room, 14),
  };
  if (hasStarted(room)) Object.assign(view, playView(room, me));
  return view;
}
