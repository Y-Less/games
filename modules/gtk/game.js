// The rules of GTK, with no sockets or files.  A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error, params? }, where `error` is a code under `errors.` in the game's
// locale file or the site's (see MODULES.md, Languages); anything else the client shows is a message (shared/messages.js).
//
// A TURN: one player is the subject, and both of the turn's questions are about them ("What is your favourite
// fruit?" to them, "What is Ann's favourite fruit?" to everybody else).  Everybody writes an answer to both: the
// subject writes the truth, the others write something they hope will pass for it.  Then the first question's answers
// go up together and everybody but the subject picks the one they believe is true, then the second question's.  A
// right pick scores; so does a made-up answer, once for every person who fell for it.  You can never pick your own.
//
// A ROUND is everybody having been the subject once, which is what the host's `rounds` setting counts: a round at a
// table of five is five turns, and `turnsTotal` is the two multiplied together.
//
// Depends on: shared/scores.js (standings and scoreboard rows), shared/tally.js (statistics rows), shared/ai.js (computer
// player choice), shared/seats.js (result helpers), shared/messages.js (scoreboard labels and notes), shared/roster.js
// (lobby and player-list rules), shared/random.js (seeded drawing), ./ai/index.js (the computer players), ./tally.js
// (per-player counters), and ./questions.js (the questions, the computer players' answer pools, and answer matching).
import { numberFrom, textFrom } from '../../shared/input.js';
import { msg } from '../../shared/messages.js';
import { drawUnused } from '../../shared/random.js';
import { finalStandings, playerScoreboardEntry, standingsOf } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { allOrNothing, eachSetting } from '../../shared/settings.js';
import { createRosterRules, defaultPlayers, hasPlayer, historyView, humans, isBot, isHuman, migratePlayers, seatOf, withSlot } from '../../shared/roster.js';
import { AIS } from './ai/index.js';
import { newCounters, statsExtras, tallyQuestion, tallyTurn } from './tally.js';
import { QUESTIONS, answersFor, normal } from './questions.js';

// Table size limits (three are needed for anybody to have somebody to fool; eight is the most the screen shows comfortably).
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
/** How many a new game is for, until the host says otherwise. */
export const DEFAULT_PLAYERS = defaultPlayers(MIN_PLAYERS, MAX_PLAYERS);
// How many rounds the game runs for, which is how many times each player is the subject: bounds and default for the
// host's setting.
export const ROUNDS = { min: 1, max: 3, default: 1 };
// How many questions are asked about each subject in their turn: bounds and default for the host's setting.
export const QUESTIONS_EACH = { min: 1, max: 4, default: 2 };
// How long everybody has to write their answers, and to pick one: bounds, step and default for the host's setting, in
// seconds.  When it runs out the server answers or picks for whoever is left, so one person cannot hold up the table.
export const SECONDS = { min: 15, max: 180, step: 15, default: 60 };
// The longest answer accepted, in characters (keeps the table readable and stops pasted essays).
export const ANSWER_LENGTH = 60;
// Points: for picking the true answer, for each person who picks your made-up one, and for happening to write the truth.
export const POINTS = { correct: 2, fooled: 1, matched: 1 };

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hattie'];
// Phases in which the game is still going.
const LIVE = ['lobby', 'writing', 'picking', 'reveal'];
// Phases in which people are acting (as opposed to the lobby or the reveal).
const PLAYING = ['writing', 'picking'];
// Phases in which the answers and who wrote them are open to everybody.
const REVEALED = ['reveal', 'finished', 'abandoned'];

// The player-list vocabulary (who is in the room, and who is a person) is shared with Just One and Wavelength.
export { hasPlayer, humans, isHuman, seatOf };

/**
 * Is the game still going (or still in the lobby)?
 * @param {object} room  the room
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
 * What a player wrote this turn, or undefined.
 * @param {object} room  the room
 * @param {number | string} id  the player
 * @returns {{ id: *, texts: string[] } | undefined} their two answers
 * Side effects: none.
 */
const answersOf = (room, id) => room.answers.find((a) => a.id === id);
/**
 * Has everybody, the subject included, written their answers to both of this turn's questions?
 * @param {object} room  the room
 * @returns {boolean} true once they are all in
 * Side effects: none.
 */
const allWritten = (room) => room.players.every((p) => answersOf(room, p.id));
/**
 * Puts a question to the person it is about, or to everybody else with their name in it.
 * @param {{ you: string, about: string }} question  a question from questions.js
 * @param {string} subjectName  the name of the player the turn is about
 * @param {boolean} isSubject  whether the reader is that player
 * @returns {string} the question as that reader sees it ('' when there is no question yet)
 * Side effects: none.
 */
export const promptOf = (question, subjectName, isSubject) => (!question ? '' : isSubject ? question.you : question.about.replaceAll('{name}', subjectName));

/**
 * Gives a bare player ({ kind, id, name }) the fields GTK keeps for everybody: the score and the statistics counters.
 * @param {object} room  unused here; part of the shared makePlayer contract
 * @param {object} base  { kind: 'human' | 'bot', id, name? }
 * @returns {object} the player
 * Side effects: none.
 */
const makePlayer = (room, base) => ({ ...base, score: 0, ...newCounters() });

/**
 * Makes a new room with the host in it.
 * @param {object} args
 * @param {string} args.code        the invite code
 * @param {number} args.hostId      the host's account id
 * @param {string} [args.hostName]  the host's display name
 * @param {object} [args.settings]  settings the host chose when creating it ({ rounds, questionsPerTurn, seconds });
 *   invalid ones are ignored
 * @param {number} [args.rounds] rounds each (default 1); `settings.rounds` wins if both are given
 * @param {number} args.now         the time to stamp it with
 * @returns {object} the room, in the lobby
 * Side effects: none outside the new room (an invalid setting is silently left at its default).
 */
export function createRoom({ code, hostId, hostName, settings = {}, now, rounds = ROUNDS.default }) {
  const room = {
    code,
    hostId,
    phase: 'lobby',
    rounds,
    questionsPerTurn: QUESTIONS_EACH.default,
    seconds: SECONDS.default, // how long a writing or picking phase lasts before the server acts for whoever is left
    deadline: null, // when the phase now under way runs out (milliseconds, the server's clock), or null when nothing is timed
    turnsTotal: 0,
    turn: 0,
    question: 0, // which of the turn's questions is being picked or revealed (0 or 1)
    players: [],
    size: MAX_PLAYERS, // the most who may join; the host may set it lower, and starting settles it for good
    nextIdx: 0,
    ready: [], // at the reveal: the people who have closed the scores pop-up
    nextBot: 1, // computer players are players with kind 'bot', an id 'bot:<n>', a name, and (once started) an ai id
    subject: null, // the player this turn is about
    questions: [], // this turn's questions, as taken from questions.js
    used: [], // the ids of the questions already asked this game
    answers: [], // [{ id, texts: [first, second] }]: what everybody wrote, the subject's being the true ones
    options: [], // the answers on the table for the question being picked: [{ text, authors, truth }], in a shuffled order
    picks: [], // [{ id, n }]: who picked which option
    result: null, // the question just scored, shown at the reveal
    turnPicks: {}, // player id -> { asked, rights } for this turn, for the "got both right" counter
    history: [],
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
  room.players.push(withSlot(room, makePlayer(room, typeof hostName === 'string' ? { kind: 'human', id: hostId, name: hostName } : { kind: 'human', id: hostId })));
  eachSetting(settings, (one) => setSettings(room, hostId, one)); // a setting the host got wrong is simply left at its default
  return room;
}

/**
 * The lobby, joining, leaving, and computer-player rules, from shared/roster.js.  Somebody who leaves mid-game is replaced by
 * a computer player in their place, so no answer and no pick is lost (see takeOver).
 * Side effects: each rule it provides mutates the room's player list.
 */
const roster = createRosterRules({
  isLive,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  botNames: BOT_NAMES,
  makePlayer,
  takeOver,
  handOver,
});
export const { addHuman, removeHuman, addBot, removeBot, fillWithBots, kick } = roster;

/**
 * The host changes the settings.  Only the settings that are given are changed.
 * @param {object} room  the room
 * @param {number} id        who is asking (must be the host)
 * @param {object} settings  { rounds?, questionsPerTurn?, seconds? }
 * @returns {{ ok: boolean, error?: string }} the first refusal, or ok
 * Side effects: may change room.rounds, room.questionsPerTurn and room.seconds.
 */
export function setSettings(room, id, settings = {}) {
  return allOrNothing(room, () => applySettings(room, id, settings));
}

/** The change itself, a setting at a time; setSettings is what makes a refusal undo the settings applied before it. */
function applySettings(room, id, settings) {
  if (settings.size !== undefined) {
    const sized = roster.setSize(room, id, settings.size);
    if (!sized.ok) return sized;
  }
  const asked = [
    ['rounds', setRounds],
    ['questionsPerTurn', setQuestionsPerTurn],
    ['seconds', setSeconds],
  ].filter(([key]) => settings[key] !== undefined);
  if (!asked.length) return hostInLobby(room, id) ?? ok();
  for (const [key, apply] of asked) {
    const outcome = apply(room, id, settings[key]);
    if (!outcome.ok) return outcome;
  }
  return ok();
}

/**
 * GTK has no "play again": a new game is made from the menu.  (The shared room server offers the event to every game.)
 * @returns {{ ok: false, error: string }}
 * Side effects: none.
 */
export function playAgain() {
  return fail('startFromMenu');
}

/**
 * The host changes how many rounds each player is the subject of.
 * @param {object} room  the room
 * @param {number} id          who is asking (must be the host)
 * @param {number} rounds  a whole number from ROUNDS.min to ROUNDS.max
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets room.rounds on success.
 */
export function setRounds(room, id, rounds) {
  if (id !== room.hostId) return fail('hostOnlySettings');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (!Number.isInteger(rounds) || rounds < ROUNDS.min || rounds > ROUNDS.max) {
    return fail('rounds', { min: ROUNDS.min, max: ROUNDS.max });
  }
  room.rounds = rounds;
  return ok();
}

/**
 * The host changes how many questions are asked about each subject in their turn.
 * @param {object} room  the room
 * @param {number} id  who is asking (must be the host)
 * @param {number} questionsPerTurn  a whole number from QUESTIONS_EACH.min to QUESTIONS_EACH.max
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets room.questionsPerTurn on success.
 */
export function setQuestionsPerTurn(room, id, questionsPerTurn) {
  if (id !== room.hostId) return fail('hostOnlySettings');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (!Number.isInteger(questionsPerTurn) || questionsPerTurn < QUESTIONS_EACH.min || questionsPerTurn > QUESTIONS_EACH.max) {
    return fail('questionsPerTurn', { min: QUESTIONS_EACH.min, max: QUESTIONS_EACH.max });
  }
  room.questionsPerTurn = questionsPerTurn;
  return ok();
}

/**
 * The host changes how long everybody has to write their answers, and to pick one.
 * @param {object} room  the room
 * @param {number} id  who is asking (must be the host)
 * @param {number} seconds  a whole number of seconds from SECONDS.min to SECONDS.max, a multiple of SECONDS.step
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets room.seconds on success.
 */
export function setSeconds(room, id, seconds) {
  if (id !== room.hostId) return fail('hostOnlySettings');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (!Number.isInteger(seconds) || seconds < SECONDS.min || seconds > SECONDS.max || seconds % SECONDS.step !== 0) {
    return fail('seconds', { min: SECONDS.min, max: SECONDS.max });
  }
  room.seconds = seconds;
  return ok();
}

/**
 * Sets the room up for the next turn: the next player in order is the subject, two questions nobody has been asked
 * this game are drawn, and the last turn's answers, options and result are wiped.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the questions
 * @param {number} [now]  the time the writing phase starts, which its deadline is measured from
 * @returns {void}
 * Side effects: sets subject, nextIdx, used, questions, answers, options, picks, result, turnPicks, question, ready,
 *   deadline, and phase ('writing').
 */
function startTurn(room, rng, now = 0) {
  room.subject = room.players[room.nextIdx].id;
  room.nextIdx = (room.nextIdx + 1) % room.players.length;
  room.used ??= [];
  room.questions = [];
  for (let n = 0; n < room.questionsPerTurn; n++) {
    const id = drawUnused(QUESTIONS.map((entry) => entry.id), room.used, rng);
    room.questions.push({ ...QUESTIONS.find((entry) => entry.id === id) });
  }
  room.answers = [];
  room.options = [];
  room.picks = [];
  room.result = null;
  room.turnPicks = {};
  room.question = 0;
  room.ready = [];
  room.deadline = now + room.seconds * 1000;
  room.phase = 'writing';
}

/**
 * The host starts the game: works out how many rounds there will be, picks the first subject and their questions, and
 * gives every computer player an AI for the whole game.
 * @param {object} room  the room (mutated)
 * @param {number} id            who is asking (must be the host)
 * @param {() => number} rng  random source for the order, the questions, and the AIs
 * @param {number} [now]  the time the game starts, which the first deadline is measured from
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: changes the phase and everything a turn sets up (see startTurn), and sets turnsTotal, turn, used,
 *   and each computer player's `ai`.
 */
export function start(room, id, rng, now = 0) {
  if (id !== room.hostId) return fail('hostOnlyStart');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (room.players.length < MIN_PLAYERS) return fail('minPlayers', { min: MIN_PLAYERS });
  roster.lockSize(room); // the game is for whoever is here now; a place kept open is a computer player holding it
  room.turnsTotal = room.rounds * room.players.length;
  room.turn = 0;
  room.used = [];
  room.nextIdx = Math.floor(rng() * room.players.length);
  startTurn(room, rng, now);
  // Every computer player gets an AI for the whole game.
  const bots = room.players.filter(isBot);
  const picks = assignAIs(AIS, bots.map((p) => p.id), rng);
  for (const p of bots) p.ai = picks[p.id];
  return ok();
}

/**
 * Why an answer is not allowed, or null.  It must be something, and short enough to sit on a card beside the others.
 * @param {string} text  the trimmed answer
 * @returns {string | null} the refusal code (under `errors.`), or null if the answer is allowed
 * Side effects: none.
 */
export function answerProblem(text) {
  if (!text) return 'typeAnswers';
  if (text.length > ANSWER_LENGTH) return 'answerTooLong';
  if (!normal(text)) return 'answerNeedsWords'; // nothing but punctuation
  return null;
}

/**
 * Everybody's answers to both of the turn's questions, sent together: the subject's are the truth, everybody else's
 * are what they hope will pass for it.  Once they are all in, the first question goes up for picking.
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is writing
 * @param {unknown} texts  what they typed, one answer per question
 * @param {() => number} rng  random source (for the order the answers are shown in)
 * @param {(id: *) => string} [nameOf]  name lookup, needed only if the question is scored the moment it opens
 * @param {number} [now]  the time, which the picking deadline is measured from
 * @returns {{ ok: boolean, error?: string, params?: object }} the result
 * Side effects: adds to room.answers; when the last answers arrive, runs openPicking (options, picks, phase).
 */
export function submitAnswers(room, id, texts, rng, nameOf = String, now = 0) {
  if (room.phase !== 'writing') return fail('answersIn');
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (answersOf(room, id)) return fail('alreadyAnswered');
  const list = Array.isArray(texts) ? texts : [texts];
  if (list.length !== room.questionsPerTurn) return fail('answerEachQuestion', { count: room.questionsPerTurn });
  const clean = list.map((text) => textFrom(text).replace(/\s+/g, ' ').trim());
  for (const text of clean) {
    const problem = answerProblem(text);
    if (problem) return fail(problem, problem === 'answerTooLong' ? { max: ANSWER_LENGTH } : undefined);
  }
  room.answers.push({ id, texts: clean });
  if (allWritten(room)) openPicking(room, rng, namer(room, nameOf), now);
  return ok();
}

/**
 * Shuffles a list in place (Fisher-Yates) with the game's own random source.
 * @param {Array} list  the list to shuffle (mutated)
 * @param {() => number} rng  random source
 * @returns {Array} the same list
 * Side effects: reorders `list`.
 */
function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Puts the answers to the question now being asked on the table: answers that come to the same thing are one option
 * with several authors, the subject's wording is the one shown for the true answer, and the order is shuffled so that
 * it gives nothing away.  A question nobody is left to pick (everybody happened to write the true answer) is scored at
 * once.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the shuffle
 * @param {(id: *) => string} [nameOf]  name lookup, needed only if the question is scored at once
 * @param {number} [now]  the time the picking opens, which its deadline is measured from
 * @returns {void}
 * Side effects: sets room.options, room.picks, room.deadline and room.phase ('picking'), or scores the question (see scoreQuestion).
 */
function openPicking(room, rng, nameOf = String, now = 0) {
  const n = room.question;
  const groups = new Map(); // the comparable form of an answer -> the option it belongs to
  // The subject goes in first, so the true answer is shown in their words rather than somebody else's.
  const order = [room.subject, ...room.players.map((p) => p.id).filter((id) => id !== room.subject)];
  for (const id of order) {
    const text = answersOf(room, id)?.texts[n];
    if (typeof text !== 'string') continue;
    const key = normal(text);
    if (!groups.has(key)) groups.set(key, { text, authors: [], truth: id === room.subject });
    const option = groups.get(key);
    if (id !== room.subject) option.authors.push(id);
  }
  room.options = shuffle([...groups.values()], rng);
  room.picks = [];
  room.deadline = now + room.seconds * 1000;
  room.phase = 'picking';
  if (!toPick(room).length) scoreQuestion(room, nameOf); // nobody has anything left to choose between
}

/**
 * The index of the true answer among the options, or -1 before they are on the table.
 * @param {object} room  the room
 * @returns {number} the index in room.options
 * Side effects: none.
 */
const truthIndex = (room) => room.options.findIndex((option) => option.truth);
/**
 * May this player pick this option?  Never one they wrote themselves, and the subject never picks at all.
 * @param {object} room  the room
 * @param {number} n  the option's index
 * @param {number | string} id  the player
 * @returns {boolean} whether the pick would be allowed
 * Side effects: none.
 */
const mayPick = (room, n, id) => id !== room.subject && Boolean(room.options[n]) && !room.options[n].authors.includes(id);
/**
 * The people and computer players the game is still waiting on for this question: everybody but the subject, less
 * those who wrote the true answer themselves (they have found it already) and those who have picked.
 * @param {object} room  the room
 * @returns {object[]} the players still to pick
 * Side effects: none.
 */
const toPick = (room) => room.players.filter((p) => p.id !== room.subject && !room.options[truthIndex(room)]?.authors.includes(p.id) && !room.picks.some((pick) => pick.id === p.id));

/**
 * The players whom *everybody else* has just named: those whose own name was written as the answer to this question by
 * every other player in the room, the subject included, so the true answer is their name and so is every made-up one.
 * Names are compared as plain text with the capitals and the surrounding spaces ignored and nothing else (not
 * `normal()`: this is a name, not an answer being matched with another).  The subject is left out, because naming
 * yourself is not somebody else naming you.  Worked out only when a question is scored, so that nobody is told who was
 * named — and so told the answer — while the question is still open.
 * @param {object} room  the room (not changed)
 * @param {number} [n]  which of the turn's questions (default: the one being scored)
 * @returns {object[]} the players everybody else named, in the order they are seated (very rarely any)
 * Side effects: none.
 */
export function namedBy(room, n = room.question) {
  const plain = (text) => String(text ?? '').trim().toLowerCase();
  return room.players.filter((p) => {
    if (p.id === room.subject) return false;
    const wanted = plain(p.name);
    if (!wanted) return false;
    // Every other player must have written it, so an answer still to come is an answer that has not named anybody.
    const everybodyElse = room.answers.filter((answer) => answer.id !== p.id);
    return everybodyElse.length === room.players.length - 1 && everybodyElse.length >= 2 && everybodyElse.every((answer) => plain(answer.texts[n]) === wanted);
  });
}

/**
 * A player picks the answer they believe is the subject's own.
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is picking
 * @param {unknown} n  the option's place in the list they were shown
 * @param {(id: *) => string} [nameOf]  name lookup for the history label
 * @returns {{ ok: boolean, error?: string }} the result
 * Side effects: adds to room.picks; when the last pick arrives, scores the question (see scoreQuestion).
 */
export function choose(room, id, n, nameOf = String) {
  if (room.phase !== 'picking') return fail('notTimeToPick');
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (id === room.subject) return fail('subjectDoesNotPick');
  if (room.picks.some((pick) => pick.id === id)) return fail('alreadyPicked');
  const index = numberFrom(n);
  if (!Number.isInteger(index) || index < 0 || index >= room.options.length) return fail('pickAnAnswer');
  if (room.options[truthIndex(room)]?.authors.includes(id)) return fail('yoursWasTrue');
  if (!mayPick(room, index, id)) return fail('notYourOwnAnswer');
  room.picks.push({ id, n: index });
  if (!toPick(room).length) scoreQuestion(room, namer(room, nameOf));
  return ok();
}

/**
 * Scores the question and opens the reveal: the true answer is shown with everybody's name against what they wrote and
 * what they picked.  A player who has left simply scores nothing (the lookups return undefined).
 * The history entry's label and notes are messages (shared/messages.js), put into words by the client.
 * @param {object} room  the room (mutated)
 * @param {(id: *) => string} [nameOf]  name lookup for the history label
 * @returns {void}
 * Side effects: changes scores, bumps statistics counters (tallyQuestion), sets room.result and room.turnPicks,
 *   pushes room.history, clears ready, and sets phase 'reveal'.
 */
/**
 * What a scored question turns on, read off the room once so that the scoring, the notes, the tallies and the
 * statistics all answer from the same facts rather than working them out again.
 * @param {object} room  not changed
 * @returns {{ truth: number, fooled: number[], right: Set<*>, matched: Set<*>, named: Set<*> }}
 *   which option was true, how many picked each one, who found it, whose made-up answer happened to be it, and who
 *   every other player named (told now, with the answers, and never before)
 * Side effects: none.
 */
function questionFacts(room) {
  const truth = truthIndex(room);
  const fooled = room.options.map(() => 0);
  for (const pick of room.picks) fooled[pick.n]++;
  return {
    truth,
    fooled,
    right: new Set(room.picks.filter((pick) => pick.n === truth).map((pick) => pick.id)),
    matched: new Set(room.options[truth]?.authors ?? []),
    named: new Set(namedBy(room, room.question).map((p) => p.id)),
  };
}

/**
 * Awards a question's points: for finding the true answer, for having written it by accident, and for every person
 * taken in by a made-up one.
 * @param {object} room  the players' scores are changed
 * @param {object} facts  from questionFacts
 * @returns {{ deltas: object, gave: object }} the points each slot gained, and how many people each author fooled
 * Side effects: adds to `player.score`.
 */
function awardPoints(room, { fooled, right, matched }) {
  // Keyed by slot, not by id: a person who leaves is replaced by a computer player with a different id, and the slot
  // is what survives that, so a finished question is written once and never touched again.  viewFor sends it back out
  // keyed by id (shared/roster.js historyView), so the scoreboard sees what it always did.
  const deltas = Object.fromEntries(room.players.map((p) => [p.slot, 0]));
  const gave = {};
  /** Gives one player their points, and answers with them, or with null when they have left.  Side effects: scores. */
  const award = (id, points) => {
    const player = playerOf(room, id);
    if (!player) return null;
    player.score += points;
    deltas[player.slot] += points;
    return player;
  };
  for (const id of right) award(id, POINTS.correct);
  for (const id of matched) award(id, POINTS.matched);
  for (const [n, option] of room.options.entries()) {
    if (option.truth || !fooled[n]) continue;
    for (const id of option.authors) if (award(id, POINTS.fooled * fooled[n])) gave[id] = (gave[id] ?? 0) + fooled[n];
  }
  return { deltas, gave };
}

/**
 * One note per player, the most interesting thing they did: fooling somebody beats finding the answer.
 * @param {object} room  not changed
 * @param {object} facts  from questionFacts
 * @param {object} gave  how many people each author fooled, from awardPoints
 * @returns {object} the note for each slot that earned one
 * Side effects: none.
 */
function notesFor(room, { right, matched, named }, gave) {
  const notes = {};
  for (const p of room.players) {
    if (gave[p.id]) notes[p.slot] = msg('notes.fooled', { count: gave[p.id] });
    else if (named.has(p.id)) notes[p.slot] = msg('notes.named');
    else if (matched.has(p.id)) notes[p.slot] = msg('notes.matched');
    else if (right.has(p.id)) notes[p.slot] = msg('notes.right');
    else if (p.id === room.subject) notes[p.slot] = msg('notes.theirTurn');
  }
  return notes;
}

/**
 * Keeps how each player has done over the turn's questions, which the turn's own scores read.  The subject does not
 * answer their own question, so they are not asked and not counted.
 * @param {object} room  room.turnPicks is changed
 * @param {object} facts  from questionFacts
 * @returns {void}
 * Side effects: creates and adds to room.turnPicks.
 */
function recordTurnPicks(room, { right, matched }) {
  room.turnPicks ??= {};
  for (const p of room.players) {
    if (p.id === room.subject) continue;
    const tally = (room.turnPicks[p.id] ??= { asked: 0, rights: 0 });
    tally.asked++;
    if (right.has(p.id) || matched.has(p.id)) tally.rights++;
  }
}

/**
 * Hands the question to the statistics, as players rather than ids, so that somebody who has left counts for nothing
 * instead of counting for somebody else.
 * @param {object} room  not changed
 * @param {object} facts  from questionFacts
 * @returns {void}
 * Side effects: bumps the statistics counters.
 */
function recordStatistics(room, { truth, fooled, right, matched, named }) {
  tallyQuestion({
    subject: playerOf(room, room.subject) ?? null,
    picks: room.picks.map((pick) => ({ player: playerOf(room, pick.id) ?? null, right: pick.n === truth })),
    fakes: room.options.flatMap((option, n) => option.authors.map((id) => ({ player: playerOf(room, id) ?? null, fooled: option.truth ? 0 : fooled[n], matched: option.truth }))),
    named: [...named].map((id) => playerOf(room, id) ?? null),
    // Nobody found the subject out: every pick went to a made-up answer, and nobody wrote the true one by accident.
    foundByNobody: room.picks.length > 0 && right.size === 0 && matched.size === 0,
  });
}

/**
 * What the reveal shows: the true answer, and every option with who wrote it and who picked it.
 * @param {object} room  not changed
 * @param {number} truth  which option was the true one
 * @returns {object} room.result
 * Side effects: none.
 */
function revealOf(room, truth) {
  return {
    question: room.question,
    questionId: room.questions[room.question]?.id ?? null,
    subject: room.subject,
    truth,
    options: room.options.map((option, n) => ({
      n,
      text: option.text,
      truth: option.truth,
      authors: option.authors.slice(),
      pickedBy: room.picks.filter((pick) => pick.n === n).map((pick) => pick.id),
    })),
  };
}

function scoreQuestion(room, nameOf = String) {
  const facts = questionFacts(room);
  const { deltas, gave } = awardPoints(room, facts);
  const notes = notesFor(room, facts, gave);
  recordTurnPicks(room, facts);
  recordStatistics(room, facts);

  room.result = revealOf(room, facts.truth);
  room.history.push({ label: msg('scoreboard.question', { turn: room.turn + 1, total: room.turnsTotal, name: nameOf(room.subject), n: room.question + 1 }), deltas, notes });
  room.ready = [];
  room.deadline = null; // the reveal has a wait of its own, which the server keeps
  room.phase = 'reveal';
}

/**
 * Moves one field of a saved room to the name it goes by now, if it is still under the old one.
 * @param {object} room  the room to change
 * @param {string} was  the old field name
 * @param {string} now  the name it has today
 * @returns {void}
 * Side effects: writes `now` and deletes `was`.  Running it twice changes nothing more, and a room that already
 * holds `now` keeps what is there.
 */
function renameField(room, was, now) {
  if (room[was] === undefined) return;
  if (room[now] === undefined) room[now] = room[was];
  delete room[was];
}

/**
 * Brings a saved room up to date: players saved with `bot: true` become `kind: 'bot'` (and people saved without a name get
 * one from `nameOf`), the words it was saved under are renamed (see below), and fields added since are filled in.
 * @param {object} room  the saved room (mutated)
 * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
 * @returns {object} the same room
 * Side effects: mutates the room (as described above).  Running it twice changes nothing more.
 */
export function migrate(room, nameOf) {
  migratePlayers(room, nameOf, { maxPlayers: MAX_PLAYERS });
  // GTK used to call one player's go as the subject a round.  A turn is that go now, and a round is everybody having
  // had one, so a room saved under the old words has its fields and its history labels renamed on the way in, once.
  renameField(room, 'round', 'turn');
  renameField(room, 'roundsEach', 'rounds');
  renameField(room, 'roundsTotal', 'turnsTotal');
  renameField(room, 'questionsPerRound', 'questionsPerTurn');
  renameField(room, 'roundPicks', 'turnPicks');
  for (const entry of Array.isArray(room.history) ? room.history : []) {
    const params = entry?.label?.params;
    if (params && params.round !== undefined && params.turn === undefined) {
      entry.label = { ...entry.label, params: { ...params, turn: params.round } };
      delete entry.label.params.round;
    }
  }
  room.used ??= [];
  room.questions ??= [];
  room.answers ??= [];
  room.options ??= [];
  room.picks ??= [];
  room.ready ??= []; // ready() reads it unguarded
  room.turnPicks ??= {};
  room.question ??= 0;
  room.questionsPerTurn ??= QUESTIONS_EACH.default;
  room.seconds ??= SECONDS.default;
  room.deadline ??= null;
  if (!Array.isArray(room.history)) room.history = [];
  return room;
}

/**
 * Ends the reveal: moves on to the turn's second question, or counts the turn and either finishes the game or starts
 * the next turn.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the next question's shuffle and the next turn
 * @param {(id: *) => string} [nameOf]  name lookup for history labels
 * @param {number} [now]  the time, which the next phase's deadline is measured from
 * @returns {boolean} true if that was the last question of the last turn and the game is now finished
 * Side effects: clears ready, and either opens the next question, starts the next turn, or sets phase 'finished'.
 */
function finishQuestion(room, rng, nameOf = String, now = 0) {
  room.ready = [];
  if (room.question + 1 < room.questionsPerTurn) {
    room.question++;
    room.result = null;
    openPicking(room, rng, namer(room, nameOf), now);
    return false;
  }
  tallyTurn({
    subject: playerOf(room, room.subject) ?? null,
    pickers: Object.entries(room.turnPicks ?? {}).map(([id, { asked, rights }]) => ({ player: room.players.find((p) => String(p.id) === id) ?? null, asked, rights })),
  });
  room.turn++;
  if (room.turn >= room.turnsTotal) {
    room.deadline = null;
    room.phase = 'finished';
    return true;
  }
  startTurn(room, rng, now);
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
 * At the reveal, a person has closed the scores pop-up and is ready to go on; when everybody has, the game moves on.
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is ready
 * @param {() => number} rng  random source for what comes next
 * @param {(id: *) => string} [nameOf]  name lookup for history labels
 * @returns {{ ok: boolean, error?: string, finished?: boolean }} finished is true if the game is over
 * Side effects: adds to room.ready, and may move on (finishQuestion).
 */
export function ready(room, id, rng, nameOf = String, now = 0) {
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (room.phase !== 'reveal') return fail('noScoresToClose');
  if (!room.ready.includes(id)) room.ready.push(id);
  return ok({ finished: unready(room).length === 0 ? finishQuestion(room, rng, nameOf, now) : false });
}

/**
 * Moves on from the reveal whether or not everyone has closed the pop-up (the server does this after a wait).
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for what comes next
 * @param {(id: *) => string} [nameOf]  name lookup for history labels
 * @returns {{ ok: boolean, error?: string, finished?: boolean }} finished is true if the game is over
 * Side effects: as finishQuestion.
 */
export function forceNext(room, rng, nameOf = String, now = 0) {
  if (room.phase !== 'reveal') return fail('nothingToMoveOn');
  return ok({ finished: finishQuestion(room, rng, nameOf, now) });
}

/**
 * The writing or picking time has run out: the server answers or picks for everybody who is left, exactly as a
 * computer player would, so that one person who has wandered off cannot hold up the table.  Anybody who has already
 * acted is untouched.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the answers and the picks
 * @param {(id: *) => string} [nameOf]  name lookup for history labels
 * @param {number} [now]  the time, which the next phase's deadline is measured from
 * @returns {boolean} true if anybody had to be acted for
 * Side effects: as submitAnswers and choose; the phase moves on once the last one is in.
 */
export function fillTimedOut(room, rng, nameOf = String, now = 0) {
  let acted = false;
  if (room.phase === 'writing') {
    for (const p of room.players.filter((player) => !answersOf(room, player.id))) {
      const texts = room.questions.map((question) => poolAnswer(question, rng));
      if (submitAnswers(room, p.id, texts, rng, nameOf, now).ok) acted = true;
      if (room.phase !== 'writing') break; // the last one in opened the picking
    }
    return acted;
  }
  if (room.phase !== 'picking') return false;
  for (const p of [...toPick(room)]) {
    const allowed = room.options.map((option, n) => n).filter((n) => mayPick(room, n, p.id));
    if (!allowed.length) continue;
    if (choose(room, p.id, allowed[Math.min(allowed.length - 1, Math.floor(rng() * allowed.length))], nameOf).ok) acted = true;
    if (room.phase !== 'picking') break; // the last one in scored the question
  }
  return acted;
}

/**
 * One of the answers a computer player might write for a question, for the server to use when somebody's time runs out.
 * @param {object} question  a question from questions.js
 * @param {() => number} rng  random source
 * @returns {string} an answer from the question's pool ('Who knows' for a question with no pool)
 * Side effects: none beyond advancing `rng` once.
 */
function poolAnswer(question, rng) {
  const pool = answersFor(question);
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] : 'Who knows';
}

/**
 * Has the time to write or to pick run out, and is the server owed an answer or a pick for somebody?
 * @param {object} room  the room
 * @returns {boolean} whether fillTimedOut has anything to do once the deadline passes
 * Side effects: none.
 */
export const isTimed = (room) => ['writing', 'picking'].includes(room.phase) && typeof room.deadline === 'number';

/**
 * True while the reveal waits for people to close the scores (the server times this out).
 * @param {object} room  the room
 * @returns {boolean} whether the room is at the reveal
 * Side effects: none.
 */
export const waitingForReady = (room) => room.phase === 'reveal';

/**
 * GTK's part of a computer player taking the place of a person who left a game under way (the roster has already put it
 * in the list, with the person's score and counters): it gets an AI, everything that named the person now names it
 * (the subject, their answers, the options they wrote, their pick, the ready list, the result, the history), and if the
 * reveal was only waiting for that person the game moves on.  Anything it now has to do is picked up by pendingBotAction.
 * @param {object} room  the room (mutated)
 * @param {number} oldId  the account id of the person who left
 * @param {object} bot    the computer player now in their place
 * @param {() => number} rng  random source
 * @param {number} [now]  the clock, which the next phase's deadline is measured from if the game moves on
 * @returns {void}
 * Side effects: mutates the room (the bot, subject, answers, options, picks, ready, turnPicks, result, history) and may move on.
 */
/**
 * Renames one player's id everywhere this game writes one down.  A place changes hands in both directions — a computer
 * player takes a person's, and a latecomer takes a computer player's — and both are this same renaming.
 *
 * The scoreboard history is deliberately not among them: it is written by slot, and the slot goes with the place, so
 * a finished question is never rewritten.
 *
 * @param {object} room  the room to change
 * @param {number | string} from  the id leaving
 * @param {number | string} to  the id taking its place
 * @returns {void}
 * Side effects: mutates the room's own fields and its scoreboard history.
 */
function renameId(room, from, to) {
  const renamed = (x) => (x === from ? to : x);
  room.subject = renamed(room.subject);
  for (const answer of room.answers) answer.id = renamed(answer.id);
  for (const option of room.options) option.authors = option.authors.map(renamed);
  for (const pick of room.picks) pick.id = renamed(pick.id);
  if (room.turnPicks && Object.hasOwn(room.turnPicks, from)) {
    room.turnPicks[to] = room.turnPicks[from];
    delete room.turnPicks[from];
  }
  if (room.result) {
    room.result.subject = renamed(room.result.subject);
    for (const option of room.result.options) {
      option.authors = option.authors.map(renamed);
      option.pickedBy = option.pickedBy.map(renamed);
    }
  }
}

function takeOver(room, oldId, bot, rng, now = 0) {
  bot.ai = pickAI(AIS, rng).id;
  renameId(room, oldId, bot.id);
  room.ready = (room.ready ?? []).filter((x) => x !== oldId); // a computer player is always ready, so it needs no entry
  if (room.phase === 'reveal' && unready(room).length === 0) finishQuestion(room, rng, String, now);
}

/**
 * The mirror of takeOver: somebody arriving has taken a computer player's place, so the game is theirs to play from
 * here.  Nothing is ready on their behalf any more, which is why a turn that was about to end now waits for them.
 *
 * @param {object} room  the room to change
 * @param {string} botId  the computer player whose place was taken
 * @param {object} person  the newcomer, already in its place in the list
 * @returns {void}
 * Side effects: mutates the room's own fields and its scoreboard history.
 */
function handOver(room, botId, person) {
  renameId(room, botId, person.id);
  room.ready = (room.ready ?? []).filter((x) => x !== botId);
}

/**
 * Players best first; tied scores share a placement and every tied leader wins.
 * @param {object} room  not changed
 * @returns {object[]} copies of the players with `placement` and `winner`
 * Side effects: none.
 */
export function standings(room) {
  return standingsOf(room.players);
}

/**
 * The statistics for a finished game, in the shape of ctx.stats.record.  Computer players are not accounts: people only.
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

// ---------- the view ----------

/**
 * The answers on the table as one viewer may see them.  While they are being written nobody sees anybody's; while they
 * are being picked everybody sees the texts, with their own marked and the ones they may pick; at the reveal everybody
 * sees who wrote each one and who fell for it.
 * @param {object} room  not changed
 * @param {number | string} userId  the viewer
 * @param {(id: *) => string} nameOf  a player's name
 * @returns {object[]} the options to show that viewer
 * Side effects: none.
 */
function optionsView(room, userId, nameOf) {
  const people = (ids) => ids.map((id) => ({ id, name: nameOf(id) }));
  // "Yours" is the answer this viewer wrote: their made-up one, or, for the subject, their own true answer.
  const isYours = (option, subject) => option.authors.includes(userId) || (option.truth && userId === subject);
  if (REVEALED.includes(room.phase) && room.result) {
    return room.result.options.map((option) => ({ ...option, authors: people(option.authors), pickedBy: people(option.pickedBy), yours: isYours(option, room.result.subject) }));
  }
  if (room.phase !== 'picking') return [];
  return room.options.map((option, n) => ({ n, text: option.text, yours: isYours(option, room.subject), canPick: mayPick(room, n, userId) }));
}

/**
 * One player as the table shows them to everybody.
 * @param {object} room  not changed
 * @param {object} p  the player
 * @param {{ nameOf: (id: *) => string, online: (id: *) => boolean, final: Map<*, object> }} context  the lookups
 * @returns {object} the player entry for the view
 * Side effects: none.
 */
function playerView(room, p, { nameOf, online, final }) {
  return {
    id: p.id,
    slot: p.slot, // how the client names this place when it asks for somebody to be removed (shared/layout.js)
    name: nameOf(p.id),
    score: p.score,
    online: isBot(p) || online(p.id),
    bot: isBot(p), // the client's name for "is a computer player"
    ai: isBot(p) && p.ai ? describeAI(aiById(AIS, p.ai)) : null, // computer players only, once a game has started
    subject: room.phase !== 'lobby' && p.id === room.subject,
    written: room.phase === 'writing' ? Boolean(answersOf(room, p.id)) : false,
    // Somebody whose made-up answer turned out to be the true one has nothing to pick, and is treated as having picked
    // it.  To everybody else they must look like any other player, or the table would know before the reveal that
    // one of the answers was written twice; so they are shown as having picked once the first real pick is in, never
    // from the moment the answers go up.
    picked: room.phase === 'picking' ? room.picks.some((pick) => pick.id === p.id) || (room.picks.length > 0 && Boolean(room.options[truthIndex(room)]?.authors.includes(p.id))) : false,
    ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : false,
    placement: final.get(p.id)?.placement ?? null,
    winner: final.get(p.id)?.winner ?? false,
  };
}

/**
 * The standard scoreboard (shared/scores.js): whoever the game is waiting for is `current` (the site's `global.slow`
 * clock reads it), and while the results are up each player shows whether they are ready to go on.
 * @param {object} room  not changed
 * @param {number | string} userId  the viewer
 * @param {{ nameOf: (id: *) => string, online: (id: *) => boolean }} context  the lookups
 * @returns {object} the scoreboard for the view
 * Side effects: none.
 */
function scoreboardView(room, userId, { nameOf, online }) {
  const waiting = new Set((room.phase === 'writing' ? room.players.filter((p) => !answersOf(room, p.id)) : room.phase === 'picking' ? toPick(room) : []).map((p) => p.id));
  const player = (p) => playerScoreboardEntry(p, { name: nameOf(p.id), me: userId, current: waiting.has(p.id), online, ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : undefined });
  return {
    players: room.players.map(player),
    rounds: historyView(room),
    lowIsBetter: false,
  };
}

/**
 * What one person may see.  Nobody sees anybody else's answer while they are being written; while they are being picked
 * the texts are on the table but not their writers; at the reveal everything is open.  Your own answers always come
 * back to you, so the form can show what you sent.
 * @param {object} room  not changed
 * @param {number | string} userId  the account looking
 * @param {{ nameOf?: (id: *) => string, online?: (id: *) => boolean, now?: number }} [options]  names for players who
 *   have left, who is connected, and the time (for the countdown)
 * @returns {object} the view sent to that person
 * Side effects: none.
 */
export function viewFor(room, userId, { nameOf = String, online = () => true, now = 0 } = {}) {
  nameOf = namer(room, nameOf);
  const member = hasPlayer(room, userId);
  const isSubject = room.subject !== null && room.subject === userId;
  const subjectName = room.subject === null ? '' : nameOf(room.subject);
  const final = finalStandings(room.players, ['finished', 'abandoned'].includes(room.phase));
  const truth = room.result ? room.result.options.find((option) => option.truth) ?? null : null;
  return {
    code: room.code,
    phase: room.phase,
    you: userId,
    hostId: room.hostId,
    rounds: room.rounds,
    turn: Math.min(room.turn + 1, Math.max(room.turnsTotal, 1)),
    turnsTotal: room.turnsTotal,
    question: room.question + 1,
    questionsPerTurn: room.questionsPerTurn,
    seconds: room.seconds,
    remaining: isTimed(room) ? Math.max(0, room.deadline - now) : null,
    subject: room.subject,
    subjectName,
    isSubject,
    prompts: member ? room.questions.map((question) => promptOf(question, subjectName, isSubject)) : [],
    yourAnswers: member ? answersOf(room, userId)?.texts.slice() ?? null : null,
    options: member ? optionsView(room, userId, nameOf) : [],
    yoursWasTrue: room.phase === 'picking' && Boolean(room.options[truthIndex(room)]?.authors.includes(userId)),
    truth: member && truth ? truth.text : null,
    points: POINTS,
    players: room.players.map((p) => playerView(room, p, { nameOf, online, final })),
    scoreboard: scoreboardView(room, userId, { nameOf, online }),
    size: roster.sizeOf(room), // the most who may join, which the host may lower in the lobby
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, rounds: ROUNDS, questions: QUESTIONS_EACH, time: SECONDS, answer: ANSWER_LENGTH },
  };
}

// ---------- computer players ----------

/**
 * The next thing a computer player has to do, or null: { type: 'write' | 'pick', id }.  Computer players never move on
 * from the reveal: that is up to the people (or the server's timeout).
 * @param {object} room  the room (not changed)
 * @returns {{ type: 'write' | 'pick', id: number | string } | null} the action, or null if no computer player is waiting
 * Side effects: none.
 */
export function pendingBotAction(room) {
  if (room.phase === 'writing') {
    const writer = room.players.find((p) => isBot(p) && !answersOf(room, p.id));
    return writer ? { type: 'write', id: writer.id } : null;
  }
  if (room.phase === 'picking') {
    const picker = toPick(room).find(isBot);
    return picker ? { type: 'pick', id: picker.id } : null;
  }
  return null;
}

/**
 * Plays one pending computer move.  The decision is made from that seat's own view (viewFor), so a computer player
 * never sees anything a person in its place would not.  An AI that throws or answers with something illegal is
 * replaced by a legal choice.
 * @param {object} room  the room (mutated by the move played)
 * @param {() => number} rng  random source handed to the AI
 * @param {object | null} [action]  the move to play (default: pendingBotAction)
 * @param {(id: *) => string} [nameOf]  name lookup for history labels
 * @param {number} [now]  the clock, which the next phase's deadline is measured from
 * @returns {boolean} true if a move was played successfully
 * Side effects: plays the move (submitAnswers or choose) and so changes the room as they do.
 */
export function runBotAction(room, rng, action = pendingBotAction(room), nameOf = String, now = 0) {
  if (!action) return false;
  const player = playerOf(room, action.id);
  const ai = aiById(AIS, player?.ai);
  // Runs an AI decision, turning a throw into undefined so that the fallbacks below take over.
  const attempt = (decide) => {
    try {
      return decide();
    } catch {
      return undefined; // a broken AI must not stop the game
    }
  };
  if (action.type === 'write') {
    const texts = room.questions.map((question, n) => {
      const pool = answersFor(question);
      const tried = attempt(() => ai.write({ pool: pool.slice(), offset: n }, rng));
      const clean = typeof tried === 'string' ? tried.replace(/\s+/g, ' ').trim().slice(0, ANSWER_LENGTH) : '';
      return answerProblem(clean) ? pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] ?? 'Who knows' : clean;
    });
    return submitAnswers(room, action.id, texts, rng, nameOf, now).ok;
  }
  const allowed = room.options.map((option, n) => n).filter((n) => mayPick(room, n, action.id));
  if (!allowed.length) return false;
  const chosen = attempt(() => ai.pick({ options: allowed.map((n) => room.options[n].text) }, rng));
  const index = Number.isInteger(chosen) && chosen >= 0 && chosen < allowed.length ? chosen : Math.floor(rng() * allowed.length);
  return choose(room, action.id, allowed[Math.min(allowed.length - 1, index)], nameOf).ok;
}
