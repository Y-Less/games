// The rules of Just One, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// A turn: one player, the guesser, does not see the secret word. Everybody else sees it and secretly writes a one-word clue.
// Clues that match are cancelled. The guesser sees the clues that are left and makes one guess. If it is right they pick
// the best hint from them, and only the guesser and the writer of that hint score.
import { placements } from '../../shared/scores.js';
import { aiById, assignAIs, describeAI } from '../../shared/ai.js';
import { AIS } from './ai/index.js';
import { WORDS, normal, relatedTo } from './words.js';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;
export const TURNS_EACH = { min: 1, max: 5, default: 2 };
export const CLUE_LENGTH = 24;
export const GUESS_LENGTH = 40;
export const POINTS = { guesser: 2, bestHint: 1 };

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus'];
const LIVE = ['lobby', 'clues', 'guessing', 'choosing', 'reveal'];
const PLAYING = ['clues', 'guessing', 'choosing'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export const isLive = (room) => LIVE.includes(room.phase);
export const hasPlayer = (room, id) => room.players.some((p) => p.id === id);
const playerOf = (room, id) => room.players.find((p) => p.id === id);
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);
const writers = (room) => room.players.filter((p) => p.id !== room.guesser);
const newPlayer = (id) => ({ id, score: 0, correctGuesses: 0, bestHints: 0, cluesGiven: 0 });
/** People (accounts), as opposed to computer players. */
export const humans = (room) => room.players.filter((p) => !p.bot);
const clueOf = (room, id) => room.clues.find((c) => c.id === id);
const allWritten = (room) => writers(room).every((p) => clueOf(room, p.id));

export function createRoom({ code, hostId, now = Date.now(), turnsEach = TURNS_EACH.default }) {
  return {
    code,
    hostId,
    phase: 'lobby',
    turnsEach,
    turnsTotal: 0,
    turn: 0,
    players: [newPlayer(hostId)],
    nextIdx: 0,
    ready: [], // at the reveal: the people who have closed the scores pop-up
    nextBot: 1, // computer players are seats named 'bot:<n>' with bot: true, a name and (once started) an ai id
    guesser: null,
    word: null,
    used: [], // the words already played this game
    clues: [], // [{ id, text }]: what each writer sent
    cancelled: [], // ids of the writers whose clue matched another one
    order: [], // ids of the writers whose clues are left, in the order the guesser sees them
    guess: null, // { text, correct, passed }
    best: null, // the id of the writer of the best hint
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
  room.players.push(newPlayer(id));
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
  return { ...newPlayer(`bot:${room.nextBot++}`), bot: true, name };
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
  room.guesser = room.players[room.nextIdx].id;
  room.nextIdx = (room.nextIdx + 1) % room.players.length;
  room.used ??= [];
  let fresh = WORDS.filter((entry) => !room.used.includes(entry.word));
  if (!fresh.length) {
    room.used = [];
    fresh = WORDS;
  }
  const chosen = fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))];
  room.used.push(chosen.word);
  room.word = chosen.word;
  room.clues = [];
  room.cancelled = [];
  room.order = [];
  room.guess = null;
  room.best = null;
  room.result = null;
  room.ready = [];
  room.phase = 'clues';
}

export function start(room, id, rng = Math.random) {
  if (id !== room.hostId) return fail('Only the host can start the game.');
  if (room.phase !== 'lobby') return fail('The game has already started.');
  if (room.players.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players.`);
  room.turnsTotal = room.turnsEach * room.players.length;
  room.turn = 0;
  room.used = [];
  room.nextIdx = Math.floor(rng() * room.players.length);
  startTurn(room, rng);
  // Every computer player gets an AI for the whole game.
  const bots = room.players.filter((p) => p.bot);
  const picks = assignAIs(AIS, bots.map((p) => p.id), rng);
  for (const p of bots) p.ai = picks[p.id];
  return ok();
}

/** Why a clue is not allowed for this word, or null. */
export function clueProblem(text, word) {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}'’-]*$/u.test(text)) return 'A clue is one word.';
  const clue = normal(text);
  const secret = normal(word);
  if (clue === secret || (clue.length >= 3 && (secret.includes(clue) || clue.includes(secret)))) return 'That is the word itself, or part of it.';
  return null;
}

/** The writer's clue: one word. Once everybody has written theirs, matching clues are cancelled and the guessing begins. */
export function submitClue(room, id, text, rng = Math.random) {
  if (room.phase !== 'clues') return fail('The clues are in.');
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (id === room.guesser) return fail('You are guessing, so you do not write a clue.');
  if (clueOf(room, id)) return fail('You have already sent your clue.');
  const clean = String(text ?? '').trim();
  if (!clean) return fail('Type your clue first.');
  if (clean.length > CLUE_LENGTH) return fail(`A clue is at most ${CLUE_LENGTH} letters.`);
  const problem = clueProblem(clean, room.word);
  if (problem) return fail(problem);
  room.clues.push({ id, text: clean });
  if (allWritten(room)) openGuessing(room, rng);
  return ok();
}

/** Cancels the clues that match each other and shows the rest to the guesser, in a shuffled order. */
function openGuessing(room, rng) {
  const count = new Map();
  for (const c of room.clues) count.set(normal(c.text), (count.get(normal(c.text)) ?? 0) + 1);
  room.cancelled = room.clues.filter((c) => count.get(normal(c.text)) > 1).map((c) => c.id);
  const order = room.clues.filter((c) => !room.cancelled.includes(c.id)).map((c) => c.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  room.order = order;
  room.phase = 'guessing';
}

const sameWord = (a, b) => normal(a) === normal(b);

/** The guesser's one guess. If it is right and any clues are left they go on to pick the best hint. */
export function guess(room, id, text, nameOf = String) {
  if (room.phase !== 'guessing') return fail('It is not time to guess.');
  if (id !== room.guesser) return fail('Only the guesser guesses.');
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, GUESS_LENGTH);
  if (!clean) return fail('Type a guess, or pass.');
  const correct = sameWord(clean, room.word);
  room.guess = { text: clean, correct, passed: false };
  if (correct && room.order.length) room.phase = 'choosing';
  else scoreTurn(room, namer(room, nameOf));
  return ok();
}

/** The guesser gives up on this word: nobody scores. */
export function pass(room, id, nameOf = String) {
  if (room.phase !== 'guessing') return fail('It is not time to guess.');
  if (id !== room.guesser) return fail('Only the guesser can pass.');
  room.guess = { text: '', correct: false, passed: true };
  scoreTurn(room, namer(room, nameOf));
  return ok();
}

/** After a right guess, the guesser picks the best of the clues they saw (`n` is its place in their list, from 0). */
export function chooseBest(room, id, n, nameOf = String) {
  if (room.phase !== 'choosing') return fail('There is no best hint to pick yet.');
  if (id !== room.guesser) return fail('Only the guesser picks the best hint.');
  if (!Number.isInteger(n) || n < 0 || n >= room.order.length) return fail('Pick one of the hints.');
  room.best = room.order[n];
  scoreTurn(room, namer(room, nameOf));
  return ok();
}

/** Scores the turn and opens the reveal. */
function scoreTurn(room, nameOf = String) {
  const guesser = playerOf(room, room.guesser);
  const best = room.best === null ? null : playerOf(room, room.best);
  const deltas = {};
  const notes = {};
  const correct = Boolean(room.guess?.correct);
  if (guesser) {
    if (correct) {
      guesser.score += POINTS.guesser;
      guesser.correctGuesses++;
      deltas[guesser.id] = POINTS.guesser;
    } else deltas[guesser.id] = 0;
    notes[guesser.id] = correct ? 'guessed it' : room.guess?.passed ? 'passed' : 'missed';
  }
  if (best) {
    best.score += POINTS.bestHint;
    best.bestHints++;
    deltas[best.id] = POINTS.bestHint;
    notes[best.id] = 'best hint';
  }
  for (const c of room.clues) {
    const writer = playerOf(room, c.id);
    if (writer) writer.cluesGiven++;
  }
  room.result = {
    word: room.word,
    guesser: room.guesser,
    guess: room.guess,
    correct,
    best: room.best,
    guesserPoints: correct ? POINTS.guesser : 0,
    bestPoints: best ? POINTS.bestHint : 0,
    clues: room.clues.map((c) => ({ id: c.id, text: c.text, cancelled: room.cancelled.includes(c.id), best: c.id === room.best })),
  };
  room.history.push({ label: `Turn ${room.turn + 1}: ${nameOf(room.guesser)}`, deltas, notes });
  room.ready = [];
  room.phase = 'reveal';
}

/** Brings a saved room up to date (nothing has changed shape yet; here for the day something does). */
export function migrate(room) {
  room.nextBot ??= 1;
  room.used ??= [];
  room.order ??= [];
  room.cancelled ??= [];
  if (!Array.isArray(room.history)) room.history = [];
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

/** The people who have yet to close the scores at the reveal. */
const unready = (room) => humans(room).filter((p) => !room.ready.includes(p.id));

/** At the reveal, a person has closed the scores pop-up and is ready for the next turn. */
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
export function removePlayer(room, id, rng = Math.random, nameOf = String) {
  const index = room.players.findIndex((p) => p.id === id);
  if (index === -1 || !isLive(room)) return ok({ empty: false, abandoned: false, finished: false });
  const wasGuesser = room.guesser === id && PLAYING.includes(room.phase);
  room.players.splice(index, 1);
  if (index < room.nextIdx) room.nextIdx--;
  if (room.players.length) room.nextIdx %= room.players.length;
  room.clues = room.clues.filter((c) => c.id !== id);
  room.cancelled = room.cancelled.filter((x) => x !== id);
  const orderBefore = room.order.length;
  room.order = room.order.filter((x) => x !== id);
  if (room.best === id) room.best = null;
  room.ready = (room.ready ?? []).filter((x) => x !== id);
  if (room.hostId === id && room.players.length) room.hostId = (humans(room)[0] ?? room.players[0]).id;
  if (!humans(room).length) return ok({ empty: true, abandoned: false, finished: false });
  if (room.phase === 'lobby') return ok({ empty: false, abandoned: false, finished: false });
  if (room.players.length < 2) {
    room.phase = 'abandoned';
    room.ready = [];
    return ok({ empty: false, abandoned: true, finished: false });
  }
  if (room.phase === 'reveal') return ok({ empty: false, abandoned: false, finished: unready(room).length === 0 ? finishTurn(room, rng) : false });
  if (wasGuesser) return ok({ empty: false, abandoned: false, finished: finishTurn(room, rng) });
  // A writer has gone: the clues are in once everybody who is left has written one; and a hint the guesser could pick is gone.
  if (room.phase === 'clues' && allWritten(room)) openGuessing(room, rng);
  else if (room.phase === 'choosing' && !room.order.length && orderBefore) scoreTurn(room, namer(room, nameOf));
  return ok({ empty: false, abandoned: false, finished: false });
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
    extras: { correctGuesses: p.correctGuesses, bestHints: p.bestHints, cluesGiven: p.cluesGiven },
  }));
}

/**
 * What one person may see. The guesser never sees the word until the reveal, and sees only the clues that were not cancelled
 * (without their writers). Everyone else sees the word, and, once all the clues are in, every clue with its writer and
 * whether it was cancelled. While the clues are being written nobody sees anybody else's.
 */
export function viewFor(room, userId, { nameOf = String, onlineOf = () => true } = {}) {
  nameOf = namer(room, nameOf);
  const member = hasPlayer(room, userId);
  const isGuesser = room.guesser === userId;
  const playing = PLAYING.includes(room.phase);
  const revealed = ['reveal', 'finished'].includes(room.phase);
  const final = ['finished', 'abandoned'].includes(room.phase) ? new Map(standings(room).map((p) => [p.id, p])) : new Map();
  const textOf = (id) => clueOf(room, id)?.text ?? '';
  let clues = [];
  if (room.phase === 'clues' && member && !isGuesser && clueOf(room, userId)) clues = [{ id: userId, name: nameOf(userId), text: textOf(userId), own: true }];
  else if (['guessing', 'choosing'].includes(room.phase) && isGuesser) clues = room.order.map((id, n) => ({ n, text: textOf(id) }));
  else if (['guessing', 'choosing'].includes(room.phase) && member) {
    const left = room.order.map((id) => ({ id, name: nameOf(id), text: textOf(id), cancelled: false }));
    clues = [...left, ...room.cancelled.map((id) => ({ id, name: nameOf(id), text: textOf(id), cancelled: true }))];
  } else if (revealed && room.result) clues = room.result.clues.map((c) => ({ ...c, name: nameOf(c.id) }));
  return {
    code: room.code,
    phase: room.phase,
    you: userId,
    hostId: room.hostId,
    turnsEach: room.turnsEach,
    turn: Math.min(room.turn + 1, room.turnsTotal),
    turnsTotal: room.turnsTotal,
    guesser: room.guesser,
    word: revealed || (playing && member && !isGuesser) ? room.word : null,
    clues,
    guess: room.guess,
    result: revealed && room.result ? { ...room.result, guesserName: nameOf(room.result.guesser), bestName: room.result.best === null ? null : nameOf(room.result.best) } : null,
    points: POINTS,
    players: room.players.map((p) => ({
      id: p.id,
      name: nameOf(p.id),
      score: p.score,
      online: p.bot || onlineOf(p.id),
      bot: Boolean(p.bot),
      ai: p.bot && p.ai ? describeAI(aiById(AIS, p.ai)) : null, // computer players only, once a game has started
      written: room.phase === 'clues' && p.id !== room.guesser ? Boolean(clueOf(room, p.id)) : false,
      ready: room.phase === 'reveal' ? Boolean(p.bot) || room.ready.includes(p.id) : false,
      placement: final.get(p.id)?.placement ?? null,
      winner: final.get(p.id)?.winner ?? false,
    })),
    scoreboard: {
      players: room.players.map((p) => ({ id: p.id, name: nameOf(p.id), userId: p.bot ? undefined : p.id, score: p.score, isMe: p.id === userId, bot: Boolean(p.bot), current: (playing || room.phase === 'reveal') && p.id === room.guesser, away: !p.bot && !onlineOf(p.id), ...(room.phase === 'reveal' ? { ready: Boolean(p.bot) || room.ready.includes(p.id) } : {}) })),
      rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: false,
    },
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, turns: TURNS_EACH },
  };
}

// ---------- computer players ----------

/**
 * The next thing a computer player has to do, or null: { type: 'clue' | 'guess' | 'best', id }. Computer players never move on
 * from the reveal: that is up to the people (or the server's timeout).
 */
export function pendingBotAction(room) {
  if (room.phase === 'clues') {
    const writer = writers(room).find((p) => p.bot && !clueOf(room, p.id));
    return writer ? { type: 'clue', id: writer.id } : null;
  }
  const guesser = playerOf(room, room.guesser);
  if (!guesser?.bot) return null;
  if (room.phase === 'guessing') return { type: 'guess', id: guesser.id };
  if (room.phase === 'choosing') return { type: 'best', id: guesser.id };
  return null;
}

/**
 * Plays one pending computer move. The decision is made from that seat's own view (viewFor), so a computer guesser never sees
 * the word. An AI that throws or answers with something illegal is replaced by a legal choice.
 */
export function runBotAction(room, rng = Math.random, action = pendingBotAction(room), nameOf = String) {
  if (!action) return false;
  const player = playerOf(room, action.id);
  const ai = aiById(AIS, player.ai);
  const view = viewFor(room, action.id, { nameOf });
  const attempt = (decide) => {
    try {
      return decide();
    } catch {
      return undefined; // a broken AI must not stop the game
    }
  };
  if (action.type === 'clue') {
    const tried = attempt(() => ai.clue({ word: view.word, related: relatedTo(view.word) }, rng));
    // A clue the rules refuse (or none) is replaced by the first of the usual ones that is allowed.
    const choices = [tried, ...relatedTo(view.word), 'hmm'].filter((t) => typeof t === 'string' && !clueProblem(t.trim(), view.word));
    return submitClue(room, action.id, choices[0] ?? 'hmm', rng).ok;
  }
  if (action.type === 'guess') {
    const text = attempt(() => ai.guess({ clues: view.clues.map((c) => c.text), words: WORDS.map((e) => e.word) }, rng));
    const clean = typeof text === 'string' ? text.trim() : '';
    return (clean ? guess(room, action.id, clean, nameOf) : pass(room, action.id, nameOf)).ok;
  }
  const n = attempt(() => ai.best({ word: view.guess.text, clues: view.clues.map((c) => c.text) }, rng));
  const pick = Number.isInteger(n) && n >= 0 && n < view.clues.length ? n : Math.floor(rng() * view.clues.length);
  return chooseBest(room, action.id, pick, nameOf).ok;
}
