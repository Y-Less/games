// The rules of Tints and Hints, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
import { COLS, ROWS, isCell, isClose, fromOldCell, fromEarlierCell, fromV4Cell } from './grid.js';
import { placements, totalsFromRounds } from '../../shared/scores.js';
import { aiById, assignAIs, describeAI } from '../../shared/ai.js';
import { AIS } from './ai/index.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const TURNS_EACH = { min: 1, max: 5, default: 2 };
export const HINT_LENGTH = 80;
export const COLOURS = ['#ffffff', '#000000', '#808080', '#ff2d95', '#00e5ff', '#ffd400', '#7cff3a', '#6a00ff'];
export const POINTS = { firstExact: 5, firstClose: 2, secondExact: 4, secondClose: 1, hinterPerGuesser: 3 };

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana'];
/** Version of the colour grid the squares of a room are named in (1, with no marker, was the 24 x 10 grid). */
const GRID_VERSION = 5;
const LIVE = ['lobby', 'guessing1', 'guessing2', 'reveal'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export const isLive = (room) => LIVE.includes(room.phase);
export const hasPlayer = (room, id) => room.players.some((p) => p.id === id);
const playerOf = (room, id) => room.players.find((p) => p.id === id);
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);
const guessers = (room) => room.players.filter((p) => p.id !== room.hinter);
const randomCell = (rng) => COLS[Math.floor(rng() * COLS.length)] + ROWS[Math.floor(rng() * ROWS.length)];
const newPlayer = (id, colour) => ({ id, colour, score: 0, exactGuesses: 0, closeGuesses: 0, hintsGiven: 0 });
/** People (accounts), as opposed to computer players. */
export const humans = (room) => room.players.filter((p) => !p.bot);
const freeColour = (room) => COLOURS.find((c) => !room.players.some((p) => p.colour === c));

export function createRoom({ code, hostId, now = Date.now(), turnsEach = TURNS_EACH.default }) {
  return {
    code,
    hostId,
    phase: 'lobby',
    turnsEach,
    turnsTotal: 0,
    turn: 0,
    players: [newPlayer(hostId, COLOURS[0])],
    nextIdx: 0,
    grid: GRID_VERSION, // 5 = the 52 x 24 grid (4 was 48 x 24, 2 and 3 were 48 x 20); rooms without it were saved with the old 24 x 10 grid (see migrate)
    ready: [], // at the reveal: the people who have closed the scores pop-up
    nextBot: 1, // computer players are seats named 'bot:<n>' with bot: true, a name and (once started) an ai id
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
}

export function addPlayer(room, id) {
  if (hasPlayer(room, id)) return ok();
  if (room.phase !== 'lobby') return fail('That game has already started.');
  if (room.players.length >= MAX_PLAYERS) return fail('That game is full.');
  room.players.push(newPlayer(id, freeColour(room)));
  return ok();
}

export function setColour(room, id, colour) {
  const player = playerOf(room, id);
  if (!player) return fail('You are not in this game.');
  if (room.phase !== 'lobby') return fail('Colours can only be chosen before the game starts.');
  if (!COLOURS.includes(colour)) return fail('That is not one of the colours.');
  if (room.players.some((p) => p.id !== id && p.colour === colour)) return fail('Someone else has that colour.');
  player.colour = colour;
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

function newBot(room) {
  const used = new Set(room.players.filter((p) => p.bot).map((p) => p.name));
  let name = BOT_NAMES.find((n) => !used.has(n)) ?? 'Computer';
  for (let n = 2; used.has(name); n++) name = `Computer ${n}`;
  room.nextBot ??= 1;
  room.ready ??= [];
  return { ...newPlayer(`bot:${room.nextBot++}`, freeColour(room)), bot: true, name };
}

function hostOnlyInLobby(room, id, what) {
  if (id !== room.hostId) return fail(`Only the host can ${what} computer players.`);
  if (room.phase !== 'lobby') return fail(`Computer players can only be ${what === 'add' ? 'added' : 'removed'} in the lobby.`);
  return null;
}

/** The host adds one computer player to the lobby. */
export function addBot(room, id) {
  const refused = hostOnlyInLobby(room, id, 'add');
  if (refused) return refused;
  if (room.players.length >= MAX_PLAYERS) return fail('That game is full.');
  const bot = newBot(room);
  room.players.push(bot);
  return ok({ id: bot.id });
}

/** The host fills the lobby with computer players until there are `target` players (default: enough to start). */
export function fillBots(room, id, target = MIN_PLAYERS) {
  const refused = hostOnlyInLobby(room, id, 'add');
  if (refused) return refused;
  const wanted = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(Number(target)) || MIN_PLAYERS));
  while (room.players.length < wanted) room.players.push(newBot(room));
  return ok();
}

/** The host removes a computer player from the lobby (in a game, see removePlayer). */
export function removeBot(room, id, botId) {
  const refused = hostOnlyInLobby(room, id, 'remove');
  if (refused) return refused;
  const index = room.players.findIndex((p) => p.id === botId && p.bot);
  if (index === -1) return fail('That is not a computer player.');
  room.players.splice(index, 1);
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

export function start(room, id, rng = Math.random) {
  if (id !== room.hostId) return fail('Only the host can start the game.');
  if (room.phase !== 'lobby') return fail('The game has already started.');
  if (room.players.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players.`);
  room.turnsTotal = room.turnsEach * room.players.length;
  room.turn = 0;
  room.nextIdx = Math.floor(rng() * room.players.length);
  startTurn(room, rng);
  // Every computer player gets an AI for the whole game (after the deal, so seeded games deal as they always did).
  const bots = room.players.filter((p) => p.bot);
  const picks = assignAIs(AIS, bots.map((p) => p.id), rng);
  for (const p of bots) p.ai = picks[p.id];
  return ok();
}

export function setHint(room, id, text) {
  if (id !== room.hinter || !['guessing1', 'guessing2'].includes(room.phase)) return fail('You cannot give a hint now.');
  room.hints[room.phase === 'guessing1' ? 'first' : 'second'] = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, HINT_LENGTH);
  return ok();
}

export function guess(room, id, cell) {
  if (!['guessing1', 'guessing2'].includes(room.phase)) return fail('It is not time to guess.');
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (id === room.hinter) return fail('You are giving the hint, so you cannot guess.');
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
        player.exactGuesses++;
        got.add(id);
      } else if (isClose(cell, room.tint)) {
        kind = 'close';
        points = round === 1 ? POINTS.firstClose : POINTS.secondClose;
        player.closeGuesses++;
      }
      player.score += points;
      entries.push({ id, round, cell, kind, points });
    }
  }
  const hinter = playerOf(room, room.hinter);
  const hinterPoints = hinter ? got.size * POINTS.hinterPerGuesser : 0;
  if (hinter) {
    hinter.score += hinterPoints;
    hinter.hintsGiven++;
  }
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
 * Brings a room saved by an older version up to date: its squares are renamed for the finer grid, it gets a history, and if the scores are more than the
 * history adds up to (turns scored before the history was kept) the difference becomes one "Earlier turns" entry,
 * so the totals always equal the scores.
 */
export function migrate(room) {
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
  room.nextBot ??= 1;
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
export function advance(room, id, rng = Math.random, nameOf = String) {
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
export function ready(room, id, rng = Math.random) {
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (room.phase !== 'reveal') return fail('There are no scores to close.');
  if (!room.ready.includes(id)) room.ready.push(id);
  return ok({ finished: unready(room).length === 0 ? finishTurn(room, rng) : false });
}

/** Moves on from the reveal whether or not everyone has closed the pop-up (the server does this after a wait). */
export function forceNext(room, rng = Math.random) {
  if (room.phase !== 'reveal') return fail('There is nothing to move on from.');
  return ok({ finished: finishTurn(room, rng) });
}

/** True while the reveal waits for people to close the scores (the server times this out). */
export const waitingForReady = (room) => room.phase === 'reveal';

/** Someone leaves (or is removed by the host). Returns { empty, abandoned, finished }. */
export function removePlayer(room, id, rng = Math.random) {
  const index = room.players.findIndex((p) => p.id === id);
  if (index === -1 || !isLive(room)) return ok({ empty: false, abandoned: false, finished: false });
  const wasHinter = room.hinter === id && ['guessing1', 'guessing2'].includes(room.phase);
  room.players.splice(index, 1);
  if (index < room.nextIdx) room.nextIdx--;
  if (room.players.length) room.nextIdx %= room.players.length;
  room.first = room.first.filter((g) => g.id !== id);
  room.second = room.second.filter((g) => g.id !== id);
  room.ready = (room.ready ?? []).filter((x) => x !== id);
  if (room.hostId === id && room.players.length) room.hostId = (humans(room)[0] ?? room.players[0]).id;
  if (!humans(room).length) return ok({ empty: true, abandoned: false, finished: false });
  if (room.phase === 'lobby') return ok({ empty: false, abandoned: false, finished: false });
  if (room.players.length < MIN_PLAYERS) {
    room.phase = 'abandoned';
    room.ready = [];
    return ok({ empty: false, abandoned: true, finished: false });
  }
  if (room.phase === 'reveal') return ok({ empty: false, abandoned: false, finished: unready(room).length === 0 ? finishTurn(room, rng) : false });
  return ok({ empty: false, abandoned: false, finished: wasHinter ? finishTurn(room, rng) : false });
}

/** Players best first; tied scores share a placement and every tied leader wins. */
export function standings(room) {
  const places = placements(Object.fromEntries(room.players.map((p) => [p.id, p.score])));
  return [...room.players].sort((a, b) => b.score - a.score).map((p) => ({ ...p, placement: places[p.id], winner: places[p.id] === 1 }));
}

/** The statistics for a finished game, in the shape of ctx.stats.record. Computer players are not accounts: people only. */
export function statsPlayers(room) {
  return standings(room).filter((p) => !p.bot).map((p) => ({
    userId: p.id,
    outcome: p.winner ? 'win' : 'loss',
    placement: p.placement,
    score: p.score,
    extras: { exactGuesses: p.exactGuesses, closeGuesses: p.closeGuesses, hintsGiven: p.hintsGiven },
  }));
}

/**
 * What one person may see. Only the hinter knows the target until the reveal, and guesses made in the current round
 * stay hidden from the other guessers until the round is closed.
 */
export function viewFor(room, userId, { nameOf = String, onlineOf = () => true } = {}) {
  nameOf = namer(room, nameOf);
  const isHinter = room.hinter === userId;
  const revealed = ['reveal', 'finished'].includes(room.phase);
  const list = (guesses, round) => {
    const open = isHinter || revealed || (round === 1 && room.phase !== 'guessing1') || (round === 2 && room.phase !== 'guessing2');
    return guesses.filter((g) => open || g.id === userId).map((g) => ({ id: g.id, cell: g.cell, round }));
  };
  const current = room.phase === 'guessing1' ? room.first : room.phase === 'guessing2' ? room.second : [];
  const final = ['finished', 'abandoned'].includes(room.phase) ? new Map(standings(room).map((p) => [p.id, p])) : new Map();
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
    guesses: [...list(room.first, 1), ...list(room.second, 2)],
    result: revealed && room.result
      ? { ...room.result, hinterName: nameOf(room.result.hinter), entries: room.result.entries.map((e) => ({ ...e, name: nameOf(e.id) })) }
      : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: nameOf(p.id),
      colour: p.colour,
      score: p.score,
      online: p.bot || onlineOf(p.id),
      bot: Boolean(p.bot),
      ai: p.bot && p.ai ? describeAI(aiById(AIS, p.ai)) : null, // computer players only, once a game has started
      guessed: current.some((g) => g.id === p.id),
      ready: room.phase === 'reveal' ? Boolean(p.bot) || room.ready.includes(p.id) : false,
      placement: final.get(p.id)?.placement ?? null,
      winner: final.get(p.id)?.winner ?? false,
    })),
    scoreboard: {
      players: room.players.map((p) => ({ id: p.id, name: nameOf(p.id), score: p.score, isMe: p.id === userId, bot: Boolean(p.bot), current: ['guessing1', 'guessing2', 'reveal'].includes(room.phase) && p.id === room.hinter, away: !p.bot && !onlineOf(p.id), ...(room.phase === 'reveal' ? { ready: Boolean(p.bot) || room.ready.includes(p.id) } : {}) })),
      rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: false,
    },
    colours: COLOURS,
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
  if (hinter?.bot && !room.hints[key]) return { type: 'hint', id: hinter.id };
  const list = room[key];
  const guesser = guessers(room).find((p) => p.bot && !list.some((g) => g.id === p.id));
  if (guesser) return { type: 'guess', id: guesser.id };
  if (hinter?.bot && allGuessed(room)) return { type: 'advance', id: hinter.id };
  return null;
}

const ALL_CELLS = COLS.flatMap((c) => ROWS.map((r) => c + r));

/**
 * Plays one pending computer move. The decision is made from that seat's own view (viewFor), so a computer guesser
 * never sees the secret tint. An AI that throws or answers with something illegal is replaced by a random legal choice.
 */
export function runBotAction(room, rng = Math.random, action = pendingBotAction(room), nameOf = String) {
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
