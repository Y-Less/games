// The rules of Tints and Hints, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
import { COLS, ROWS, isCell, isClose, fromOldCell, fromEarlierCell, fromV4Cell } from './grid.js';
import { finalStandings, playerScoreboardEntry, standingsOf, totalsFromRounds } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { aiById, assignAIs, describeAI } from '../../shared/ai.js';
import { MARKER_COLOURS, markerProblem, normaliseMarker, startingMarker } from '../../shared/markerColours.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { createRosterRules, hasPlayer, humans, isBot, isHuman, migratePlayers, seatOf } from '../../shared/roster.js';
import { AIS } from './ai/index.js';
import { newCounters, statsExtras, tallyTurn } from './tally.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const TURNS_EACH = { min: 1, max: 5, default: 2 };
export const HINT_LENGTH = 80;
export const COLOURS = MARKER_COLOURS; // the free palette; any other colour is a shop unlock (shared/markerColours.js)
export const POINTS = { firstExact: 5, firstClose: 2, secondExact: 4, secondClose: 1, hinterPerGuesser: 3 };

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana'];
/** Version of the colour grid the squares of a room are named in (1, with no marker, was the 24 x 10 grid). */
const GRID_VERSION = 5;
const LIVE = ['lobby', 'guessing1', 'guessing2', 'reveal'];

// The player-list vocabulary (who is in the room, and who is a person) is shared with Just One and Wavelength.
export { hasPlayer, humans, isHuman, seatOf };

/**
 * Is the game still going (or still in the lobby)?
 *
 * @param {object} room
 * @returns {boolean} false once it has finished or been abandoned
 */
export const isLive = (room) => LIVE.includes(room.phase);
/** The player with this id, or undefined. */
const playerOf = (room, id) => room.players.find((p) => p.id === id);
/** A function giving a player's name: the name saved with them, else `nameOf` (only rooms saved long ago lack names). */
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);
/** Everybody but the hinter. */
const guessers = (room) => room.players.filter((p) => p.id !== room.hinter);
/** A random square of the grid, such as 'M4'. */
const randomCell = (rng) => COLS[Math.floor(rng() * COLS.length)] + ROWS[Math.floor(rng() * ROWS.length)];

/**
 * Gives a bare player ({ kind, id, name }) the fields Tints and Hints keeps for everybody: the score, the statistics counters
 * and a marker colour. A computer player gets the first colour nobody has; a person gets the colour they prefer (`extras.colour`,
 * already checked to be one they may use) if it is free, otherwise the first free one.
 *
 * @param {object} room     the room the player is about to join (read for the colours already taken; not changed)
 * @param {object} base     { kind: 'human' | 'bot', id, name? }
 * @param {{ colour?: string | null }} [extras]  what the server knows about a person joining
 * @returns {object} the player
 */
const makePlayer = (room, base, extras = {}) => ({
  ...base,
  colour: isBot(base) ? freeColour(room) : startingMarker(extras.colour ?? null, room.players.map((p) => p.colour), true),
  score: 0,
  ...newCounters(),
});
const freeColour = (room) => COLOURS.find((c) => !room.players.some((p) => p.colour === c));

/**
 * Makes a new room with the host in it.
 *
 * @param {object} args
 * @param {string} args.code         the invite code
 * @param {number} args.hostId       the host's account id
 * @param {string} [args.hostName]   the host's display name
 * @param {object} [args.settings]   settings the host chose when creating it ({ turnsEach }); invalid ones are ignored
 * @param {number} [args.turnsEach]  turns each (default 2); `settings.turnsEach` wins if both are given
 * @param {string | null} [args.colour]  the host's default marker colour, already checked to be one they may use (ctx.markers.preferred)
 * @param {number} args.now        the time to stamp it with
 * @returns {object} the room, in the lobby
 */
export function createRoom({ code, hostId, hostName, settings = {}, now, turnsEach = TURNS_EACH.default, colour = null }) {
  const room = {
    code,
    hostId,
    phase: 'lobby',
    turnsEach,
    turnsTotal: 0,
    turn: 0,
    players: [],
    nextIdx: 0,
    grid: GRID_VERSION, // 5 = the 52 x 24 grid (4 was 48 x 24, 2 and 3 were 48 x 20); rooms without it were saved with the old 24 x 10 grid (see migrate)
    ready: [], // at the reveal: the people who have closed the scores pop-up
    nextBot: 1, // computer players are players with kind 'bot', an id 'bot:<n>', a name and (once started) an ai id
    hinter: null,
    tint: null,
    hints: { first: '', second: '' },
    first: [],
    second: [],
    result: null,
    history: [],
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
  room.ready ??= [];
  room.players.push(makePlayer(room, typeof hostName === 'string' ? { kind: 'human', id: hostId, name: hostName } : { kind: 'human', id: hostId }, { colour }));
  setSettings(room, hostId, settings); // a setting the host got wrong is simply left at its default
  return room;
}

/**
 * The lobby, joining, leaving and computer-player rules, from shared/roster.js. In Tints and Hints somebody who leaves
 * mid-game is not replaced: the game carries on with one fewer (see afterRemoval).
 */
const roster = createRosterRules({
  isLive,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  botNames: BOT_NAMES,
  makePlayer,
  afterRemoval: (room, left, rng) => afterRemoval(room, left.id, left.index, rng),
});
/** addHuman(room, userId, name, { colour }) takes the person's preferred marker colour in its last argument. */
export const { addHuman, removeHuman, addBot, removeBot, fillWithBots, kick } = roster;

/**
 * The host changes the settings. Only the settings that are given are changed.
 *
 * @param {object} room
 * @param {number} id        who is asking (must be the host)
 * @param {object} settings  { turnsEach? }
 * @returns {{ ok: boolean, error?: string }}
 */
export function setSettings(room, id, settings = {}) {
  if (settings.turnsEach === undefined) return hostInLobby(room, id) ?? ok();
  return setTurnsEach(room, id, settings.turnsEach);
}

/**
 * Tints and Hints has no "play again": a new game is made from the menu. (The shared room server offers the event to every game.)
 *
 * @returns {{ ok: false, error: string }}
 */
export function playAgain() {
  return fail('Start a new game from the menu.');
}

/**
 * A player picks their marker colour in the lobby.
 *
 * Side effect: changes the player's colour.
 *
 * @param {object} room
 * @param {number} id
 * @param {string} colour
 * @param {boolean} [canCustom]  this player has unlocked any marker colour (otherwise only the free palette is allowed)
 * @returns {{ ok: boolean, error?: string }}
 */
export function setColour(room, id, colour, canCustom = false) {
  const player = playerOf(room, id);
  if (!player) return fail('You are not in this game.');
  if (room.phase !== 'lobby') return fail('Colours can only be chosen before the game starts.');
  const problem = markerProblem(colour, room.players.filter((p) => p.id !== id).map((p) => p.colour), canCustom);
  if (problem) return fail(problem);
  player.colour = normaliseMarker(colour);
  return ok();
}

export function setTurnsEach(room, id, turnsEach) {
  if (id !== room.hostId) return fail('Only the host can change the settings.');
  if (room.phase !== 'lobby') return fail('The game has already started.');
  if (!Number.isInteger(turnsEach) || turnsEach < TURNS_EACH.min || turnsEach > TURNS_EACH.max) {
    return fail(`Choose between ${TURNS_EACH.min} and ${TURNS_EACH.max} turns each.`);
  }
  room.turnsEach = turnsEach;
  return ok();
}

function startTurn(room, rng) {
  room.hinter = room.players[room.nextIdx].id;
  room.nextIdx = (room.nextIdx + 1) % room.players.length;
  room.tint = randomCell(rng);
  room.hints = { first: '', second: '' };
  room.first = [];
  room.second = [];
  room.result = null;
  room.ready = [];
  room.phase = 'guessing1';
}

/**
 * The host starts the game: works out how many turns there will be, picks the first hinter and the first tint, and gives
 * every computer player an AI for the whole game.
 *
 * Side effects: changes the phase and everything a turn sets up (see startTurn); uses `rng` for the order, the tint and the AIs.
 *
 * @param {object} room
 * @param {number} id            who is asking (must be the host)
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 */
export function start(room, id, rng) {
  if (id !== room.hostId) return fail('Only the host can start the game.');
  if (room.phase !== 'lobby') return fail('The game has already started.');
  if (room.players.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players.`);
  room.turnsTotal = room.turnsEach * room.players.length;
  room.turn = 0;
  room.collected = null;
  room.nextIdx = Math.floor(rng() * room.players.length);
  startTurn(room, rng);
  // Every computer player gets an AI for the whole game (after the deal, so seeded games deal as they always did).
  const bots = room.players.filter(isBot);
  const picks = assignAIs(AIS, bots.map((p) => p.id), rng);
  for (const p of bots) p.ai = picks[p.id];
  return ok();
}

/**
 * The hinter writes a hint for the round that is being played (the first hint in round one, the second in round two).
 *
 * The first hint is required (nobody can guess before it is in), but a second hint is optional. Writing the second hint is
 * allowed as soon as round two has begun, which is to say after every first guess is in and the hinter has pressed
 * "continue". That is INTENTIONAL, not a loophole: the second hint exists precisely so that the hinter can steer people
 * after seeing where the first round's guesses fell. (The hint of the round being played can also be rewritten until the
 * round is closed.) Do not "fix" this by locking the second hint away.
 *
 * Side effect: replaces room.hints.first or room.hints.second.
 *
 * @param {object} room
 * @param {number} id      who is asking (must be the hinter, while guessing is open)
 * @param {string} text    the hint; whitespace is tidied and it is cut to HINT_LENGTH letters
 * @returns {{ ok: boolean, error?: string }}
 */
export function setHint(room, id, text) {
  if (id !== room.hinter || !['guessing1', 'guessing2'].includes(room.phase)) return fail('You cannot give a hint now.');
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, HINT_LENGTH);
  if (room.phase === 'guessing1' && !clean) return fail('The first hint is needed: type one before anyone guesses.');
  room.hints[room.phase === 'guessing1' ? 'first' : 'second'] = clean;
  return ok();
}

export function guess(room, id, cell) {
  if (!['guessing1', 'guessing2'].includes(room.phase)) return fail('It is not time to guess.');
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (id === room.hinter) return fail('You are giving the hint, so you cannot guess.');
  if (room.phase === 'guessing1' && !room.hints.first) return fail('Wait for the first hint.');
  if (!isCell(cell)) return fail('That is not a square on the grid.');
  const list = room.phase === 'guessing1' ? room.first : room.second;
  if (list.some((g) => g.id === id)) return fail('You have already guessed. Wait for the others.');
  list.push({ id, cell });
  return ok();
}

const allGuessed = (room) => {
  const list = room.phase === 'guessing1' ? room.first : room.second;
  return guessers(room).every((p) => list.some((g) => g.id === p.id));
};

/** Scores the turn exactly as the original game did (see README.md for its quirks). */
function scoreTurn(room, nameOf = String) {
  const entries = [];
  const got = new Set();
  for (const [round, list] of [[1, room.first], [2, room.second]]) {
    for (const { id, cell } of list) {
      const player = playerOf(room, id);
      if (!player) continue;
      let kind = 'miss';
      let points = 0;
      if (cell === room.tint) {
        kind = 'exact';
        points = round === 1 ? POINTS.firstExact : POINTS.secondExact;
        got.add(id);
      } else if (isClose(cell, room.tint)) {
        kind = 'close';
        points = round === 1 ? POINTS.firstClose : POINTS.secondClose;
      }
      player.score += points;
      entries.push({ id, round, cell, kind, points });
    }
  }
  const hinter = playerOf(room, room.hinter);
  const hinterPoints = hinter ? got.size * POINTS.hinterPerGuesser : 0;
  if (hinter) {
    hinter.score += hinterPoints;
  }
  tallyTurn({ entries, playerOf: (id) => playerOf(room, id), hinter, target: room.tint });
  room.result = { tint: room.tint, hinter: room.hinter, entries, hinterPoints };
  recordHistory(room, nameOf, got.size);
}

/**
 * Appends the finished turn to room.history (the standard round shape of shared/scores.js). This only happens when
 * the turn is scored, i.e. at the reveal, so the history never shows anything the players have yet to see.
 * A turn that is skipped because its hinter left is never scored and so appends nothing (the next entry's number
 * simply jumps ahead, which is honest about the skipped turn).
 */
function recordHistory(room, nameOf, found) {
  const deltas = {};
  const notes = {};
  const phrase = (kind, round) => `${kind} in round ${round}`;
  for (const p of guessers(room)) {
    const mine = room.result.entries.filter((e) => e.id === p.id);
    if (!mine.length) continue;
    deltas[p.id] = mine.reduce((sum, e) => sum + e.points, 0);
    const scored = mine.filter((e) => e.kind !== 'miss').map((e) => phrase(e.kind, e.round));
    notes[p.id] = scored.length ? scored.join(', ') : 'missed';
  }
  if (playerOf(room, room.hinter)) {
    deltas[room.hinter] = room.result.hinterPoints;
    notes[room.hinter] = found ? `${found} found it` : 'nobody found it';
  }
  room.history.push({ label: `Turn ${room.turn + 1}: ${nameOf(room.hinter)}`, deltas, notes });
}

/**
 * Brings a room saved by an older version up to date: its players are given a `kind` (saved `bot: true` becomes
 * `kind: 'bot'`; people saved without a name get one from `nameOf`), its squares are renamed for the finer grid, it gets a
 * history, and if the scores are more than the history adds up to (turns scored before the history was kept) the difference
 * becomes one "Earlier turns" entry, so the totals always equal the scores.
 *
 * Side effect: mutates the room. Running it twice changes nothing more.
 *
 * @param {object} room
 * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
 * @returns {object} the same room
 */
export function migrate(room, nameOf) {
  migratePlayers(room, nameOf);
  room.ready ??= [];
  if (room.grid !== GRID_VERSION) {
    // A room saved with the old 24 x 10 grid: every square is renamed to the same colour in the finer grid.
    // An older room has its squares renamed to the nearest square of the same colour: first to the 48 x 24 grid (version 4), then to this one.
    const toV4 = room.grid === 2 || room.grid === 3 ? (cell) => fromEarlierCell(cell, room.grid === 2 ? 4 : 3) ?? cell : room.grid === 4 ? (cell) => cell : (cell) => fromOldCell(cell) ?? cell;
    const renamed = (cell) => fromV4Cell(toV4(cell)) ?? cell;
    if (room.tint) room.tint = renamed(room.tint);
    for (const list of [room.first, room.second]) for (const g of list ?? []) g.cell = renamed(g.cell);
    if (room.result) {
      room.result.tint = renamed(room.result.tint);
      for (const e of room.result.entries ?? []) e.cell = renamed(e.cell);
    }
    room.grid = GRID_VERSION;
  }
  if (!Array.isArray(room.history)) room.history = [];
  const totals = totalsFromRounds(room.history, room.players.map((p) => p.id));
  const missing = Object.fromEntries(room.players.map((p) => [p.id, p.score - totals[p.id]]).filter(([, diff]) => diff !== 0));
  if (Object.keys(missing).length) room.history.unshift({ label: 'Earlier turns', deltas: missing, notes: {} });
  return room;
}

function finishTurn(room, rng) {
  room.turn++;
  room.ready = [];
  if (room.turn >= room.turnsTotal) {
    room.phase = 'finished';
    return true;
  }
  startTurn(room, rng);
  return false;
}

/** Moves on: the hinter closes each round of guessing. (The reveal is closed by everyone, see `ready`.) */
export function advance(room, id, rng, nameOf = String) {
  nameOf = namer(room, nameOf);
  if (room.phase === 'reveal') return fail('Close the scores to carry on.');
  if (!['guessing1', 'guessing2'].includes(room.phase)) return fail('There is nothing to continue.');
  if (id !== room.hinter) return fail('Only the hinter can continue.');
  if (!allGuessed(room)) return fail('Wait for everyone to guess.');
  if (room.phase === 'guessing1') room.phase = 'guessing2';
  else {
    scoreTurn(room, nameOf);
    room.ready = [];
    room.phase = 'reveal';
  }
  return ok({ finished: false });
}

/** The people who have yet to close the scores at the reveal. */
const unready = (room) => humans(room).filter((p) => !room.ready.includes(p.id));

/**
 * At the reveal, a person has closed the scores pop-up and is ready for the next turn. Once every person is ready
 * (computer players always are) the next turn starts, or the game finishes after the last one.
 */
export function ready(room, id, rng) {
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (room.phase !== 'reveal') return fail('There are no scores to close.');
  if (!room.ready.includes(id)) room.ready.push(id);
  return ok({ finished: unready(room).length === 0 ? finishTurn(room, rng) : false });
}

/** Moves on from the reveal whether or not everyone has closed the pop-up (the server does this after a wait). */
export function forceNext(room, rng) {
  if (room.phase !== 'reveal') return fail('There is nothing to move on from.');
  return ok({ finished: finishTurn(room, rng) });
}

/** True while the reveal waits for people to close the scores (the server times this out). */
export const waitingForReady = (room) => room.phase === 'reveal';

/**
 * Tints and Hints' part of somebody leaving a game that is under way (the roster has already taken them out of the list and,
 * if they were the host, handed the host on): their guesses go and the hinter's turn is skipped if the hinter left. Fewer
 * than MIN_PLAYERS left means the game is abandoned.
 *
 * Side effects: mutates the room (guesses, ready, nextIdx, phase) and may start the next turn.
 *
 * @param {object} room
 * @param {number | string} id  who left
 * @param {number} index        where they were in the player list
 * @param {() => number} rng
 * @returns {{ abandoned: boolean, finished: boolean }}
 */
function afterRemoval(room, id, index, rng) {
  const wasHinter = room.hinter === id && ['guessing1', 'guessing2'].includes(room.phase);
  if (index < room.nextIdx) room.nextIdx--;
  if (room.players.length) room.nextIdx %= room.players.length;
  room.first = room.first.filter((g) => g.id !== id);
  room.second = room.second.filter((g) => g.id !== id);
  room.ready = (room.ready ?? []).filter((x) => x !== id);
  if (room.players.length < MIN_PLAYERS) {
    room.phase = 'abandoned';
    room.ready = [];
    return { abandoned: true, finished: false };
  }
  if (room.phase === 'reveal') return { abandoned: false, finished: unready(room).length === 0 ? finishTurn(room, rng) : false };
  return { abandoned: false, finished: wasHinter ? finishTurn(room, rng) : false };
}

/**
 * Players best first; tied scores share a placement and every tied leader wins.
 *
 * @param {object} room  not changed
 * @returns {object[]} copies of the players with `placement` and `winner`
 */
export function standings(room) {
  return standingsOf(room.players);
}

/**
 * The statistics for a finished game, in the shape of ctx.stats.record. Computer players are not accounts: people only.
 *
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}
 */
export function statsPlayers(room) {
  return statsRows(standings(room), (p) => ({
    outcome: p.winner ? 'win' : 'loss',
    placement: p.placement,
    score: p.score,
    extras: statsExtras(p),
  }));
}

/**
 * The guesses a viewer may see: the hinter and everybody after the reveal see all of them; before that a guesser sees their own,
 * and the first round's guesses are shown once the second hint is out.
 *
 * @param {object} room  not changed
 * @param {number} userId  the viewer
 * @returns {{ id: number, cell: string, round: number }[]} both rounds' guesses, first round first
 */
function guessesView(room, userId) {
  const isHinter = room.hinter === userId;
  const revealed = ['reveal', 'finished'].includes(room.phase);
  const list = (guesses, round) => {
    const open = isHinter || revealed || (round === 1 && room.phase !== 'guessing1') || (round === 2 && room.phase !== 'guessing2');
    return guesses.filter((g) => open || g.id === userId).map((g) => ({ id: g.id, cell: g.cell, round }));
  };
  return [...list(room.first, 1), ...list(room.second, 2)];
}

/**
 * The result of the turn just scored, with the names filled in (only once it is revealed).
 *
 * @param {object} room  not changed
 * @param {(id: number) => string} nameOf  a player's name
 * @returns {object | null}
 */
function resultView(room, nameOf) {
  const revealed = ['reveal', 'finished'].includes(room.phase);
  if (!(revealed && room.result)) return null;
  return { ...room.result, hinterName: nameOf(room.result.hinter), entries: room.result.entries.map((e) => ({ ...e, name: nameOf(e.id) })) };
}

/**
 * One player as the table shows them to everybody.
 *
 * @param {object} room  not changed
 * @param {object} p  the player
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean, final: Map<number, object> }} context
 * @returns {object}
 */
function playerView(room, p, { nameOf, online, final }) {
  const current = room.phase === 'guessing1' ? room.first : room.phase === 'guessing2' ? room.second : [];
  return {
    id: p.id,
    name: nameOf(p.id),
    colour: p.colour,
    score: p.score,
    online: isBot(p) || online(p.id),
    bot: isBot(p), // the client's name for "is a computer player"
    ai: isBot(p) && p.ai ? describeAI(aiById(AIS, p.ai)) : null, // computer players only, once a game has started
    guessed: current.some((g) => g.id === p.id),
    ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : false,
    placement: final.get(p.id)?.placement ?? null,
    winner: final.get(p.id)?.winner ?? false,
  };
}

/**
 * The standard scoreboard (shared/scores.js): the hinter has the turn, and while the results are up each player shows whether
 * they are ready to go on.
 *
 * @param {object} room  not changed
 * @param {number} userId  the viewer
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean }} context
 * @returns {object}
 */
function scoreboardView(room, userId, { nameOf, online }) {
  const player = (p) => playerScoreboardEntry(p, { name: nameOf(p.id), me: userId, current: ['guessing1', 'guessing2', 'reveal'].includes(room.phase) && p.id === room.hinter, online, ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : undefined });
  return {
    players: room.players.map(player),
    rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })),
    lowIsBetter: false,
  };
}

/**
 * What one person may see. Only the hinter knows the target until the reveal, and guesses made in the current round
 * stay hidden from the other guessers until the round is closed.
 *
 * @param {object} room  not changed
 * @param {number} userId  the account looking
 * @param {object} [options]
 * @param {(id: number) => string} [options.nameOf]  names for players who have left
 * @param {(id: number) => boolean} [options.online]  who is connected
 * @param {boolean} [options.canCustom]  whether this player may pick any colour (a shop unlock)
 * @returns {object} the view sent to that person
 */
export function viewFor(room, userId, { nameOf = String, online = () => true, canCustom = false } = {}) {
  nameOf = namer(room, nameOf);
  const isHinter = room.hinter === userId;
  const revealed = ['reveal', 'finished'].includes(room.phase);
  const final = finalStandings(room.players, ['finished', 'abandoned'].includes(room.phase));
  return {
    code: room.code,
    phase: room.phase,
    you: userId,
    hostId: room.hostId,
    turnsEach: room.turnsEach,
    turn: Math.min(room.turn + 1, room.turnsTotal),
    turnsTotal: room.turnsTotal,
    hinter: room.hinter,
    tint: isHinter || revealed ? room.tint : null,
    hints: room.phase === 'lobby' ? { first: '', second: '' } : { first: room.hints.first, second: room.phase === 'guessing1' ? '' : room.hints.second },
    guesses: guessesView(room, userId),
    result: resultView(room, nameOf),
    players: room.players.map((p) => playerView(room, p, { nameOf, online, final })),
    scoreboard: scoreboardView(room, userId, { nameOf, online }),
    colours: COLOURS,
    canCustomColour: Boolean(canCustom), // this player may pick any colour (a shop unlock)
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, turns: TURNS_EACH },
  };
}

// ---------- computer players ----------

/**
 * The next thing a computer player has to do, or null: { type: 'hint' | 'guess' | 'advance', id }. Computer players
 * never move on from the reveal: that is the hinter's or the host's job, and the host is always a person, so a
 * computer player cannot hold the game up or rush people past their results.
 */
export function pendingBotAction(room) {
  if (!['guessing1', 'guessing2'].includes(room.phase)) return null;
  const hinter = playerOf(room, room.hinter);
  const key = room.phase === 'guessing1' ? 'first' : 'second';
  if (isBot(hinter) && !room.hints[key]) return { type: 'hint', id: hinter.id };
  const list = room[key];
  const guesser = key === 'first' && !room.hints.first ? null : guessers(room).find((p) => isBot(p) && !list.some((g) => g.id === p.id)); // nobody guesses before the first hint
  if (guesser) return { type: 'guess', id: guesser.id };
  if (isBot(hinter) && allGuessed(room)) return { type: 'advance', id: hinter.id };
  return null;
}

const ALL_CELLS = COLS.flatMap((c) => ROWS.map((r) => c + r));

/**
 * Plays one pending computer move. The decision is made from that seat's own view (viewFor), so a computer guesser
 * never sees the secret tint. An AI that throws or answers with something illegal is replaced by a random legal choice.
 */
export function runBotAction(room, rng, action = pendingBotAction(room), nameOf = String) {
  if (!action) return false;
  const player = playerOf(room, action.id);
  const ai = aiById(AIS, player.ai);
  const view = viewFor(room, action.id, { nameOf });
  const round = room.phase === 'guessing1' ? 1 : 2;
  const attempt = (decide) => {
    try {
      return decide();
    } catch {
      return undefined; // a broken AI must not stop the game
    }
  };
  if (action.type === 'hint') {
    const text = attempt(() => ai.hint({ round, tint: view.tint }, rng));
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    return setHint(room, action.id, clean || 'something').ok;
  }
  if (action.type === 'guess') {
    const cell = attempt(() => ai.guess({ round, cells: ALL_CELLS, hints: view.hints, guesses: view.guesses }, rng));
    return guess(room, action.id, isCell(cell) ? cell : randomCell(rng)).ok;
  }
  return advance(room, action.id, rng, nameOf).ok;
}
