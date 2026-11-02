// The rules of Just One, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error, params? }, where `error` is a code under `errors.` in the game's
// locale file or the site's (see MODULES.md, Languages); anything else the client shows is a message (shared/messages.js).
//
// A turn: one player, the guesser, does not see the secret word. Everybody else sees it and secretly writes a one-word clue.
// Clues that match are cancelled. The guesser sees the clues that are left and makes one guess. If it is right they pick
// the best hint from them, and only the guesser and the writer of that hint score.
//
// Depends on: shared/scores.js (standings and scoreboard rows), shared/tally.js (statistics rows), shared/ai.js (computer
// player choice), shared/seats.js (result helpers), shared/messages.js (scoreboard labels and notes), shared/roster.js (lobby and player-list rules), ./ai/index.js (the
// computer players), ./tally.js (per-player counters) and ./words.js (the word list and clue matching).
import { textFrom } from '../../shared/input.js';
import { msg } from '../../shared/messages.js';
import { finalStandings, playerScoreboardEntry, standingsOf } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { createRosterRules, hasPlayer, humans, isBot, isHuman, migratePlayers, renameInHistory, seatOf } from '../../shared/roster.js';
import { AIS } from './ai/index.js';
import { newCounters, statsExtras, tallyTurn } from './tally.js';
import { WORDS, normal, relatedTo } from './words.js';

// Table size limits (three are needed for a useful game of clues; seven is the most the screen shows comfortably).
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;
// How many turns as the guesser each player gets: bounds and default for the host's setting.
export const TURNS_EACH = { min: 1, max: 5, default: 2 };
// The longest clue and guess accepted, in characters (keeps the table readable and stops pasted essays).
export const CLUE_LENGTH = 24;
const GUESS_LENGTH = 40;
// Points per turn: the guesser for a right guess, and the writer of the hint they pick as best.
export const POINTS = { guesser: 2, bestHint: 1 };

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus'];
// Phases in which the game is still going.
const LIVE = ['lobby', 'clues', 'guessing', 'choosing', 'reveal'];
// Phases of a turn in which people are acting (as opposed to the lobby or the reveal).
const PLAYING = ['clues', 'guessing', 'choosing'];

// The player-list vocabulary (who is in the room, and who is a person) is shared with Wavelength and Tints and Hints.
export { hasPlayer, humans, isHuman, seatOf };

/**
 * Is the game still going (or still in the lobby)?
 *
 * @param {object} room
 * @returns {boolean} false once it has finished or been abandoned
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);
/**
 * The player with this id, or undefined.
 * @param {object} room  the room
 * @param {number | string} id  a player id
 * @returns {object | undefined} the player
 * Side effects: none.
 */
const playerOf = (room, id) => room.players.find((p) => p.id === id);
/**
 * A function giving a player's name: the name saved with them, else `nameOf` (only rooms saved long ago lack names).
 * @param {object} room  the room
 * @param {(id: number | string) => string} nameOf  fallback lookup
 * @returns {(id: number | string) => string} the name lookup
 * Side effects: none.
 */
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);
/**
 * Everybody but the guesser: the people who write clues this turn.
 * @param {object} room  the room
 * @returns {object[]} the writers
 * Side effects: none.
 */
const writers = (room) => room.players.filter((p) => p.id !== room.guesser);

/**
 * Gives a bare player ({ kind, id, name }) the fields Just One keeps for everybody: the score and the statistics counters.
 *
 * @param {object} room   unused here (Wavelength needs it to pick a free colour); part of the shared makePlayer contract
 * @param {object} base   { kind: 'human' | 'bot', id, name? }
 * @returns {object} the player
 * Side effects: none.
 */
const makePlayer = (room, base) => ({ ...base, score: 0, ...newCounters() });
/**
 * The clue a writer has sent this turn.
 * @param {object} room  the room
 * @param {number | string} id  the writer's id
 * @returns {{ id: *, text: string } | undefined} their clue, or undefined if they have not sent one
 * Side effects: none.
 */
const clueOf = (room, id) => room.clues.find((c) => c.id === id);
/**
 * Have all the writers (everyone but the guesser) sent a clue?
 * @param {object} room  the room
 * @returns {boolean} true once the clues are all in
 * Side effects: none.
 */
const allWritten = (room) => writers(room).every((p) => clueOf(room, p.id));

/**
 * Makes a new room with the host in it.
 *
 * @param {object} args
 * @param {string} args.code        the invite code
 * @param {number} args.hostId      the host's account id
 * @param {string} [args.hostName]  the host's display name
 * @param {object} [args.settings]  settings the host chose when creating it ({ turnsEach }); invalid ones are ignored
 * @param {number} [args.turnsEach] turns each (default 2); `settings.turnsEach` wins if both are given
 * @param {number} args.now       the time to stamp it with
 * @returns {object} the room, in the lobby
 * Side effects: none outside the new room (an invalid setting is silently left at its default).
 */
export function createRoom({ code, hostId, hostName, settings = {}, now, turnsEach = TURNS_EACH.default }) {
  const room = {
    code,
    hostId,
    phase: 'lobby',
    turnsEach,
    turnsTotal: 0,
    turn: 0,
    players: [],
    nextIdx: 0,
    ready: [], // at the reveal: the people who have closed the scores pop-up
    nextBot: 1, // computer players are players with kind 'bot', an id 'bot:<n>', a name and (once started) an ai id
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
  room.players.push(makePlayer(room, typeof hostName === 'string' ? { kind: 'human', id: hostId, name: hostName } : { kind: 'human', id: hostId }));
  setSettings(room, hostId, settings); // a setting the host got wrong is simply left at its default
  return room;
}

/**
 * The lobby, joining, leaving and computer-player rules, from shared/roster.js. Somebody who leaves mid-game is replaced by
 * a computer player in their place, so no turn is lost (see takeOver).
 * Side effects: each rule it provides mutates the room's player list.
 */
const roster = createRosterRules({
  isLive,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  botNames: BOT_NAMES,
  makePlayer,
  takeOver,
});
export const { addHuman, removeHuman, addBot, removeBot, fillWithBots, kick } = roster;

/**
 * The host changes the settings. Only the settings that are given are changed.
 *
 * @param {object} room
 * @param {number} id        who is asking (must be the host)
 * @param {object} settings  { turnsEach? }
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: may change room.turnsEach (via setTurnsEach).
 */
export function setSettings(room, id, settings = {}) {
  if (settings.turnsEach === undefined) return hostInLobby(room, id) ?? ok();
  return setTurnsEach(room, id, settings.turnsEach);
}

/**
 * Just One has no "play again": a new game is made from the menu. (The shared room server offers the event to every game.)
 *
 * @returns {{ ok: false, error: string }}
 * Side effects: none.
 */
export function playAgain() {
  return fail('startFromMenu');
}

/**
 * The host changes how many turns each player gets.
 *
 * @param {object} room
 * @param {number} id          who is asking (must be the host)
 * @param {number} turnsEach   a whole number from TURNS_EACH.min to TURNS_EACH.max
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets room.turnsEach on success.
 */
export function setTurnsEach(room, id, turnsEach) {
  if (id !== room.hostId) return fail('hostOnlySettings');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (!Number.isInteger(turnsEach) || turnsEach < TURNS_EACH.min || turnsEach > TURNS_EACH.max) {
    return fail('turnsEach', { min: TURNS_EACH.min, max: TURNS_EACH.max });
  }
  room.turnsEach = turnsEach;
  return ok();
}

/**
 * Sets the room up for the next turn: the next player in order guesses, a word not yet used this game is drawn (the used list
 * is cleared if every word has been played), and the previous turn's clues and result are wiped.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the word
 * @returns {void}
 * Side effects: sets guesser, nextIdx, used, word, clues, cancelled, order, guess, best, result, ready and phase ('clues').
 */
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

/**
 * The host starts the game: works out how many turns there will be, picks the first guesser and the first word, and gives
 * every computer player an AI for the whole game.
 *
 * Side effects: changes the phase and everything a turn sets up (see startTurn); uses `rng` for the order, the word and the AIs.
 *
 * @param {object} room
 * @param {number} id            who is asking (must be the host)
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 * Side effects (restated): also sets turnsTotal, turn, used, and each computer player's `ai`.
 */
export function start(room, id, rng) {
  if (id !== room.hostId) return fail('hostOnlyStart');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (room.players.length < MIN_PLAYERS) return fail('minPlayers', { min: MIN_PLAYERS });
  room.turnsTotal = room.turnsEach * room.players.length;
  room.turn = 0;
  room.used = [];
  room.nextIdx = Math.floor(rng() * room.players.length);
  startTurn(room, rng);
  // Every computer player gets an AI for the whole game.
  const bots = room.players.filter(isBot);
  const picks = assignAIs(AIS, bots.map((p) => p.id), rng);
  for (const p of bots) p.ai = picks[p.id];
  return ok();
}

/**
 * Why a clue is not allowed for this word, or null. A clue must be a single word (letters, digits, apostrophes and hyphens),
 * and may not be the secret word or contain it or be contained in it (compared by normal(), so plurals count as the same).
 * The containment test only applies from three letters up so that short clues such as "a" or "it" are not wrongly refused.
 * @param {string} text  the trimmed clue
 * @param {string} word  the secret word
 * @returns {string | null} the refusal code (under `errors.`: 'clueOneWord' or 'clueIsTheWord'), or null if the clue is allowed
 * Side effects: none.
 */
export function clueProblem(text, word) {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}'’-]*$/u.test(text)) return 'clueOneWord';
  const clue = normal(text);
  const secret = normal(word);
  if (clue === secret || (clue.length >= 3 && (secret.includes(clue) || clue.includes(secret)))) return 'clueIsTheWord';
  return null;
}

/**
 * The writer's clue: one word. Once everybody has written theirs, matching clues are cancelled and the guessing begins.
 * @param {object} room  the room (mutated)
 * @param {number | string} id  the writer
 * @param {string} text  the clue as typed
 * @param {() => number} rng  random source (for the order the guesser sees the clues in)
 * @returns {{ ok: boolean, error?: string }} the result
 * Side effects: adds to room.clues; when the last clue arrives, runs openGuessing (cancelled, order, phase).
 */
export function submitClue(room, id, text, rng) {
  if (room.phase !== 'clues') return fail('cluesIn');
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (id === room.guesser) return fail('guesserNoClue');
  if (clueOf(room, id)) return fail('alreadyClued');
  const clean = textFrom(text).trim();
  if (!clean) return fail('typeClue');
  if (clean.length > CLUE_LENGTH) return fail('clueTooLong', { max: CLUE_LENGTH });
  const problem = clueProblem(clean, room.word);
  if (problem) return fail(problem);
  room.clues.push({ id, text: clean });
  if (allWritten(room)) openGuessing(room, rng);
  return ok();
}

/**
 * Cancels the clues that match each other and shows the rest to the guesser, in a shuffled order (so that the order does not
 * reveal who wrote what). Every clue in a matching group is cancelled, including the first, which is the Just One rule.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the shuffle (Fisher-Yates)
 * @returns {void}
 * Side effects: sets room.cancelled, room.order and room.phase ('guessing').
 */
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

/**
 * Do two texts count as the same word (ignoring case, punctuation and a plural s)?
 * @param {string} a  one text
 * @param {string} b  the other
 * @returns {boolean} true if normal() makes them equal
 * Side effects: none.
 */
const sameWord = (a, b) => normal(a) === normal(b);

/**
 * The guesser's one guess. If it is right and any clues are left they go on to pick the best hint.
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is guessing (must be the guesser)
 * @param {string} text  the guess as typed (whitespace collapsed, cut to GUESS_LENGTH)
 * @param {(id: *) => string} [nameOf]  name lookup for the history label
 * @returns {{ ok: boolean, error?: string }} the result
 * Side effects: sets room.guess; moves to 'choosing', or scores the turn (see scoreTurn) and opens the reveal.
 */
export function guess(room, id, text, nameOf = String) {
  if (room.phase !== 'guessing') return fail('notTimeToGuess');
  if (id !== room.guesser) return fail('guesserOnlyGuesses');
  const clean = textFrom(text).replace(/\s+/g, ' ').trim().slice(0, GUESS_LENGTH);
  if (!clean) return fail('typeGuess');
  const correct = sameWord(clean, room.word);
  room.guess = { text: clean, correct, passed: false };
  if (correct && room.order.length) room.phase = 'choosing';
  else scoreTurn(room, namer(room, nameOf));
  return ok();
}

/**
 * The guesser gives up on this word: nobody scores.
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is passing (must be the guesser)
 * @param {(id: *) => string} [nameOf]  name lookup for the history label
 * @returns {{ ok: boolean, error?: string }} the result
 * Side effects: sets room.guess as passed and scores the turn (history entry, reveal phase).
 */
export function pass(room, id, nameOf = String) {
  if (room.phase !== 'guessing') return fail('notTimeToGuess');
  if (id !== room.guesser) return fail('guesserOnlyPasses');
  room.guess = { text: '', correct: false, passed: true };
  scoreTurn(room, namer(room, nameOf));
  return ok();
}

/**
 * After a right guess, the guesser picks the best of the clues they saw (`n` is its place in their list, from 0).
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is choosing (must be the guesser)
 * @param {number} n  index into room.order
 * @param {(id: *) => string} [nameOf]  name lookup for the history label
 * @returns {{ ok: boolean, error?: string }} the result
 * Side effects: sets room.best and scores the turn (scores, counters, history, reveal phase).
 */
export function chooseBest(room, id, n, nameOf = String) {
  if (room.phase !== 'choosing') return fail('noBestYet');
  if (id !== room.guesser) return fail('guesserOnlyPicks');
  if (!Number.isInteger(n) || n < 0 || n >= room.order.length) return fail('pickAHint');
  room.best = room.order[n];
  scoreTurn(room, namer(room, nameOf));
  return ok();
}

/**
 * Scores the turn and opens the reveal: two points to the guesser for a right guess and one to the writer of the best hint.
 * A guesser or best-hint writer who has left simply scores nothing (the lookups return undefined).
 * @param {object} room  the room (mutated)
 * @param {(id: *) => string} [nameOf]  name lookup for the history label
 * @returns {void}
 * The history entry's label and notes are messages (shared/messages.js), put into words by the client.
 * Side effects: changes scores, bumps statistics counters (tallyTurn), sets room.result, pushes room.history, clears ready and sets phase 'reveal'.
 */
function scoreTurn(room, nameOf = String) {
  const guesser = playerOf(room, room.guesser);
  const best = room.best === null ? null : playerOf(room, room.best);
  const deltas = {};
  const notes = {};
  const correct = Boolean(room.guess?.correct);
  if (guesser) {
    if (correct) {
      guesser.score += POINTS.guesser;
      deltas[guesser.id] = POINTS.guesser;
    } else deltas[guesser.id] = 0;
    notes[guesser.id] = msg(correct ? 'notes.guessedIt' : room.guess?.passed ? 'notes.passed' : 'notes.missed');
  }
  if (best) {
    best.score += POINTS.bestHint;
    deltas[best.id] = POINTS.bestHint;
    notes[best.id] = msg('notes.bestHint');
  }
  tallyTurn({ guesser, best, correct, clues: room.clues.map((c) => ({ writer: playerOf(room, c.id), cancelled: room.cancelled.includes(c.id) })) });
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
  room.history.push({ label: msg('scoreboard.turn', { n: room.turn + 1, name: nameOf(room.guesser) }), deltas, notes });
  room.ready = [];
  room.phase = 'reveal';
}

/**
 * Brings a saved room up to date: players saved with `bot: true` become `kind: 'bot'` (and people saved without a name get
 * one from `nameOf`), and fields added since are filled in.
 *
 * Side effect: mutates the room. Running it twice changes nothing more.
 *
 * @param {object} room
 * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
 * @returns {object} the same room
 * Side effects: mutates the room (as described above).
 */
export function migrate(room, nameOf) {
  migratePlayers(room, nameOf);
  room.used ??= [];
  room.order ??= [];
  room.cancelled ??= [];
  room.ready ??= []; // ready() reads it unguarded
  if (!Array.isArray(room.history)) room.history = [];
  return room;
}

/**
 * Ends the reveal: counts the turn and either finishes the game or starts the next turn.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the next word
 * @returns {boolean} true if that was the last turn and the game is now finished
 * Side effects: increments room.turn, clears ready, and sets phase 'finished' or sets up the next turn (startTurn).
 */
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

/**
 * The people who have yet to close the scores at the reveal (computer players never need to).
 * @param {object} room  the room
 * @returns {object[]} the humans not in room.ready
 * Side effects: none.
 */
const unready = (room) => humans(room).filter((p) => !room.ready.includes(p.id));

/**
 * At the reveal, a person has closed the scores pop-up and is ready for the next turn; when everybody has, the turn ends.
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is ready
 * @param {() => number} rng  random source for the next word
 * @returns {{ ok: boolean, error?: string, finished?: boolean }} finished is true if the game is over
 * Side effects: adds to room.ready, and may move on to the next turn or finish the game (finishTurn).
 */
export function ready(room, id, rng) {
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (room.phase !== 'reveal') return fail('noScoresToClose');
  if (!room.ready.includes(id)) room.ready.push(id);
  return ok({ finished: unready(room).length === 0 ? finishTurn(room, rng) : false });
}

/**
 * Moves on from the reveal whether or not everyone has closed the pop-up (the server does this after a wait).
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the next word
 * @returns {{ ok: boolean, error?: string, finished?: boolean }} finished is true if the game is over
 * Side effects: as finishTurn.
 */
export function forceNext(room, rng) {
  if (room.phase !== 'reveal') return fail('nothingToMoveOn');
  return ok({ finished: finishTurn(room, rng) });
}

/**
 * True while the reveal waits for people to close the scores (the server times this out).
 * @param {object} room  the room
 * @returns {boolean} whether the room is at the reveal
 * Side effects: none.
 */
export const waitingForReady = (room) => room.phase === 'reveal';

/**
 * Just One's part of a computer player taking the place of a person who left a game under way (the roster has already put
 * it in the list, with the person's score and counters): it gets an AI, everything that named the person now names it
 * (their turn as guesser, their clue, the guesser's list, the ready list, the history), and if the reveal was only waiting
 * for that person the next turn starts. Anything it now has to do (write a clue, guess) is picked up by pendingBotAction.
 *
 * Side effects: mutates the room (the bot, guesser, clues, cancelled, order, best, ready, result, history) and may start the next turn.
 *
 * @param {object} room
 * @param {number} oldId  the account id of the person who left
 * @param {object} bot    the computer player now in their place
 * @param {() => number} rng
 * @returns {void}
 */
function takeOver(room, oldId, bot, rng) {
  bot.ai = pickAI(AIS, rng).id;
  const renamed = (x) => (x === oldId ? bot.id : x);
  room.guesser = renamed(room.guesser);
  room.best = renamed(room.best);
  for (const clue of room.clues) clue.id = renamed(clue.id);
  room.cancelled = room.cancelled.map(renamed);
  room.order = room.order.map(renamed);
  room.ready = (room.ready ?? []).filter((x) => x !== oldId); // a computer player is always ready, so it needs no entry
  if (room.result) {
    room.result.guesser = renamed(room.result.guesser);
    room.result.best = renamed(room.result.best);
    for (const clue of room.result.clues) clue.id = renamed(clue.id);
  }
  renameInHistory(room, oldId, bot.id);
  if (room.phase === 'reveal' && unready(room).length === 0) finishTurn(room, rng);
}

/**
 * Players best first; tied scores share a placement and every tied leader wins.
 *
 * @param {object} room  not changed
 * @returns {object[]} copies of the players with `placement` and `winner`
 * Side effects: none.
 */
export function standings(room) {
  return standingsOf(room.players);
}

/**
 * The statistics for a finished game, in the shape of ctx.stats.record. Computer players are not accounts: people only.
 *
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}
 * Side effects: none.
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
 * The clues a viewer may see. While the clues are being written a writer sees only their own; the guesser sees the clues that
 * were not cancelled, without their writers; everybody else sees every clue with its writer and whether it was cancelled (the
 * cancelled ones too); after the reveal everybody sees the lot.
 *
 * @param {object} room  not changed
 * @param {number} userId  the viewer
 * @param {(id: number) => string} nameOf  a player's name
 * @returns {object[]} the clue entries to show that viewer
 * Side effects: none.
 */
function cluesView(room, userId, nameOf) {
  const member = hasPlayer(room, userId);
  const isGuesser = room.guesser === userId;
  const revealed = ['reveal', 'finished'].includes(room.phase);
  const textOf = (id) => clueOf(room, id)?.text ?? '';
  if (room.phase === 'clues' && member && !isGuesser && clueOf(room, userId)) return [{ id: userId, name: nameOf(userId), text: textOf(userId), own: true }];
  if (['guessing', 'choosing'].includes(room.phase) && isGuesser) return room.order.map((id, n) => ({ n, text: textOf(id) }));
  if (['guessing', 'choosing'].includes(room.phase) && member) {
    const left = room.order.map((id) => ({ id, name: nameOf(id), text: textOf(id), cancelled: false }));
    return [...left, ...room.cancelled.map((id) => ({ id, name: nameOf(id), text: textOf(id), cancelled: true }))];
  }
  if (revealed && room.result) return room.result.clues.map((c) => ({ ...c, name: nameOf(c.id) }));
  return [];
}

/**
 * The result of the turn just scored, with the names filled in (only once it is revealed).
 *
 * @param {object} room  not changed
 * @param {(id: number) => string} nameOf  a player's name
 * @returns {object | null} the result, or null before the reveal
 * Side effects: none.
 */
function resultView(room, nameOf) {
  const revealed = ['reveal', 'finished'].includes(room.phase);
  if (!(revealed && room.result)) return null;
  return { ...room.result, guesserName: nameOf(room.result.guesser), bestName: room.result.best === null ? null : nameOf(room.result.best) };
}

/**
 * One player as the table shows them to everybody.
 *
 * @param {object} room  not changed
 * @param {object} p  the player
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean, final: Map<number, object> }} context
 * @returns {object} the player entry for the view
 * Side effects: none.
 */
function playerView(room, p, { nameOf, online, final }) {
  return {
    id: p.id,
    name: nameOf(p.id),
    score: p.score,
    online: isBot(p) || online(p.id),
    bot: isBot(p), // the client's name for "is a computer player"
    ai: isBot(p) && p.ai ? describeAI(aiById(AIS, p.ai)) : null, // computer players only, once a game has started
    written: room.phase === 'clues' && p.id !== room.guesser ? Boolean(clueOf(room, p.id)) : false,
    ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : false,
    placement: final.get(p.id)?.placement ?? null,
    winner: final.get(p.id)?.winner ?? false,
  };
}

/**
 * The standard scoreboard (shared/scores.js): whoever the game is waiting for is `current` (the site's `global.slow`
 * clock reads it), and while the results are up each player shows whether they are ready to go on.
 *
 * @param {object} room  not changed
 * @param {number} userId  the viewer
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean }} context
 * @returns {object} the scoreboard for the view
 * Side effects: none.
 */
function scoreboardView(room, userId, { nameOf, online }) {
  // `current` marks who the game is waiting for: the writers still to write a clue, then the guesser.
  const mustAct = (p) => (room.phase === 'clues' ? p.id !== room.guesser && !clueOf(room, p.id) : ['guessing', 'choosing'].includes(room.phase) && p.id === room.guesser);
  const player = (p) => playerScoreboardEntry(p, { name: nameOf(p.id), me: userId, current: mustAct(p), online, ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : undefined });
  return {
    players: room.players.map(player),
    rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })),
    lowIsBetter: false,
  };
}

/**
 * What one person may see. The guesser never sees the word until the reveal, and sees only the clues that were not cancelled
 * (without their writers). Everyone else sees the word, and, once all the clues are in, every clue with its writer and
 * whether it was cancelled. While the clues are being written nobody sees anybody else's.
 *
 * @param {object} room  not changed
 * @param {number} userId  the account looking
 * @param {{ nameOf?: (id: number) => string, online?: (id: number) => boolean }} [options]  names for players who have left, and who is connected
 * @returns {object} the view sent to that person
 * Side effects: none.
 */
export function viewFor(room, userId, { nameOf = String, online = () => true } = {}) {
  nameOf = namer(room, nameOf);
  const isGuesser = room.guesser === userId;
  const playing = PLAYING.includes(room.phase);
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
    guesser: room.guesser,
    word: revealed || (playing && hasPlayer(room, userId) && !isGuesser) ? room.word : null,
    clues: cluesView(room, userId, nameOf),
    guess: room.guess,
    result: resultView(room, nameOf),
    points: POINTS,
    players: room.players.map((p) => playerView(room, p, { nameOf, online, final })),
    scoreboard: scoreboardView(room, userId, { nameOf, online }),
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, turns: TURNS_EACH },
  };
}

// ---------- computer players ----------

/**
 * The next thing a computer player has to do, or null: { type: 'clue' | 'guess' | 'best', id }. Computer players never move on
 * from the reveal: that is up to the people (or the server's timeout).
 * @param {object} room  the room (not changed)
 * @returns {{ type: 'clue' | 'guess' | 'best', id: number | string } | null} the action, or null if no computer player is waiting
 * Side effects: none.
 */
export function pendingBotAction(room) {
  if (room.phase === 'clues') {
    const writer = writers(room).find((p) => isBot(p) && !clueOf(room, p.id));
    return writer ? { type: 'clue', id: writer.id } : null;
  }
  const guesser = playerOf(room, room.guesser);
  if (!isBot(guesser)) return null;
  if (room.phase === 'guessing') return { type: 'guess', id: guesser.id };
  if (room.phase === 'choosing') return { type: 'best', id: guesser.id };
  return null;
}

/**
 * Plays one pending computer move. The decision is made from that seat's own view (viewFor), so a computer guesser never sees
 * the word. An AI that throws or answers with something illegal is replaced by a legal choice.
 * @param {object} room  the room (mutated by the move played)
 * @param {() => number} rng  random source handed to the AI
 * @param {object | null} [action]  the move to play (default: pendingBotAction)
 * @param {(id: *) => string} [nameOf]  name lookup for history labels
 * @returns {boolean} true if a move was played successfully
 * Side effects: plays the move (submitClue, guess/pass or chooseBest) and so changes the room as they do.
 */
export function runBotAction(room, rng, action = pendingBotAction(room), nameOf = String) {
  if (!action) return false;
  const player = playerOf(room, action.id);
  const ai = aiById(AIS, player.ai);
  const view = viewFor(room, action.id, { nameOf });
  // Runs an AI decision, turning a throw into undefined so that the fallbacks below take over.
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
