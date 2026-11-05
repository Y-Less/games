// The rules of Trivium, with no sockets, no files and no network.  A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// A round: the wheel is spun for a category, weighted by how many questions there are of each (./wheel.js), and then
// the round's questions are asked one at a time.  Nothing waits for anybody - a question is up for `answerMs` and then
// it closes, whoever has answered - so the whole game runs on the clock and never on a pop-up somebody has to dismiss.
//
// Every answer is recorded with *where* on the button it was tapped and *when*, because both are part of the game: the
// order the answers arrived in decides the speed bonus (./scoring.js), and the reveal walks the table through the
// answers in that order, each player's marker travelling from their name to the spot their finger landed on.
//
// The questions themselves are not in here: shared/trivia.js is a door to the network, so server.js fetches a round's
// questions and hands them to `deal`, just as Scribblers fetches a picture for its computer players to draw.
//
// Depends on: shared/ (scores, tally, ai, markerColours, seats, roster, input, messages) for the common room rules,
// ./ai (computer players), ./wheel.js (the spinner), ./scoring.js (what a question is worth) and ./tally.js (the
// statistics counters).  Sockets, timers and saving are not here: server.js drives these rules through
// shared/roomServer.js.
import { numberFrom } from '../../shared/input.js';
import { finalStandings, playerScoreboardEntry, standingsOf } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { MARKER_COLOURS, markerProblem, normaliseMarker, startingMarker } from '../../shared/markerColours.js';
import { msg } from '../../shared/messages.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { createRosterRules, hasPlayer, humans, isBot, isHuman, migratePlayers, renameInHistory, seatOf } from '../../shared/roster.js';
import { AIS } from './ai/index.js';
import { MAX_QUESTION_POINTS, pointsFor } from './scoring.js';
import { buildWheel, pickSpin } from './wheel.js';
import { newCounters, statsExtras, tallyQuestion, tallyRound } from './tally.js';

/** The fewest people that can play: a quiz wants somebody to be quicker than. */
export const MIN_PLAYERS = 2;
/** The most people in a room (the marker palette and the name row only have room for so many). */
export const MAX_PLAYERS = 8;
/** How many rounds a game may be played over, and how many it is by default. */
export const ROUNDS = { min: 1, max: 8, default: 3 };
/** How many questions a round may hold, and how many it holds by default. */
export const PER_ROUND = { min: 1, max: 10, default: 5 };
/** How long a question is up for, in milliseconds. */
export const ANSWER_MS = 15000;
/** How long the wheel turns for before it stops, in milliseconds. */
export const SPIN_MS = 5000;
/** How long the reveal takes over each answer, in milliseconds. */
export const REVEAL_STEP_MS = 500;
/** How long the right answer stays up once every marker has landed, in milliseconds. */
export const REVEAL_HOLD_MS = 3000;
/** How late in the time allowed a computer player may leave its answer (as a fraction), so one never misses by rounding. */
const BOT_PACE = { least: 0.02, most: 0.96 };
/** The free marker palette; any other colour is a shop unlock (shared/markerColours.js). */
export const COLOURS = MARKER_COLOURS;
export { MAX_QUESTION_POINTS, RIGHT_POINTS, SPEED_BONUS } from './scoring.js';

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana'];
/** The phases of a game that is still going (or not yet started). */
const LIVE = ['lobby', 'spin', 'question', 'reveal'];
/** The phases in which the question and everybody's answers are out in the open. */
const SHOWN = ['reveal', 'finished'];

// The player-list vocabulary (who is in the room, and who is a person) is shared with Just One and Wavelength.
export { hasPlayer, humans, isHuman, seatOf };

/**
 * Is the game still going (or still in the lobby)?
 *
 * @param {object} room  the room to look at
 * @returns {boolean} false once it has finished or been abandoned
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);

/**
 * The player with this id, or undefined.
 *
 * @param {object} room  the room to search
 * @param {number|string} id  the player id (an account id, or 'bot:<n>')
 * @returns {object|undefined} the player
 * Side effects: none.
 */
const playerOf = (room, id) => room.players.find((p) => p.id === id);

/**
 * A function giving a player's name: the name saved with them, else `nameOf` (only rooms saved long ago lack names).
 *
 * @param {object} room  the room whose players are searched
 * @param {(id: number) => string} nameOf  fallback lookup, such as the account's display name
 * @returns {(id: number|string) => string} the lookup
 * Side effects: none.
 */
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);

/**
 * Gives a bare player ({ kind, id, name }) the fields Trivium keeps for everybody: their score, their counters, their
 * marker colour, how many of this game's questions they have got right, and the answer their computer player means to
 * give (nothing, for a person).
 *
 * @param {object} room  the room the player is about to join (read for the colours already taken; not changed)
 * @param {object} base  { kind: 'human' | 'bot', id, name? }
 * @param {{ colour?: string | null }} [extras]  what the server knows about a person joining
 * @returns {object} the player
 * Side effects: none (the room is only read).
 */
const makePlayer = (room, base, extras = {}) => ({
  ...base,
  colour: isBot(base) ? freeColour(room) : startingMarker(extras.colour ?? null, room.players.map((p) => p.colour), true),
  score: 0,
  rightThisGame: 0,
  plan: null, // computer players only: the answer they mean to give to the question that is up
  ...newCounters(),
});

/**
 * The first palette colour no player has yet.
 *
 * @param {object} room  the room whose players are looked at
 * @returns {string|undefined} a free colour (undefined only with more players than colours, which MAX_PLAYERS prevents)
 * Side effects: none.
 */
const freeColour = (room) => COLOURS.find((c) => !room.players.some((p) => p.colour === c));

/**
 * Has this player answered the question that is up?
 *
 * @param {object} room  the room to look at
 * @param {number|string} id  the player
 * @returns {boolean}
 * Side effects: none.
 */
const hasAnswered = (room, id) => room.answers.some((a) => a.id === id);

/**
 * Is there nobody left to answer?
 *
 * @param {object} room  the room to look at
 * @returns {boolean}
 * Side effects: none.
 */
const allAnswered = (room) => room.players.every((p) => hasAnswered(room, p.id));

/**
 * How long the reveal of the question just closed lasts: a step for each answer, one more before the right answer is
 * shown, and then the hold while everybody reads it.
 *
 * @param {object} room  the room, with its answers in
 * @returns {number} milliseconds
 * Side effects: none.
 */
const revealLength = (room) => (room.answers.length + 1) * room.revealStep + room.revealHold;

/**
 * Makes a new room with the host in it.
 *
 * @param {object} args
 * @param {string} args.code  the invite code
 * @param {number} args.hostId  the host's account id
 * @param {string} [args.hostName]  the host's display name
 * @param {object} [args.settings]  settings the host chose when creating it ({ rounds, perRound }); bad ones are ignored
 * @param {string | null} [args.colour]  the host's default marker colour, already checked (ctx.markers.preferred)
 * @param {Record<string, number>} [args.counts]  how many questions there are of each category, for the wheel
 * @param {number} [args.answerMs]  how long a question is up for
 * @param {number} [args.spinMs]  how long the wheel turns for
 * @param {number} [args.revealStep]  how long the reveal takes over each answer
 * @param {number} [args.revealHold]  how long the right answer stays up afterwards
 * @param {number} args.now  the time to stamp it with
 * @returns {object} the room, in the lobby
 * Side effects: none outside the new room (it is built and returned, not stored).
 */
export function createRoom({ code, hostId, hostName, settings = {}, colour = null, counts = {}, answerMs = ANSWER_MS, spinMs = SPIN_MS, revealStep = REVEAL_STEP_MS, revealHold = REVEAL_HOLD_MS, now }) {
  const room = {
    code,
    hostId,
    phase: 'lobby',
    rounds: ROUNDS.default,
    perRound: PER_ROUND.default,
    round: 0, // which round is being played, counting from zero
    ask: 0, // which question of that round is up, counting from zero
    players: [],
    nextBot: 1, // computer players are players with kind 'bot', an id 'bot:<n>', a name, and (once started) an ai id
    wheel: buildWheel(counts),
    spin: null, // { category, angle }: what the wheel picked this round and where it stopped
    spinUntil: 0,
    deck: [], // the rest of this round's questions, never sent to anybody
    question: null, // the one that is up: { id, text, answers, correct, category, difficulty }
    askedAt: 0,
    deadline: 0,
    answers: [], // { id, choice, x, y, at }: who answered what, where they tapped, and how long they took
    result: null, // the question just closed, once it has been scored
    revealAt: 0,
    revealUntil: 0,
    roundScored: {}, // what each player has scored in this round, for the round counters
    roundRight: {}, // how many of this round's questions each player has got right
    answerMs,
    spinMs,
    revealStep,
    revealHold,
    history: [],
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
  room.players.push(makePlayer(room, typeof hostName === 'string' ? { kind: 'human', id: hostId, name: hostName } : { kind: 'human', id: hostId }, { colour }));
  setSettings(room, hostId, settings); // a setting the host got wrong is simply left at its default
  return room;
}

/**
 * The lobby, joining, leaving and computer-player rules, from shared/roster.js.  Somebody who leaves mid-game is
 * replaced by a computer player in their place, so no answer is lost (see takeOver).
 */
const roster = createRosterRules({
  isLive,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  botNames: BOT_NAMES,
  makePlayer,
  takeOver,
});
/** addHuman(room, userId, name, { colour }) takes the person's preferred marker colour in its last argument. */
export const { addHuman, removeHuman, addBot, removeBot, fillWithBots, kick } = roster;

/**
 * Trivium has no "play again": a new game is made from the menu.  (The shared room server offers the event to every game.)
 *
 * @returns {{ ok: false, error: string }} always a refusal
 * Side effects: none.
 */
export function playAgain() {
  return fail('startFromMenu');
}

/**
 * The host changes the settings.  Only the settings that are given are changed.
 *
 * @param {object} room  the room (must be in the lobby)
 * @param {number} id  who is asking (must be the host)
 * @param {object} settings  { rounds?, perRound? }
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets room.rounds and/or room.perRound; if the first is accepted and the second refused, the first stays changed.
 */
export function setSettings(room, id, settings = {}) {
  if (settings.rounds === undefined && settings.perRound === undefined) return hostInLobby(room, id) ?? ok();
  if (settings.rounds !== undefined) {
    const outcome = setNumber(room, id, 'rounds', settings.rounds, ROUNDS, 'roundsRange');
    if (!outcome.ok) return outcome;
  }
  return settings.perRound === undefined ? ok() : setNumber(room, id, 'perRound', settings.perRound, PER_ROUND, 'perRoundRange');
}

/**
 * The host sets one of the two whole-number settings.
 *
 * @param {object} room  the room (must be in the lobby)
 * @param {number} id  who is asking (must be the host)
 * @param {string} field  the room field to set
 * @param {unknown} value  what the client sent
 * @param {{ min: number, max: number }} limits  the range it must be in
 * @param {string} code  the refusal to give when it is not
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets room[field].
 */
function setNumber(room, id, field, value, limits, code) {
  const refused = hostInLobby(room, id);
  if (refused) return refused;
  const wanted = numberFrom(value);
  if (!Number.isInteger(wanted) || wanted < limits.min || wanted > limits.max) return fail(code, { min: limits.min, max: limits.max });
  room[field] = wanted;
  return ok();
}

/**
 * A player picks their marker colour in the lobby.
 *
 * @param {object} room  the room (must be in the lobby)
 * @param {number} id  the player choosing
 * @param {string} colour  the wanted colour
 * @param {boolean} [canCustom]  this player has unlocked any marker colour (otherwise only the free palette)
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 * Side effects: changes the player's colour (only if it is allowed and nobody else has it).
 */
export function setColour(room, id, colour, canCustom = false) {
  const player = playerOf(room, id);
  if (!player) return fail('notInGame');
  if (room.phase !== 'lobby') return fail('coloursBeforeStart');
  const problem = markerProblem(colour, room.players.filter((p) => p.id !== id).map((p) => p.colour), canCustom);
  if (problem) return fail(problem);
  player.colour = normaliseMarker(colour);
  return ok();
}

/**
 * The server has counted the questions each category holds, so the wheel can be cut to match.  It is only worth doing
 * in the lobby: once the game has started the wheel the players have been looking at is the wheel they get.
 *
 * @param {object} room  the room (only changed while it is in the lobby)
 * @param {Record<string, number>} counts  how many questions there are of each category
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: replaces room.wheel.
 */
export function setWheel(room, counts) {
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  room.wheel = buildWheel(counts);
  return ok();
}

/**
 * The host starts the game: every computer player is given an AI for the whole game, and the first wheel is spun.
 *
 * @param {object} room  the room (must be in the lobby)
 * @param {number} id  who is asking (must be the host)
 * @param {() => number} rng  random source for the AIs and the spin
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: changes the phase and everything a round sets up (see beginRound); uses `rng`.
 */
export function start(room, id, rng, now) {
  if (id !== room.hostId) return fail('hostOnlyStart');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (room.players.length < MIN_PLAYERS) return fail('minPlayers', { min: MIN_PLAYERS });
  room.round = 0;
  room.ask = 0;
  room.history = [];
  for (const p of room.players) p.rightThisGame = 0;
  const bots = room.players.filter(isBot);
  const picks = assignAIs(AIS, bots.map((p) => p.id), rng);
  for (const p of bots) p.ai = picks[p.id];
  beginRound(room, rng, now);
  return ok();
}

/**
 * Starts a round: the wheel is spun, and the questions it picked are asked for (by the server, which then calls `deal`).
 *
 * @param {object} room  the room
 * @param {() => number} rng  random source for the spin
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: sets the phase to 'spin' and clears the round's questions, answers and counters.
 */
function beginRound(room, rng, now) {
  room.phase = 'spin';
  room.ask = 0;
  room.spin = pickSpin(room.wheel, rng);
  room.spinUntil = now + room.spinMs;
  room.deck = [];
  room.question = null;
  room.answers = [];
  room.result = null;
  room.askedAt = 0;
  room.deadline = 0;
  room.revealAt = 0;
  room.revealUntil = 0;
  room.roundScored = {};
  room.roundRight = {};
  for (const p of room.players) p.plan = null;
}

/**
 * The server hands over the questions the wheel's category was asked for.  They are kept out of every view until each
 * one is its turn to be asked.
 *
 * @param {object} room  the room (must be waiting on the wheel, with no questions yet)
 * @param {object[]} questions  as shared/trivia.js prepares them: { id, question, answers, correct, category, difficulty }
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: fills room.deck.
 */
export function deal(room, questions) {
  if (room.phase !== 'spin') return fail('notSpinning');
  if (room.deck.length) return fail('alreadyDealt');
  const kept = (Array.isArray(questions) ? questions : [])
    .filter((q) => q && typeof q.question === 'string' && Array.isArray(q.answers) && q.answers.length > 1 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.answers.length)
    .slice(0, room.perRound)
    .map((q) => ({
      id: String(q.id ?? q.question),
      text: q.question,
      answers: q.answers.map(String),
      correct: q.correct,
      category: String(q.category ?? room.spin?.category ?? ''),
      difficulty: String(q.difficulty ?? ''),
    }));
  if (!kept.length) return fail('triviaUnavailable');
  room.deck = kept;
  return ok();
}

/**
 * Puts the next question of the round up, which also settles what every computer player means to answer and when.
 *
 * @param {object} room  the room (must be waiting on the wheel, with its questions in)
 * @param {() => number} rng  random source for the computer players
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: moves a question out of the deck, sets the phase to 'question' and the deadline, and plans the bots.
 */
export function askNext(room, rng, now) {
  if (room.phase !== 'spin') return fail('notSpinning');
  if (!room.deck.length) return fail('noQuestionReady');
  room.question = room.deck.shift();
  room.askedAt = now;
  room.deadline = now + room.answerMs;
  room.answers = [];
  room.result = null;
  room.revealAt = 0;
  room.revealUntil = 0;
  planBots(room, rng);
  return ok();
}

/**
 * Works out what each computer player will answer, and how long it will take about it, the moment the question goes
 * up: a decision made once from plain data, which the server then simply plays out on the clock.
 *
 * @param {object} room  the room, with a question up
 * @param {() => number} rng  random source handed to each AI
 * @returns {void}
 * Side effects: sets `plan` on every computer player (null for one that means to let this question go by), and sets
 *   the phase to 'question'.
 */
function planBots(room, rng) {
  for (const player of room.players) {
    player.plan = null;
    if (!isBot(player)) continue;
    const ai = aiById(AIS, player.ai);
    let choice;
    try {
      choice = ai.answer(botContext(room), rng);
    } catch {
      choice = null; // a broken AI simply does not answer; it must not stop the game
    }
    if (!choice) continue;
    const index = Number.isInteger(choice.choice) && choice.choice >= 0 && choice.choice < room.question.answers.length ? choice.choice : 0;
    const spot = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5);
    const speed = typeof choice.speed === 'number' && Number.isFinite(choice.speed) ? Math.min(BOT_PACE.most, Math.max(BOT_PACE.least, choice.speed)) : 0.5;
    player.plan = { choice: index, x: round3(spot(choice.x)), y: round3(spot(choice.y)), wait: Math.round(speed * room.answerMs) };
  }
  room.phase = 'question';
}

/**
 * What a computer player is told about the question.  It includes which answer is right, and deliberately so: see the
 * head of ai/judgement.js, where that is turned back into a player who sometimes knows and sometimes does not.
 *
 * @param {object} room  the room, with a question up
 * @returns {object} the context for an AI
 * Side effects: none.
 */
const botContext = (room) => ({
  question: room.question.text,
  answers: [...room.question.answers],
  correct: room.question.correct,
  category: room.question.category,
  difficulty: room.question.difficulty,
  answerMs: room.answerMs,
});

/**
 * Rounds to three decimal places, so a tap stored with a room stays short and compares reliably.
 *
 * @param {number} n  any number
 * @returns {number} n to the nearest thousandth
 * Side effects: none.
 */
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Somebody answers: which button, where on it their finger landed, and (from the clock) how long they took.  The
 * first answer is the one that counts - there is no changing your mind, because the time it arrived is half its worth.
 *
 * @param {object} room  the room (must have a question up)
 * @param {number|string} id  who is answering
 * @param {unknown} choice  which answer, as the client sent it
 * @param {unknown} x  across the button, 0 at the left edge and 1 at the right
 * @param {unknown} y  down the button, 0 at the top and 1 at the bottom
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 * Side effects: adds to room.answers; closes and scores the question when it was the last one due.
 */
export function answer(room, id, choice, x, y, now) {
  if (room.phase !== 'question') return fail('noQuestionUp');
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (hasAnswered(room, id)) return fail('alreadyAnswered');
  const index = numberFrom(choice);
  if (!Number.isInteger(index) || index < 0 || index >= room.question.answers.length) return fail('notAnAnswer');
  const across = numberFrom(x);
  const down = numberFrom(y);
  if (!Number.isFinite(across) || !Number.isFinite(down) || across < 0 || across > 1 || down < 0 || down > 1) return fail('tapOnTheButton');
  room.answers.push({ id, choice: index, x: round3(across), y: round3(down), at: Math.max(0, now - room.askedAt) });
  if (allAnswered(room)) closeQuestion(room, now);
  return ok();
}

/**
 * The time is up: the question closes with whatever answers are in.
 *
 * @param {object} room  the room (must have a question up)
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: scores the question (see closeQuestion).
 */
export function timeUp(room, now) {
  if (room.phase !== 'question') return fail('noQuestionUp');
  closeQuestion(room, now);
  return ok();
}

/**
 * Scores the question and opens the reveal.  Every correct answer is worth the same for being right; the speed bonus
 * is shared out among them in the order they arrived, so the quickest right answer is worth twice the slowest.
 *
 * @param {object} room  the room, with its answers in
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: adds points to the players, updates the counters, sets room.result, appends to room.history, and
 *   moves the phase to 'reveal'.
 */
function closeQuestion(room, now) {
  const correct = room.question.correct;
  let place = 0;
  const entries = room.answers.map((given) => {
    const right = given.choice === correct;
    const points = pointsFor(right, right ? place++ : 0);
    const player = playerOf(room, given.id);
    if (player) {
      player.score += points;
      if (right) player.rightThisGame++;
      room.roundScored[given.id] = (room.roundScored[given.id] ?? 0) + points;
      if (right) room.roundRight[given.id] = (room.roundRight[given.id] ?? 0) + 1;
    }
    return { ...given, right, points };
  });
  const missed = room.players.filter((p) => !hasAnswered(room, p.id)).map((p) => p.id);
  tallyQuestion(entries, missed, (id) => playerOf(room, id));
  room.result = { correct, category: room.question.category, entries, missed };
  recordHistory(room);
  room.revealAt = now;
  room.revealUntil = now + revealLength(room);
  room.phase = 'reveal';
}

/**
 * Appends the question just closed to room.history (the standard round shape of shared/scores.js), whose label and
 * notes are messages for the client to put into words (shared/messages.js).  It only happens once the question has
 * been scored, so the history never shows anything the players have yet to see.
 *
 * @param {object} room  the room, with room.result set
 * @returns {void}
 * Side effects: pushes one round onto room.history.
 */
function recordHistory(room) {
  const deltas = {};
  const notes = {};
  const [first] = room.result.entries.filter((e) => e.right);
  for (const entry of room.result.entries) {
    deltas[entry.id] = entry.points;
    notes[entry.id] = msg(entry === first ? 'notes.first' : entry.right ? 'notes.right' : 'notes.wrong');
  }
  for (const id of room.result.missed) {
    deltas[id] = 0;
    notes[id] = msg('notes.missed');
  }
  room.history.push({ label: msg('questionLabel', { round: room.round + 1, n: room.ask + 1 }), deltas, notes });
}

/**
 * Moves on from the reveal: the next question of the round, the next round's wheel, or the end of the game.
 *
 * @param {object} room  the room (must be at the reveal)
 * @param {() => number} rng  random source for the next spin and the next question's computer players
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string, finished?: boolean }} ok with whether the game finished, or why not
 * Side effects: counts the round when it ends, then starts the next question or round, or finishes the game.
 */
export function nextQuestion(room, rng, now) {
  if (room.phase !== 'reveal') return fail('nothingToMoveOn');
  room.ask++;
  room.question = null;
  room.answers = [];
  if (room.ask < room.perRound && room.deck.length) {
    room.phase = 'spin'; // the wheel is not turned again: askNext takes the next question of the same category
    room.spinUntil = now;
    const outcome = askNext(room, rng, now);
    return outcome.ok ? ok({ finished: false }) : outcome;
  }
  tallyRound(room.players, room.roundScored, room.roundRight, room.ask);
  room.round++;
  if (room.round >= room.rounds) {
    room.phase = 'finished';
    room.result = null;
    return ok({ finished: true });
  }
  beginRound(room, rng, now);
  return ok({ finished: false });
}

/**
 * There are no questions to be had (the API is down and the site's own bank is empty).  A game that has asked
 * something is ended on the scores it has; one that has not is abandoned, and so is not recorded at all.
 *
 * @param {object} room  the room
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: counts the part-round, then sets the phase to 'finished' or 'abandoned'.
 */
export function giveUp(room) {
  if (!isLive(room) || room.phase === 'lobby') return fail('nothingToMoveOn');
  if (room.history.length) {
    tallyRound(room.players, room.roundScored, room.roundRight, room.ask);
    room.phase = 'finished';
  } else room.phase = 'abandoned';
  room.question = null;
  room.deck = [];
  room.result = null;
  return ok();
}

/**
 * Brings a saved room up to date: players saved with `bot: true` become `kind: 'bot'` (and people saved without a name
 * get one from `nameOf`), and fields added since are filled in.
 *
 * @param {object} room  the saved room
 * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
 * @returns {object} the same room
 * Side effects: mutates the room.  Running it twice changes nothing more.
 */
export function migrate(room, nameOf) {
  migratePlayers(room, nameOf);
  room.wheel = Array.isArray(room.wheel) && room.wheel.length ? room.wheel : buildWheel({});
  room.deck ??= [];
  room.answers ??= [];
  room.roundScored ??= {};
  room.roundRight ??= {};
  room.answerMs ??= ANSWER_MS;
  room.spinMs ??= SPIN_MS;
  room.revealStep ??= REVEAL_STEP_MS;
  room.revealHold ??= REVEAL_HOLD_MS;
  for (const player of room.players ?? []) {
    player.rightThisGame ??= 0;
    player.plan ??= null;
  }
  if (!Array.isArray(room.history)) room.history = [];
  return room;
}

/**
 * Trivium's part of a computer player taking the place of a person who left a game under way (the roster has already
 * put it in the list, with the person's score, counters and colour): it gets an AI, everything that named the person
 * now names it, and if the question is still up it is given an answer of its own to make.
 *
 * @param {object} room  the room
 * @param {number} oldId  the account id of the person who left
 * @param {object} bot  the computer player now in their place
 * @param {() => number} rng  random source
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: mutates the room (the bot, the answers, the result, the round counters, the history) and may close the
 *   question if it was only waiting for that person.
 */
function takeOver(room, oldId, bot, rng, now) {
  bot.ai = pickAI(AIS, rng).id;
  bot.plan = null;
  for (const given of room.answers) if (given.id === oldId) given.id = bot.id;
  for (const table of [room.roundScored, room.roundRight]) {
    if (Object.hasOwn(table, oldId)) {
      table[bot.id] = table[oldId];
      delete table[oldId];
    }
  }
  if (room.result) {
    for (const entry of room.result.entries) if (entry.id === oldId) entry.id = bot.id;
    room.result.missed = room.result.missed.map((id) => (id === oldId ? bot.id : id));
  }
  renameInHistory(room, oldId, bot.id);
  if (room.phase !== 'question') return;
  if (!hasAnswered(room, bot.id)) {
    // It has to answer something: the same decision any computer player makes, but with what is left of the clock.
    const left = Math.max(0, room.deadline - now);
    const ai = aiById(AIS, bot.ai);
    let choice = null;
    try {
      choice = ai.answer(botContext(room), rng);
    } catch {
      choice = null;
    }
    if (choice) {
      const index = Number.isInteger(choice.choice) && choice.choice >= 0 && choice.choice < room.question.answers.length ? choice.choice : 0;
      const taken = Math.max(0, now - room.askedAt);
      bot.plan = { choice: index, x: round3(Math.min(1, Math.max(0, choice.x ?? 0.5))), y: round3(Math.min(1, Math.max(0, choice.y ?? 0.5))), wait: taken + Math.round(left * BOT_PACE.most * (choice.speed ?? 0.5)) };
    }
  }
  if (allAnswered(room)) closeQuestion(room, now);
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
 * The statistics for a finished game, in the shape of ctx.stats.record.  Computer players are not accounts: people only.
 *
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}  one row per person
 * Side effects: none.
 */
export function statsPlayers(room) {
  const asked = room.history.length;
  return statsRows(standings(room), (p) => ({
    outcome: p.winner ? 'win' : 'loss',
    placement: p.placement,
    score: p.score,
    extras: {
      ...statsExtras(p),
      // Every question of the whole game, which wants there to have been some questions.
      perfectGames: asked > 0 && (p.rightThisGame ?? 0) === asked ? 1 : 0,
    },
  }));
}

/**
 * The question as the table shows it while it is being answered: the words and the buttons, never which one is right.
 *
 * @param {object} room  not changed
 * @returns {object|null} the question, or null when none is up
 * Side effects: none.
 */
const questionView = (room) => (room.question ? { id: room.question.id, text: room.question.text, answers: [...room.question.answers], category: room.question.category, difficulty: room.question.difficulty } : null);

/**
 * The result of the question just closed, with the names filled in (only once it is revealed).
 *
 * @param {object} room  not changed
 * @param {(id: number) => string} nameOf  a player's name
 * @returns {object | null} the result with names, or null before the reveal
 * Side effects: none.
 */
function resultView(room, nameOf) {
  if (!(SHOWN.includes(room.phase) && room.result)) return null;
  return {
    correct: room.result.correct,
    category: room.result.category,
    entries: room.result.entries.map((e) => ({ ...e, name: nameOf(e.id) })),
    missed: room.result.missed.map((id) => ({ id, name: nameOf(id) })),
  };
}

/**
 * One player as the table shows them to everybody.
 *
 * @param {object} room  not changed
 * @param {object} p  the player
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean, final: Map<number, object> }} context
 * @returns {object} the public fields of the player (the AI is shown by its description, never its internals)
 * Side effects: none.
 */
function playerView(room, p, { nameOf, online, final }) {
  return {
    id: p.id,
    name: nameOf(p.id),
    colour: p.colour,
    score: p.score,
    online: isBot(p) || online(p.id),
    bot: isBot(p), // the client's name for "is a computer player"
    ai: isBot(p) && p.ai ? describeAI(aiById(AIS, p.ai)) : null, // computer players only, once a game has started
    answered: room.phase === 'question' && hasAnswered(room, p.id),
    placement: final.get(p.id)?.placement ?? null,
    winner: final.get(p.id)?.winner ?? false,
  };
}

/**
 * The standard scoreboard (shared/scores.js): whoever the game is waiting for is `current`, which while a question is
 * up is everybody who has yet to answer (the site's `global.slow` clock reads it).
 *
 * @param {object} room  not changed
 * @param {number} userId  the viewer
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean }} context
 * @returns {object} the scoreboard in the shared shape
 * Side effects: none.
 */
function scoreboardView(room, userId, { nameOf, online }) {
  const mustAct = (p) => room.phase === 'question' && !hasAnswered(room, p.id);
  const player = (p) => playerScoreboardEntry(p, { name: nameOf(p.id), me: userId, current: mustAct(p), online });
  return {
    players: room.players.map(player),
    rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })),
    lowIsBetter: false,
  };
}

/**
 * What one person may see.  Nobody is told which answer is right, nor what anybody else pressed, until the question
 * has closed; the rest of the round's questions are never sent at all.
 *
 * @param {object} room  not changed
 * @param {number} userId  the account looking
 * @param {object} [options]
 * @param {(id: number) => string} [options.nameOf]  names for players who have left
 * @param {(id: number) => boolean} [options.online]  who is connected
 * @param {boolean} [options.canCustom]  whether this player may pick any colour (a shop unlock)
 * @param {number} [options.now]  the clock, for the countdowns (the room's own stamp, so a test is repeatable)
 * @returns {object} the view sent to that person
 * Side effects: none.
 */
export function viewFor(room, userId, { nameOf = String, online = () => true, canCustom = false, now = room.updatedAt } = {}) {
  nameOf = namer(room, nameOf);
  const revealed = SHOWN.includes(room.phase);
  const final = finalStandings(room.players, ['finished', 'abandoned'].includes(room.phase));
  const mine = room.answers.find((a) => a.id === userId) ?? null;
  return {
    code: room.code,
    phase: room.phase,
    you: userId,
    hostId: room.hostId,
    rounds: room.rounds,
    perRound: room.perRound,
    round: Math.min(room.round + 1, room.rounds),
    ask: Math.min(room.ask + 1, room.perRound),
    wheel: room.wheel.map(({ category, weight }) => ({ category, weight })),
    spin: room.phase === 'lobby' ? null : room.spin,
    spinLeft: room.phase === 'spin' ? Math.max(0, room.spinUntil - now) : null, // milliseconds the wheel is still turning
    question: room.phase === 'lobby' ? null : questionView(room),
    correct: revealed && room.result ? room.result.correct : null,
    mine: mine ? { choice: mine.choice, x: mine.x, y: mine.y } : null,
    result: resultView(room, nameOf),
    reveal: room.phase === 'reveal' ? { since: Math.max(0, now - room.revealAt), step: room.revealStep } : null,
    remaining: room.phase === 'question' ? Math.max(0, room.deadline - now) : null,
    version: `${room.round}:${room.ask}:${room.phase}`,
    players: room.players.map((p) => playerView(room, p, { nameOf, online, final })),
    scoreboard: scoreboardView(room, userId, { nameOf, online }),
    colours: COLOURS,
    canCustomColour: Boolean(canCustom), // this player may pick any colour (a shop unlock)
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, rounds: ROUNDS, perRound: PER_ROUND, points: MAX_QUESTION_POINTS },
  };
}

// ---------- computer players ----------

/**
 * The next answer a computer player is due to give, with the moment it is due.  Computer players never move the game
 * on from a reveal or a spin: those are the clock's business, so a computer player can neither hold the game up nor
 * rush anybody past a result.
 *
 * @param {object} room  the room to look at
 * @returns {{ id: string, at: number } | null} who answers next and when, or null when nobody is due
 * Side effects: none.
 */
export function pendingBotAction(room) {
  if (room.phase !== 'question') return null;
  let soonest = null;
  for (const p of room.players) {
    if (!isBot(p) || !p.plan || hasAnswered(room, p.id)) continue;
    const at = room.askedAt + p.plan.wait;
    if (!soonest || at < soonest.at) soonest = { id: p.id, at };
  }
  return soonest;
}

/**
 * Plays one pending computer answer: what that player decided the moment the question went up.
 *
 * @param {object} room  the room
 * @param {number} now  the clock
 * @param {{ id: string, at: number }|null} [action]  the answer to give (default: whatever pendingBotAction says)
 * @returns {boolean} true if the game accepted the answer
 * Side effects: records the answer, which may close and score the question.
 */
export function runBotAction(room, now, action = pendingBotAction(room)) {
  if (!action) return false;
  const player = playerOf(room, action.id);
  if (!player?.plan) return false;
  const { choice, x, y } = player.plan;
  return answer(room, action.id, choice, x, y, now).ok;
}
