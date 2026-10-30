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
import { placements, winnersOf } from '../../shared/scores.js';
import { extrasOf } from '../../shared/tally.js';
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
  emptyLines,
  emptyWall,
  factoryCount,
  floorPenalty,
  lineCapacity,
  lineProblem,
  rowComplete,
  tileScore,
  tilesText,
} from './rules.js';

export { MAX_PLAYERS, MIN_PLAYERS, factoryCount };
export const SIZES = [2, 3, 4, 5];
export const DEFAULT_SIZE = 4;
export const DEFAULT_SETTINGS = { freeWall: false };
export { STAT_KEYS };
export const BOT_NAMES = ['Isabel', 'Tomas', 'Beatriz', 'Duarte', 'Ines', 'Rui', 'Carmo', 'Vasco', 'Leonor', 'Nuno'];

const LIVE = ['lobby', 'playing', 'tiling'];
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

/** In-place Fisher-Yates shuffle. */
export function shuffle(items, rng = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** A new bag: 20 tiles of each colour, in a random order. */
export function makeBag(rng = Math.random) {
  const tiles = [];
  for (const colour of COLOURS) for (let n = 0; n < PER_COLOUR; n++) tiles.push(colour);
  return shuffle(tiles, rng);
}

// ---- creating a room ----

export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  if (isObject(input) && input.freeWall !== undefined) {
    if (typeof input.freeWall !== 'boolean') return fail('The free wall option must be on or off.');
    next.freeWall = input.freeWall;
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
  const midGame = room.phase === 'playing' || room.phase === 'tiling';
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

// ---- starting ----

export function start(room, userId, rng = Math.random) {
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
  const botSeats = room.seats.flatMap((s, i) => (isBot(s) ? [i] : []));
  const picked = assignAIs(AIS, botSeats, rng);
  for (const i of botSeats) room.seats[i].ai = picked[i];
  return ok();
}

/** Draws one tile blindly; when the bag is empty the lid is shuffled into it. Undefined when both are empty. */
function draw(room, rng) {
  if (!room.bag.length && room.lid.length) {
    room.bag = shuffle(room.lid, rng);
    room.lid = [];
  }
  return room.bag.pop();
}

function startRound(room, rng) {
  const factories = [];
  for (let f = 0; f < factoryCount(room.size); f++) {
    const tiles = [];
    for (let i = 0; i < FACTORY_TILES; i++) {
      const tile = draw(room, rng);
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

const countOf = (tiles, colour) => tiles.reduce((n, c) => n + (c === colour ? 1 : 0), 0);
const sourceTiles = (room, source) => (source === 'centre' ? room.centre : room.factories[source]);
const validSource = (room, source) => source === 'centre' || (isInt(source) && source >= 0 && source < room.factories.length);
const sourceName = (source) => (source === 'centre' ? 'the centre' : `factory ${source + 1}`);

/** True when the take from this source would also take the first-player marker. */
export const takesMarker = (room, source) => source === 'centre' && room.markerInCentre;

/** Every move the seat could make: { source, colour, line } with line 0..4 or 'floor'. */
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

const roundOver = (room) => room.centre.length === 0 && room.factories.every((f) => f.length === 0);

export function takeTiles(room, seat, args, rng = Math.random) {
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

function startTiling(room, rng) {
  room.phase = 'tiling';
  room.turn = null;
  room.tiling = room.seats.map(() => ({ cursor: 0, placed: [], gained: 0, newRows: 0, dropped: [] }));
  room.pending = room.seats.map(() => null);
  for (let seat = 0; seat < room.size; seat++) advanceTiling(room, seat);
  settleTiling(room, rng);
}

/** Puts the rightmost tile of a full line on the wall, scores it, and discards the rest of the line. */
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

/** Works down a player's pattern lines; stops at a line that needs the player to choose a column (free wall). */
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

/** A player picks the column for the tile their line has just completed (free wall only). */
export function chooseColumn(room, seat, args, rng = Math.random) {
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

function settleTiling(room, rng) {
  if (room.pending.some(Boolean)) return;
  finishTiling(room, rng);
}

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
    room.tally[seat].floorPenalties += lost;
    deltas[seat] = after - before;
    const parts = [];
    if (penalty) parts.push(`floor -${lost}`);
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
  return room.seats.flatMap((seat, i) =>
    isHuman(seat)
      ? [
          {
            userId: seat.id,
            outcome: room.winners.includes(i) ? 'win' : 'loss',
            placement: room.final.players[i].placement,
            score: room.final.players[i].total,
            extras: {
              ...extrasOf(room.tally[i], STAT_KEYS),
              rowsCompleted: completeRows(room.walls[i]),
              columnsCompleted: completeColumns(room.walls[i]),
              colourSetsCompleted: completeSets(room.walls[i]),
              bottomRows: rowComplete(room.walls[i], SIZE - 1) ? 1 : 0,
              gridsFilled: completeRows(room.walls[i]) === SIZE ? 1 : 0, // every row done in the same round
              wallTiles: room.walls[i].flat().filter((tile) => tile !== null).length,
              roundsPlayed: room.playedRounds,
            },
          },
        ]
      : [],
  );
}

// ---- what each player may see ----

/** Every tile in every place, by colour: used by the tests (tile conservation) and nothing else. */
export function tileCount(room) {
  const lines = room.lines.flat().reduce((n, l) => n + l.count, 0);
  const walls = room.walls.flat(2).filter((c) => c !== null).length;
  const floors = room.floors.flat().filter((c) => c !== MARKER).length;
  return room.bag.length + room.lid.length + room.factories.flat().length + room.centre.length + lines + walls + floors;
}

const lidCounts = (room) => COLOURS.map((colour) => countOf(room.lid, colour));

/** Everything one account may know: the whole table (all of it is public) but never the bag's contents or order. */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const started = room.phase === 'playing' || room.phase === 'tiling' || room.phase === 'finished';
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
            ...(isBot(seat) && started ? { ai: { id: aiOf(room, i).id, name: aiOf(room, i).name } } : {}),
            online: isBot(seat) || online(seat.id),
            score: started ? room.scores[i] : 0,
            lines: started ? room.lines[i] : null,
            wall: started ? room.walls[i] : null,
            floor: started ? room.floors[i] : null,
            penalty: started ? floorPenalty(room.floors[i]) : 0,
          }
        : null,
    ),
    scoreboard: {
      players: room.seats.flatMap((seat, i) => (seat ? [{ id: i, name: seat.name, userId: isHuman(seat) ? seat.id : undefined, score: started ? room.scores[i] : 0, isMe: i === me, bot: isBot(seat), current: room.phase === 'playing' && room.turn === i, away: isHuman(seat) && !online(seat.id) }] : [])),
      rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: false,
    },
    winners: room.winners,
    limits: { sizes: SIZES, tiles: TILES },
    log: room.log.slice(-14),
  };
  if (started) {
    view.round = room.round;
    view.first = room.first;
    view.turn = room.turn;
    view.factories = room.factories;
    view.centre = room.centre;
    view.markerInCentre = room.markerInCentre;
    view.bagCount = room.bag.length;
    view.lid = lidCounts(room);
    view.lastTiling = room.lastTiling;
    view.choosing = room.phase === 'tiling' ? room.pending.flatMap((p, i) => (p ? [i] : [])) : [];
    view.choice = room.phase === 'tiling' && me !== -1 ? room.pending[me] : null;
    view.final = finished ? room.final : null;
  }
  return view;
}
