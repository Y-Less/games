// The rules of a Rummikub room, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }; an error never names hidden information.
//
// Seats 0..size-1 run clockwise. A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer player
// ({ kind: 'bot', id: 'bot:<n>', name }) or null (empty, lobby only).
//
// Every tile is an integer id (see rules.js) and is in exactly one place: the pool (face down, order secret), a rack
// (hidden from the other players) or a set on the table. `racks[seat]` and `pool` are the only secrets.
//
// A round: everybody is dealt tiles; on their turn a player either plays (sends the whole table as they want it, which
// is checked by rules.checkPlay) or draws one tile (a pass once the pool is empty). The round ends when someone empties
// their rack, or when the pool is empty and everyone has passed in a row. A game is `settings.rounds` rounds.
import { assignAIs, describeAI, pickAI, aiById } from '../../shared/ai.js';
import { placements, winnersOf } from '../../shared/scores.js';
import { AIS } from './ai/index.js';
import {
  DEFAULT_SETTINGS,
  JOKER_VALUE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  LIMITS,
  checkPlay,
  dealSize,
  isJoker,
  normaliseSettings as normaliseRuleSettings,
  rackValue,
  startProblem,
  tileName,
  totalTiles,
} from './rules.js';

export { DEFAULT_SETTINGS, MAX_PLAYERS, MIN_PLAYERS };
export const SIZES = [2, 3, 4, 5, 6];
export const DEFAULT_SIZE = 4;
export const STAT_KEYS = ['roundsWon', 'roundsPlayed', 'tilesPlayed', 'jokersPlayed', 'biggestTurn'];
export const BOT_NAMES = ['Mabel', 'Hugo', 'Ivy', 'Otto', 'Nell', 'Felix', 'Dora', 'Ezra'];

const LIVE = ['lobby', 'playing', 'between'];
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
export const inRound = (room) => room.phase === 'playing' || room.phase === 'between';

/** In-place Fisher-Yates shuffle. */
export function shuffle(items, rng = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ---- creating a room ----

export const normaliseSettings = (input, current = DEFAULT_SETTINGS) => normaliseRuleSettings(input, current);

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
    pool: [],
    racks: Array.from({ length: n }, () => []),
    table: [],
    melded: Array(n).fill(false),
    idle: 0,
    moves: 0,
    lastPlay: null,
    deadline: null,
    ready: [],
    scores: Array(n).fill(0),
    round: 0,
    first: 0,
    turn: null,
    history: [],
    lastRound: null,
    log: [],
    tally: Array.from({ length: n }, () => ({ roundsWon: 0, tilesPlayed: 0, jokersPlayed: 0, biggestTurn: 0 })),
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

function newBot(room, rng) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
  const base = BOT_NAMES.find((n) => !used.has(n)) ?? 'Computer';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
  const bot = { kind: 'bot', id: `bot:${room.nextBot++}`, name };
  if (rng) bot.ai = pickAI(AIS, rng).id; // a computer joining mid-game picks its logic now; lobby ones pick when the game starts
  return bot;
}

/**
 * Removes a human. Before the game starts (or after it ends) the seat is freed; mid-game a computer player takes
 * it over, keeping the rack. `empty` is true when no human is left, so the room should be discarded.
 */
export function removeHuman(room, userId, rng = Math.random) {
  const seat = seatOf(room, userId);
  if (seat === -1) return fail('You are not in this game.');
  const midGame = inRound(room);
  room.seats[seat] = midGame ? newBot(room, rng) : null;
  if (midGame) addLog(room, seat, `${room.seats[seat].name} takes over from a player who left`);
  const humans = humanSeats(room);
  if (!humans.length) return ok({ empty: true, seat });
  if (room.hostId === userId) room.hostId = room.seats[humans[0]].id;
  if (room.phase === 'between') advanceIfReady(room, rng);
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

/** The host chooses how many seats there are (2-6). People and computer players are kept, in order. */
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

/** The host removes another person from a lobby seat. */
export function kick(room, hostId, seat) {
  const problem = hostInLobby(room, hostId);
  if (problem) return problem;
  const target = isInt(seat) ? room.seats[seat] : null;
  if (!isHuman(target) || target.id === hostId) return fail('There is no one else in that seat.');
  room.seats[seat] = null;
  return ok({ userId: target.id });
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

export function start(room, userId, rng = Math.random, now = Date.now()) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('Every seat needs a player. Add computer players to fill the empty ones.');
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  const tooSmall = startProblem(room.settings, room.size);
  if (tooSmall) return fail(tooSmall);
  resetGame(room);
  room.first = Math.floor(rng() * room.size);
  room.phase = 'playing';
  const s = room.settings;
  addLog(room, null, `The game begins: ${s.rounds} ${s.rounds === 1 ? 'round' : 'rounds'}, ${totalTiles(s)} tiles.`);
  startRound(room, rng, now);
  // every computer player chooses its logic for the whole game (after the deal, so the deal does not depend on it)
  const botSeats = room.seats.flatMap((seat, i) => (isBot(seat) ? [i] : []));
  const chosen = assignAIs(AIS, botSeats, rng);
  for (const i of botSeats) room.seats[i].ai = chosen[i];
  return ok();
}

function setDeadline(room, now) {
  room.deadline = room.settings.timer > 0 ? now + room.settings.timer * 1000 : null;
}

function startRound(room, rng, now) {
  const s = room.settings;
  const tiles = shuffle(Array.from({ length: totalTiles(s) }, (_, i) => i), rng);
  const hand = dealSize(s, room.size);
  room.racks = room.seats.map(() => tiles.splice(0, hand).sort((a, b) => a - b));
  room.pool = tiles;
  room.table = [];
  room.melded = Array(room.size).fill(false);
  room.idle = 0;
  room.lastPlay = null;
  room.ready = [];
  room.round++;
  room.turn = room.first;
  room.phase = 'playing';
  room.moves++;
  setDeadline(room, now);
  addLog(room, null, `Round ${room.round}: ${seatName(room, room.first)} plays first. ${hand} tiles each, ${room.pool.length} in the pool.`);
}

// ---- playing ----

function nextTurn(room, now) {
  room.turn = (room.turn + 1) % room.size;
  room.moves++;
  setDeadline(room, now);
}

/** The whole turn in one request: `table` is every set as the player wants the table to be. */
export function play(room, seat, args, now = Date.now()) {
  if (room.phase !== 'playing') return fail('The game is not being played.');
  if (room.turn !== seat) return fail('It is not your turn.');
  const { table } = isObject(args) ? args : {};
  const result = checkPlay(room.settings, {
    before: room.table,
    rack: room.racks[seat],
    proposed: table,
    melded: room.melded[seat],
    meld: room.settings.meld,
  });
  if (!result.ok) return fail(result.error);
  const added = new Set(result.added);
  room.table = result.sets;
  room.racks[seat] = room.racks[seat].filter((id) => !added.has(id));
  const jokers = result.added.filter((id) => isJoker(room.settings, id)).length;
  const tally = room.tally[seat];
  tally.tilesPlayed += result.added.length;
  tally.jokersPlayed += jokers;
  tally.biggestTurn = Math.max(tally.biggestTurn, result.added.length);
  const first = !room.melded[seat];
  room.melded[seat] = true;
  room.idle = 0;
  room.lastPlay = { seat, ids: [...result.added] };
  addLog(room, seat, `${seatName(room, seat)} ${first ? 'melded' : 'played'} ${result.added.length} ${result.added.length === 1 ? 'tile' : 'tiles'}${first ? ` (${result.points} points)` : ''}`);
  if (!room.racks[seat].length) return finishRound(room, 'out', [seat], now);
  nextTurn(room, now);
  return ok({ added: result.added.length });
}

/** Draws one tile and ends the turn. With the pool empty it is a pass. */
export function draw(room, seat, now = Date.now(), reason = '') {
  if (room.phase !== 'playing') return fail('The game is not being played.');
  if (room.turn !== seat) return fail('It is not your turn.');
  if (room.pool.length) {
    const tile = room.pool.pop();
    room.racks[seat].push(tile);
    room.racks[seat].sort((a, b) => a - b);
    room.idle = 0;
    addLog(room, seat, `${seatName(room, seat)} drew a tile${reason}`);
  } else {
    room.idle++;
    addLog(room, seat, `${seatName(room, seat)} passed${reason}`);
  }
  room.lastPlay = null;
  if (!room.pool.length && room.idle >= room.size) return finishRound(room, 'blocked', null, now);
  nextTurn(room, now);
  return ok();
}

/** The turn timer ran out: the player draws (or passes). Does nothing before the deadline. */
export function timeout(room, now = Date.now()) {
  if (room.phase !== 'playing' || room.deadline === null || now < room.deadline) return fail('There is no time limit to enforce.');
  return draw(room, room.turn, now, ' (out of time)');
}

// ---- the end of a round and of the game ----

/**
 * Scores the round. Whoever has the lowest rack total wins it (nobody else can have an empty rack, so the player who goes
 * out, with 0, always wins). Every other player loses what their rack is worth beyond the winner's; the winner collects
 * all of that. Tied winners (a blocked game) share it, rounded down. When someone goes out this is exactly "the winner
 * gains the total of the other racks, each other player loses their own".
 */
function finishRound(room, reason, winnersIn, now) {
  const s = room.settings;
  const totals = room.racks.map((rack) => rackValue(s, rack));
  const best = Math.min(...totals);
  const winners = winnersIn ?? totals.flatMap((t, i) => (t === best ? [i] : []));
  const deltas = {};
  const notes = {};
  let pot = 0;
  for (let i = 0; i < room.size; i++) {
    if (winners.includes(i)) continue;
    const lost = totals[i] - best;
    deltas[i] = -lost;
    pot += lost;
    notes[i] = `${room.racks[i].length} ${room.racks[i].length === 1 ? 'tile' : 'tiles'} left (${totals[i]})`;
  }
  const share = Math.floor(pot / winners.length);
  for (const w of winners) {
    deltas[w] = share;
    notes[w] = reason === 'out' ? 'went out' : `lowest rack (${totals[w]})`;
    room.tally[w].roundsWon++;
  }
  for (let i = 0; i < room.size; i++) room.scores[i] += deltas[i];
  room.history.push({ label: `Round ${room.round}`, deltas, notes });
  room.lastRound = { round: room.round, reason, winners, racks: room.racks.map((r) => [...r]), totals, deltas };
  addLog(room, null, reason === 'out' ? `${seatName(room, winners[0])} went out and wins round ${room.round}.` : `Nobody can move. ${winners.map((w) => seatName(room, w)).join(' and ')} ${winners.length > 1 ? 'share' : 'wins'} round ${room.round} with the lowest rack.`);
  room.turn = null;
  room.deadline = null;
  room.lastPlay = null;
  room.moves++;
  if (room.round >= s.rounds) return finishGame(room);
  room.phase = 'between';
  room.ready = [];
  return ok({ roundOver: true });
}

function finishGame(room) {
  const scores = Object.fromEntries(room.scores.map((score, i) => [i, score]));
  const place = placements(scores);
  room.winners = winnersOf(scores).map(Number).sort((a, b) => a - b);
  room.final = { players: room.seats.map((seat, i) => ({ seat: i, name: seat?.name ?? `Player ${i + 1}`, total: room.scores[i], placement: place[i] })) };
  room.phase = 'finished';
  addLog(room, null, `The game is over. ${room.winners.map((w) => room.final.players[w].name).join(' and ')} ${room.winners.length > 1 ? 'share the win' : 'wins'}.`);
  return ok({ roundOver: true, gameOver: true });
}

/** A person is ready for the next round; it starts when every person is. */
export function next(room, seat, rng = Math.random, now = Date.now()) {
  if (room.phase !== 'between') return fail('There is no round to start.');
  if (!isHuman(room.seats[seat])) return fail('You are not in this game.');
  if (!room.ready.includes(seat)) room.ready.push(seat);
  advanceIfReady(room, rng, now);
  return ok();
}

function advanceIfReady(room, rng = Math.random, now = Date.now()) {
  if (room.phase !== 'between') return false;
  if (!humanSeats(room).every((seat) => room.ready.includes(seat))) return false;
  startNextRound(room, rng, now);
  return true;
}

function startNextRound(room, rng, now) {
  room.first = (room.first + 1) % room.size;
  startRound(room, rng, now);
}

/** Starts the next round whether or not everyone has said they are ready (the server does this after a wait). */
export function forceNext(room, rng = Math.random, now = Date.now()) {
  if (room.phase !== 'between') return fail('There is no round to start.');
  startNextRound(room, rng, now);
  return ok();
}

export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over.');
  resetGame(room);
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
            score: room.scores[i],
            extras: {
              roundsWon: room.tally[i].roundsWon,
              roundsPlayed: room.round,
              tilesPlayed: room.tally[i].tilesPlayed,
              jokersPlayed: room.tally[i].jokersPlayed,
              biggestTurn: room.tally[i].biggestTurn,
            },
          },
        ]
      : [],
  );
}

// ---- what each player may see ----

/** Every tile in every place: used by the tests (tile conservation) and the bots. */
export function allTiles(room) {
  return [...room.pool, ...room.racks.flat(), ...room.table.flat()];
}

export const tileCount = (room) => allTiles(room).length;

/** Everything one account may know: the table, the counts, its own rack - never the pool's order or another rack. */
export function viewFor(room, userId, { online = () => true, now = Date.now() } = {}) {
  const me = seatOf(room, userId);
  const started = room.phase === 'playing' || room.phase === 'between' || room.phase === 'finished';
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
            ...(isBot(seat) && room.phase !== 'lobby' ? { ai: describeAI(aiById(AIS, seat.ai)) } : {}),
            online: isBot(seat) || online(seat.id),
            score: started ? room.scores[i] : 0,
            count: started ? room.racks[i].length : 0,
            melded: started ? room.melded[i] : false,
            ready: room.phase === 'between' && room.ready.includes(i),
          }
        : null,
    ),
    scoreboard: {
      players: room.seats.flatMap((seat, i) => (seat ? [{ id: i, name: seat.name, score: started ? room.scores[i] : 0, isMe: i === me, bot: isBot(seat), current: room.phase === 'playing' && room.turn === i, away: isHuman(seat) && !online(seat.id) }] : [])),
      rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: false,
    },
    winners: room.winners,
    limits: { sizes: SIZES, ...LIMITS },
    deal: { total: totalTiles(room.settings), hand: dealSize(room.settings, room.size), jokerValue: JOKER_VALUE },
    log: room.log.slice(-14),
  };
  if (started) {
    view.round = room.round;
    view.first = room.first;
    view.turn = room.turn;
    view.version = room.moves;
    view.table = room.table;
    view.poolCount = room.pool.length;
    view.rack = me === -1 ? [] : room.racks[me];
    view.lastPlay = room.lastPlay;
    view.remaining = room.deadline === null || room.phase !== 'playing' ? null : Math.max(0, room.deadline - now);
    view.lastRound = room.lastRound;
    view.final = finished ? room.final : null;
  }
  return view;
}

export { tileName };
