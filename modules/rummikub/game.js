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
//
// Nothing here is a sentence: a refusal is `fail(code, params)` (a key under `errors.` in this game's locale file or the
// site's) and anything a client shows - a scoreboard round's label and notes, a log line - is a message `{ key, params }`
// from shared/messages.js, which the client puts into the player's language.
//
// Depends on rules.js (tiles, sets, checkPlay), tally.js (statistics counters), ai/index.js (the computer players' logics) and
// the shared helpers in shared/ (seats, scores, move log, tally, ai, messages). bot.js and server.js build on this file, never the reverse.
import { assignAIs, describeAI, pickAI, aiById } from '../../shared/ai.js';
import { placements, seatScoreboardEntry, winnersOf } from '../../shared/scores.js';
import { AIS } from './ai/index.js';
import {
  DEFAULT_SETTINGS,
  JOKER_VALUE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  LIMITS,
  checkPlay,
  dealSize,
  normaliseSettings,
  rackValue,
  startProblem,
  tileName,
  totalTiles,
} from './rules.js';
import { addMove, recentMoves } from '../../shared/moveLog.js';
import { msg } from '../../shared/messages.js';
import { bump, extrasOf, statsRows } from '../../shared/tally.js';
import { asHost, createSeatRules, fail, hasPlayer, hostInLobby, humanSeats, isBot, isHuman, ok, seatOf, uniqueName } from '../../shared/seats.js';
import { newTally, STAT_KEYS, tallyDraw, tallyPlay, tallyRack } from './tally.js';

export { DEFAULT_SETTINGS, MAX_PLAYERS, MIN_PLAYERS };
export const SIZES = [2, 3, 4, 5, 6];
export const DEFAULT_SIZE = 4;
export { STAT_KEYS };
export const BOT_NAMES = ['Mabel', 'Hugo', 'Ivy', 'Otto', 'Nell', 'Felix', 'Dora', 'Ezra'];

// The phases in which the game has not finished.
const LIVE = ['lobby', 'playing', 'between'];
// Whether value is a plain object (not null, not an array): guards the untrusted `args` a client sends.
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Is the game still going (lobby, a round, or between rounds)? A finished game is not live, so people may leave it. Takes the room; returns a boolean; no side effects. */
export const isLive = (room) => LIVE.includes(room.phase);
export { hasPlayer, humanSeats, isBot, isHuman, seatOf, uniqueName };
/** The name at a seat for a log line: the name, or the site's "Someone" message for an empty seat. Takes (room, seat); no side effects. */
export const seatName = (room, seat) => room.seats[seat]?.name ?? msg('common.someone');
/** Is a round under way or waiting to be followed by the next one (so a person who leaves is replaced by a computer)? Takes the room; returns a boolean; no side effects. */
export const inRound = (room) => room.phase === 'playing' || room.phase === 'between';

/**
 * Shuffles a list in place (Fisher-Yates).
 *
 * @param {any[]} items  the list; it is reordered, not copied
 * @param {() => number} rng  random numbers in [0, 1) (inject a seeded one in tests)
 * @returns {any[]} the same list, for chaining
 * Side effects: reorders `items` in place (consumes random numbers from rng).
 */
export function shuffle(items, rng) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ---- creating a room ----

// The setting limits are checked by rules.js; it is re-exported so callers need only this module.
export { normaliseSettings };

/**
 * Makes a new room in the lobby with the host in seat 0 and every other seat empty.
 *
 * @param {object} args
 * @param {string} args.code  the invite code
 * @param {number} args.hostId  the host's account id
 * @param {string} args.hostName  the host's display name
 * @param {number} [args.size]  how many seats (one of SIZES)
 * @param {object} [args.settings]  the host's rule choices (checked by normaliseSettings)
 * @param {number} args.now  the clock, in milliseconds
 * @returns {object} the room
 * @throws {Error} if the size or a setting is not allowed (a developer's message: the client never sees it)
 * Side effects: none (builds and returns a new room object).
 */
export function createRoom({ code, hostId, hostName, size = DEFAULT_SIZE, settings = {}, now }) {
  if (!SIZES.includes(size)) throw new Error(`A game is for ${MIN_PLAYERS} to ${MAX_PLAYERS} players.`);
  const normalised = normaliseSettings(settings);
  if (!normalised.ok) throw new Error(`a setting is not allowed: ${normalised.error.key}`);
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
 * Puts every per-game field back to its starting value (deck, racks, scores, tallies, log...), keeping the seats, host,
 * settings and size. Used when a room is created, resized and played again. Side effect: mutates the room.
 *
 * @param {object} room
 */
function resetGame(room) {
  const n = room.size;
  Object.assign(room, {
    pool: [],
    racks: Array.from({ length: n }, () => []),
    table: [],
    melded: Array(n).fill(false),
    drawn: Array(n).fill(null),
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
    tally: Array.from({ length: n }, newTally),
    final: null,
    winners: null,
    recorded: false,
  });
}

/**
 * Adds a line to the room's log, keeping only the latest 60. A line is `{ seat, key, params }`: a message (see
 * shared/messages.js) the client puts into the player's language. Side effect: mutates room.log.
 *
 * @param {object} room
 * @param {number | null} seat  the seat the line is about, or null for the table as a whole
 * @param {string} key  the locale key of the line, under `log.`
 * @param {object} [params]  the values the words need (a name may itself be a message)
 */
const addLog = (room, seat, key, params) => addMove(room, { seat, ...msg(key, params) });

/**
 * A refusal from the rules (rules.js returns its errors as messages under `errors.`) as the code and params a client is sent.
 *
 * @param {{ key: string, params?: object }} message  the rules' error
 * @returns {{ ok: false, error: string, params?: object }}
 * Side effects: none.
 */
const refuse = (message) => fail(message.key.slice('errors.'.length), message.params);

// ---- seats and settings ----

/**
 * The seat rules (join, leave, kick, computer players) are the shared ones (shared/seats.js). In Rummikub a person who
 * leaves during a round is replaced by a computer player that picks its AI straight away (a computer added in the lobby
 * picks when the game starts) and keeps the rack; a line in the log says so. If they were the only person the between-
 * rounds screen was waiting for, the next round starts.
 */
const seats = createSeatRules({
  isMidGame: inRound,
  botNames: BOT_NAMES,
  /** Gives the replacement computer player its AI and tells the table (mutates the room's log). */
  takeOver(room, bot, seat, rng) {
    const taken = { ...bot, ai: pickAI(AIS, rng).id };
    addLog(room, seat, 'log.takesOver', { name: taken.name });
    return taken;
  },
  /** If the person who left was the last one the between-rounds screen was waiting for, the next round starts. */
  afterRemoval(room, rng, now) {
    if (room.phase === 'between') advanceIfReady(room, rng, now);
  },
});
export const { addHuman, addBot, removeBot, fillWithBots, kick, removeHuman } = seats;

/**
 * The host changes the rule options. Lobby only.
 *
 * @param {object} room  mutated: room.settings is replaced on success
 * @param {number} userId  who is asking (must be the host)
 * @param {object} input  the options to change (the rest are kept)
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: replaces room.settings on success; nothing changes on failure.
 */
export function setSettings(room, userId, input) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  const next = normaliseSettings(input, room.settings);
  if (!next.ok) return refuse(next.error);
  room.settings = next.settings;
  return ok();
}

/**
 * The host chooses how many seats there are (2-6). People and computer players are kept, in order. Lobby only.
 *
 * @param {object} room  mutated: seats and size change and the game is reset
 * @param {number} userId  who is asking (must be the host)
 * @param {number} size  the new number of seats
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: on success changes room.size and room.seats and resets the game fields; nothing changes on failure.
 */
export function setSize(room, userId, size) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (!SIZES.includes(size)) return fail('playersRange', { min: MIN_PLAYERS, max: MAX_PLAYERS });
  const seated = room.seats.filter(Boolean);
  if (seated.length > size) return fail('removeBeforeFewerSeats');
  room.size = size;
  room.seats = [...seated, ...Array.from({ length: size - seated.length }, () => null)];
  resetGame(room);
  return ok();
}

// ---- starting ----

/**
 * The host starts the game: resets it, deals the first round and lets every computer player choose its AI.
 *
 * @param {object} room  mutated
 * @param {number} userId  who is asking (must be the host)
 * @param {() => number} rng  random numbers for the first player, the deal and the AI choices
 * @param {number} now  the clock, in milliseconds (for the turn timer)
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: on success resets the room, deals round one, sets room.phase, logs, and assigns each computer seat an AI; nothing changes on failure.
 */
export function start(room, userId, rng, now) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('seatsNeedPlayers');
  if (!humanSeats(room).length) return fail('needPerson');
  const tooSmall = startProblem(room.settings, room.size);
  if (tooSmall) return refuse(tooSmall);
  resetGame(room);
  room.first = Math.floor(rng() * room.size);
  room.phase = 'playing';
  const s = room.settings;
  addLog(room, null, 'log.begins', { count: s.rounds, tiles: totalTiles(s) });
  startRound(room, rng, now);
  // every computer player chooses its logic for the whole game (after the deal, so the deal does not depend on it)
  const botSeats = room.seats.flatMap((seat, i) => (isBot(seat) ? [i] : []));
  const chosen = assignAIs(AIS, botSeats, rng);
  for (const i of botSeats) room.seats[i].ai = chosen[i];
  return ok();
}

/**
 * Sets when the current turn runs out (null when the game has no turn timer). Side effect: mutates room.deadline.
 *
 * @param {object} room
 * @param {number} now  the clock, in milliseconds
 */
function setDeadline(room, now) {
  room.deadline = room.settings.timer > 0 ? now + room.settings.timer * 1000 : null;
}

/**
 * Deals a new round: shuffles, gives everybody their rack, clears the table and starts the first player's turn. Side
 * effect: mutates the room (including its log and move counter).
 *
 * @param {object} room
 * @param {() => number} rng  random numbers for the shuffle
 * @param {number} now  the clock, in milliseconds
 */
function startRound(room, rng, now) {
  const s = room.settings;
  const tiles = shuffle(Array.from({ length: totalTiles(s) }, (_, i) => i), rng);
  const hand = dealSize(s, room.size);
  room.racks = room.seats.map(() => tiles.splice(0, hand).sort((a, b) => a - b));
  room.pool = tiles;
  room.table = [];
  room.melded = Array(room.size).fill(false);
  room.drawn = Array(room.size).fill(null);
  room.idle = 0;
  room.lastPlay = null;
  room.ready = [];
  room.pairSeen = Array(room.size).fill(false);
  room.seats.forEach((_, seat) => noteRack(room, seat));
  room.round++;
  room.turn = room.first;
  room.phase = 'playing';
  room.moves++;
  setDeadline(room, now);
  addLog(room, null, 'log.roundStarts', { n: room.round, name: seatName(room, room.first), hand, inPool: room.pool.length });
}

// ---- playing ----

/**
 * Notes what a rack shows for the statistics (see tally.js); `pairSeen` remembers, for the round, who has held both jokers.
 *
 * @param {object} room
 * @param {number} seat  whose rack to look at
 * Side effects: updates room.tally[seat] and room.pairSeen (created here for rooms saved before it existed).
 */
function noteRack(room, seat) {
  room.pairSeen ??= Array(room.size).fill(false);
  room.pairSeen[seat] = tallyRack(room.tally[seat], room.settings, room.racks[seat], room.pairSeen[seat]);
}

/**
 * The marks of drawn tiles (which tile each seat has just drawn): games saved before they existed have none yet.
 *
 * @param {object} room
 * @returns {(number | null)[]} one entry per seat
 * Side effects: none (the room is not changed; a fresh array is returned if there is none).
 */
const withDrawn = (room) => room.drawn ?? Array(room.size).fill(null);

/**
 * Passes the turn to the next seat, clears that seat's "just drawn" mark and restarts the turn timer. Side effect:
 * mutates the room.
 *
 * @param {object} room
 * @param {number} now  the clock, in milliseconds
 */
function nextTurn(room, now) {
  room.turn = (room.turn + 1) % room.size;
  room.drawn = withDrawn(room);
  room.drawn[room.turn] = null; // a drawn tile stays marked until its owner's next turn begins
  room.moves++;
  setDeadline(room, now);
}

/**
 * The whole turn in one request: `args.table` is every set as the player wants the table to be. The proposal is judged
 * by rules.checkPlay; if it is refused nothing changes.
 *
 * @param {object} room  mutated on success (table, rack, tally, log, turn)
 * @param {number} seat  who is playing (must hold the turn)
 * @param {{ table: number[][] }} args  the proposed table
 * @param {number} now  the clock, in milliseconds
 * @returns {{ ok: boolean, added?: number, roundOver?: boolean, gameOver?: boolean, error?: string }}
 * Side effects: on success changes room.table, the rack, room.melded, room.idle, room.lastPlay, the tally and the log, then ends the turn or the round; nothing changes on failure.
 */
export function play(room, seat, args, now) {
  if (room.phase !== 'playing') return fail('notPlaying');
  if (room.turn !== seat) return fail('notYourTurn');
  const { table } = isObject(args) ? args : {};
  const result = checkPlay(room.settings, {
    before: room.table,
    rack: room.racks[seat],
    proposed: table,
    melded: room.melded[seat],
    meld: room.settings.meld,
  });
  if (!result.ok) return refuse(result.error);
  const added = new Set(result.added);
  const oldTable = room.table;
  room.table = result.sets;
  room.racks[seat] = room.racks[seat].filter((id) => !added.has(id));
  const first = !room.melded[seat];
  tallyPlay(room.tally[seat], room.settings, { added: result.added, before: oldTable, after: result.sets, firstMeld: first, wentOut: !room.racks[seat].length });
  room.melded[seat] = true;
  room.idle = 0;
  room.lastPlay = { seat, ids: [...result.added] };
  addLog(room, seat, first ? 'log.melded' : 'log.played', { name: seatName(room, seat), count: result.added.length, points: result.points });
  if (!room.racks[seat].length) return finishRound(room, 'out', [seat], now);
  nextTurn(room, now);
  return ok({ added: result.added.length });
}

/**
 * Draws one tile and ends the turn. With the pool empty it is a pass. If every player has passed in a row with the pool
 * empty, the round ends as blocked.
 *
 * @param {object} room  mutated
 * @param {number} seat  who is drawing (must hold the turn)
 * @param {number} now  the clock, in milliseconds
 * @param {boolean} [timedOut]  true when the turn timer ran out, which the log line says
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: moves a tile from the pool to the rack (or counts a pass), updates the tally, log and idle count, then ends the turn or the round.
 */
export function draw(room, seat, now, timedOut = false) {
  if (room.phase !== 'playing') return fail('notPlaying');
  if (room.turn !== seat) return fail('notYourTurn');
  if (room.pool.length) {
    const tile = room.pool.pop();
    room.racks[seat].push(tile);
    room.drawn = withDrawn(room);
    room.drawn[seat] = tile;
    room.racks[seat].sort((a, b) => a - b);
    noteRack(room, seat);
    tallyDraw(room.tally[seat]);
    room.idle = 0;
    addLog(room, seat, timedOut ? 'log.drewTimeout' : 'log.drew', { name: seatName(room, seat) });
  } else {
    room.idle++;
    addLog(room, seat, timedOut ? 'log.passedTimeout' : 'log.passed', { name: seatName(room, seat) });
  }
  room.lastPlay = null;
  if (!room.pool.length && room.idle >= room.size) return finishRound(room, 'blocked', null, now);
  nextTurn(room, now);
  return ok();
}

/**
 * The turn timer ran out: the player draws (or passes). Refused (nothing changes) before the deadline.
 *
 * @param {object} room  mutated on success
 * @param {number} now  the clock, in milliseconds
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as draw() on success; nothing changes on failure.
 */
export function timeout(room, now) {
  if (room.phase !== 'playing' || room.deadline === null || now < room.deadline) return fail('noTimeLimit');
  return draw(room, room.turn, now, true);
}

// ---- the end of a round and of the game ----

/**
 * Scores the round. Whoever has the lowest rack total wins it (nobody else can have an empty rack, so the player who goes
 * out, with 0, always wins). Every other player loses what their rack is worth beyond the winner's; the winner collects
 * all of that. Tied winners (a blocked game) share it, rounded down. When someone goes out this is exactly "the winner
 * gains the total of the other racks, each other player loses their own".
 *
 * Side effects: mutates the room (scores, history, tally, log, phase); the game ends after the last round.
 *
 * @param {object} room
 * @param {'out' | 'blocked'} reason  how the round ended
 * @param {number[] | null} winnersIn  the seat that went out, or null to find the lowest racks
 * @param {number} now  the clock, in milliseconds
 * @returns {{ ok: boolean, roundOver: boolean, gameOver?: boolean }}
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
    notes[i] = msg('notes.tilesLeft', { count: room.racks[i].length, points: totals[i] });
  }
  const share = Math.floor(pot / winners.length);
  for (const w of winners) {
    deltas[w] = share;
    notes[w] = reason === 'out' ? msg('notes.wentOut') : msg('notes.lowestRack', { points: totals[w] });
    bump(room.tally[w], 'roundsWon'); // not `++`: a room saved before this counter existed has no such key
  }
  for (let i = 0; i < room.size; i++) room.scores[i] += deltas[i];
  room.history.push({ label: msg('round', { n: room.round }), deltas, notes });
  room.lastRound = { round: room.round, reason, winners, racks: room.racks.map((r) => [...r]), totals, deltas };
  if (reason === 'out') addLog(room, null, 'log.wentOut', { name: seatName(room, winners[0]), n: room.round });
  else addLog(room, null, 'log.blocked', { names: winners.map((w) => seatName(room, w)), count: winners.length, n: room.round });
  room.turn = null;
  room.deadline = null;
  room.lastPlay = null;
  room.moves++;
  if (room.round >= s.rounds) return finishGame(room);
  room.phase = 'between';
  room.ready = [];
  return ok({ roundOver: true });
}

/**
 * Ends the game after the last round: works out the winners and placements. Side effect: mutates the room (phase becomes
 * 'finished').
 *
 * @param {object} room
 * @returns {{ ok: boolean, roundOver: boolean, gameOver: boolean }}
 */
function finishGame(room) {
  const scores = Object.fromEntries(room.scores.map((score, i) => [i, score]));
  const place = placements(scores);
  room.winners = winnersOf(scores).map(Number).sort((a, b) => a - b);
  room.final = { players: room.seats.map((seat, i) => ({ seat: i, name: seat?.name ?? `Player ${i + 1}`, total: room.scores[i], placement: place[i] })) };
  room.phase = 'finished';
  addLog(room, null, 'log.gameOver', { names: room.winners.map((w) => room.final.players[w].name), count: room.winners.length });
  return ok({ roundOver: true, gameOver: true });
}

/**
 * A person is ready for the next round; it starts when every person is.
 *
 * @param {object} room  mutated
 * @param {number} seat  the person who pressed Continue
 * @param {() => number} rng  random numbers for the deal, if the round starts
 * @param {number} now  the clock, in milliseconds
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: adds the seat to room.ready and may start the next round.
 */
export function next(room, seat, rng, now) {
  if (room.phase !== 'between') return fail('noRoundToStart');
  if (!isHuman(room.seats[seat])) return fail('notInGame');
  if (!room.ready.includes(seat)) room.ready.push(seat);
  advanceIfReady(room, rng, now);
  return ok();
}

/**
 * Starts the next round if every person is ready for it. Side effect: mutates the room when it starts one.
 *
 * @param {object} room
 * @param {() => number} rng  random numbers for the deal
 * @param {number} now  the clock, in milliseconds
 * @returns {boolean} whether a round was started
 */
function advanceIfReady(room, rng, now) {
  if (room.phase !== 'between') return false;
  if (!humanSeats(room).every((seat) => room.ready.includes(seat))) return false;
  startNextRound(room, rng, now);
  return true;
}

/**
 * Moves the first player on by one seat and deals the next round. Side effect: mutates the room.
 *
 * @param {object} room
 * @param {() => number} rng  random numbers for the deal
 * @param {number} now  the clock, in milliseconds
 */
function startNextRound(room, rng, now) {
  room.first = (room.first + 1) % room.size;
  startRound(room, rng, now);
}

/**
 * Starts the next round whether or not everyone has said they are ready (the server does this after a wait).
 *
 * @param {object} room  mutated
 * @param {() => number} rng  random numbers for the deal
 * @param {number} now  the clock, in milliseconds
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: starts the next round (deals, logs, resets the timer) on success.
 */
export function forceNext(room, rng, now) {
  if (room.phase !== 'between') return fail('noRoundToStart');
  startNextRound(room, rng, now);
  return ok();
}

/**
 * The host starts a new game in the same room once one has finished: everything is reset and the room goes back to the
 * lobby with the same people.
 *
 * @param {object} room  mutated
 * @param {number} userId  who is asking (must be the host)
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: resets the game fields and sets room.phase to 'lobby' on success.
 */
export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('notOver');
  resetGame(room);
  room.phase = 'lobby';
  return ok();
}

/**
 * What the statistics should record for a finished game: one entry per human still seated.
 *
 * @param {object} room  a finished room
 * @returns {object[]} entries for ctx.stats.record
 * Side effects: none.
 */
export function statsPlayers(room) {
  return statsRows(room.seats, (seat, i) => ({
    outcome: room.winners.includes(i) ? 'win' : 'loss',
    placement: room.final.players[i].placement,
    score: room.scores[i],
    extras: { ...extrasOf(room.tally[i], STAT_KEYS), roundsPlayed: room.round },
  }));
}

// ---- what each player may see ----

/**
 * Every tile in every place: used by the tests (tile conservation) and the bots.
 *
 * @param {object} room
 * @returns {number[]} the pool, then every rack, then every table set, flattened
 * Side effects: none.
 */
export function allTiles(room) {
  return [...room.pool, ...room.racks.flat(), ...room.table.flat()];
}

/** How many tiles there are in the room altogether (always totalTiles once a round has been dealt). Takes the room; returns a number; no side effects. */
export const tileCount = (room) => allTiles(room).length;

/**
 * Has a round been dealt in this phase (so that racks and scores mean something)?
 *
 * @param {object} room  not changed
 * @returns {boolean}
 * Side effects: none.
 */
const hasStarted = (room) => room.phase === 'playing' || room.phase === 'between' || room.phase === 'finished';

/**
 * One occupied seat as the table shows it to everybody.
 *
 * @param {object} room  not changed
 * @param {number} i  the seat's index
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object}
 * Side effects: none.
 */
function seatView(room, i, online) {
  const seat = room.seats[i];
  const started = hasStarted(room);
  return {
    seat: i,
    name: seat.name,
    bot: isBot(seat),
    ...(isBot(seat) && room.phase !== 'lobby' ? { ai: describeAI(aiById(AIS, seat.ai)) } : {}),
    online: isBot(seat) || online(seat.id),
    score: started ? room.scores[i] : 0,
    count: started ? room.racks[i].length : 0,
    melded: started ? room.melded[i] : false,
    ready: room.phase === 'between' && room.ready.includes(i),
  };
}

/**
 * The standard scoreboard (shared/scores.js): the players and the rounds scored so far.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online
 * @returns {object}
 * Side effects: none.
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
 * The table, the counts and the viewer's own rack: what a viewer may see once a round has been dealt.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {number} [now]  the clock, in milliseconds (for the time left on the turn timer)
 * @returns {object} fields to add to the view when the game has started
 * Side effects: none.
 */
function playView(room, me, now) {
  return {
    round: room.round,
    first: room.first,
    turn: room.turn,
    version: room.moves,
    table: room.table,
    poolCount: room.pool.length,
    rack: me === -1 ? [] : room.racks[me],
    drawn: me === -1 ? null : room.drawn?.[me] ?? null,
    lastPlay: room.lastPlay,
    remaining: room.deadline === null || room.phase !== 'playing' ? null : Math.max(0, room.deadline - now),
    lastRound: room.lastRound,
    final: room.phase === 'finished' ? room.final : null,
  };
}

/**
 * Everything one account may know: the table, the counts, its own rack - never the pool's order or another rack.
 *
 * @param {object} room  not changed
 * @param {number} userId  whose view this is (a spectator or stranger sees no rack)
 * @param {object} [options]
 * @param {(id: number) => boolean} [options.online]  is this person connected? (to show who is away)
 * @param {number} [options.now]  the clock, in milliseconds (for the time left on the turn timer)
 * @returns {object} the view sent to that person's client
 * Side effects: none (never includes another player's rack or the pool order).
 */
export function viewFor(room, userId, { online = () => true, now } = {}) {
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
    limits: { sizes: SIZES, ...LIMITS },
    deal: { total: totalTiles(room.settings), hand: dealSize(room.settings, room.size), jokerValue: JOKER_VALUE },
    log: recentMoves(room, 14),
  };
  if (hasStarted(room)) Object.assign(view, playView(room, me, now));
  return view;
}

export { tileName };
