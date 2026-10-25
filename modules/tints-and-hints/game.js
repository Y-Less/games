// The rules of Tints and Hints, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
import { COLS, ROWS, isCell, isClose } from './grid.js';
import { placements, totalsFromRounds } from '../../shared/scores.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const TURNS_EACH = { min: 1, max: 5, default: 2 };
export const HINT_LENGTH = 80;
export const COLOURS = ['#ffffff', '#000000', '#808080', '#ff2d95', '#00e5ff', '#ffd400', '#7cff3a', '#6a00ff'];
export const POINTS = { firstExact: 5, firstClose: 2, secondExact: 4, secondClose: 1, hinterPerGuesser: 3 };

const LIVE = ['lobby', 'guessing1', 'guessing2', 'reveal'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export const isLive = (room) => LIVE.includes(room.phase);
export const hasPlayer = (room, id) => room.players.some((p) => p.id === id);
const playerOf = (room, id) => room.players.find((p) => p.id === id);
const guessers = (room) => room.players.filter((p) => p.id !== room.hinter);
const randomCell = (rng) => COLS[Math.floor(rng() * COLS.length)] + ROWS[Math.floor(rng() * ROWS.length)];
const newPlayer = (id, colour) => ({ id, colour, score: 0, exactGuesses: 0, closeGuesses: 0, hintsGiven: 0 });

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
  room.players.push(newPlayer(id, COLOURS.find((c) => !room.players.some((p) => p.colour === c))));
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

function startTurn(room, rng) {
  room.hinter = room.players[room.nextIdx].id;
  room.nextIdx = (room.nextIdx + 1) % room.players.length;
  room.tint = randomCell(rng);
  room.hints = { first: '', second: '' };
  room.first = [];
  room.second = [];
  room.result = null;
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
 * Brings a room saved by an older version up to date: it gets a history, and if the scores are more than the
 * history adds up to (turns scored before the history was kept) the difference becomes one "Earlier turns" entry,
 * so the totals always equal the scores.
 */
export function migrate(room) {
  if (!Array.isArray(room.history)) room.history = [];
  const totals = totalsFromRounds(room.history, room.players.map((p) => p.id));
  const missing = Object.fromEntries(room.players.map((p) => [p.id, p.score - totals[p.id]]).filter(([, diff]) => diff !== 0));
  if (Object.keys(missing).length) room.history.unshift({ label: 'Earlier turns', deltas: missing, notes: {} });
  return room;
}

function finishTurn(room, rng) {
  room.turn++;
  if (room.turn >= room.turnsTotal) {
    room.phase = 'finished';
    return true;
  }
  startTurn(room, rng);
  return false;
}

/** Moves on: the hinter closes each round of guessing, then the hinter or host closes the reveal. */
export function advance(room, id, rng = Math.random, nameOf = String) {
  if (room.phase === 'reveal') {
    if (id !== room.hinter && id !== room.hostId) return fail('Only the hinter or the host can continue.');
    return ok({ finished: finishTurn(room, rng) });
  }
  if (!['guessing1', 'guessing2'].includes(room.phase)) return fail('There is nothing to continue.');
  if (id !== room.hinter) return fail('Only the hinter can continue.');
  if (!allGuessed(room)) return fail('Wait for everyone to guess.');
  if (room.phase === 'guessing1') room.phase = 'guessing2';
  else {
    scoreTurn(room, nameOf);
    room.phase = 'reveal';
  }
  return ok({ finished: false });
}

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
  if (room.hostId === id && room.players.length) room.hostId = room.players[0].id;
  if (!room.players.length) return ok({ empty: true, abandoned: false, finished: false });
  if (room.phase === 'lobby') return ok({ empty: false, abandoned: false, finished: false });
  if (room.players.length < MIN_PLAYERS) {
    room.phase = 'abandoned';
    return ok({ empty: false, abandoned: true, finished: false });
  }
  return ok({ empty: false, abandoned: false, finished: wasHinter ? finishTurn(room, rng) : false });
}

/** Players best first; tied scores share a placement and every tied leader wins. */
export function standings(room) {
  const places = placements(Object.fromEntries(room.players.map((p) => [p.id, p.score])));
  return [...room.players].sort((a, b) => b.score - a.score).map((p) => ({ ...p, placement: places[p.id], winner: places[p.id] === 1 }));
}

/** The statistics for a finished game, in the shape of ctx.stats.record. */
export function statsPlayers(room) {
  return standings(room).map((p) => ({
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
      online: onlineOf(p.id),
      guessed: current.some((g) => g.id === p.id),
      placement: final.get(p.id)?.placement ?? null,
      winner: final.get(p.id)?.winner ?? false,
    })),
    scoreboard: {
      players: room.players.map((p) => ({ id: p.id, name: nameOf(p.id), score: p.score, isMe: p.id === userId, away: !onlineOf(p.id) })),
      rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: false,
    },
    colours: COLOURS,
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, turns: TURNS_EACH },
  };
}
