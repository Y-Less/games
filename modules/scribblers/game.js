// The rules of Scribblers, with no sockets, files, or canvas.  A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error, params? }, where `error` is a code under `errors.` in the
// game's locale file or the site's (see MODULES.md, Languages); anything else the client shows is a message
// (shared/messages.js).  The drawing itself is NOT here: the strokes live in the socket layer (server.js), because they
// are a stream of thousands of instructions a turn that no view should carry and no save should keep.
//
// A turn: one player is the drawer.  They choose one of a few words, then draw it while everybody else types guesses.
// A guesser scores for getting it, the sooner the more, and the drawer scores the average of what the guessers got.
// Letters of the word are revealed as the time runs down.  When everybody has guessed, or the time is up, the word is
// shown and the next player draws.  A round is everybody drawing once.
//
// The turn rules (the scoring curve, the number of letters revealed, what counts as a close guess) follow scribble.rs
// (BSD 3-Clause; see README.md), which is where the word list comes from too.
//
// Depends on: shared/input.js (reading untrusted payloads), shared/messages.js (labels and notes), shared/scores.js
// (standings and scoreboard rows), shared/tally.js (statistics rows), shared/seats.js (result helpers), shared/roster.js
// (the lobby and player-list rules), ./tally.js (per-player counters), ./words.js (the word list and guess comparison).
import { numberFrom, textFrom } from '../../shared/input.js';
import { msg } from '../../shared/messages.js';
import { finalStandings, playerScoreboardEntry, standingsOf } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { fail, hostInLobby, isBot, ok } from '../../shared/seats.js';
import { createRosterRules, hasPlayer, humans, isHuman, migratePlayers, renameInHistory, seatOf } from '../../shared/roster.js';
import { newCounters, statsExtras, tallyTurn } from './tally.js';
import { DEFAULT_LANGUAGE, guessQuality, pickWords } from './words.js';

// Table size: two can play (one draws, one guesses), and twelve is as many guesses as the panel can show.
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
// The host's settings: how many times everybody draws, how long a drawing lasts, and how many words the drawer chooses from.
export const ROUNDS = { min: 1, max: 10, default: 3 };
export const DRAW_TIME = { min: 30, max: 240, default: 90 };
export const WORD_CHOICES = { min: 2, max: 5, default: 3 };
/** How long the drawer has to choose a word before one is chosen for them, in milliseconds (a room may be made with
 * another figure: the tests use a short one). */
export const CHOOSE_MS = 30000;
/** How long the word stays up between one turn and the next, in milliseconds (likewise). */
export const BETWEEN_MS = 6000;
/** The longest guess accepted, in characters (a guess is a word, not an essay). */
export const GUESS_LENGTH = 60;
/** How many guesses the panel keeps, and how fast one player may type: five in three seconds, as scribble.rs allows. */
const FEED_LENGTH = 60;
const TALK_BURST = 5;
const TALK_WINDOW_MS = 3000;

/** The scoring curve, from scribble.rs's "chill" scoring: a base, a bonus that decays over the drawing time, and a bonus
 * for every letter still hidden when the guess came in. */
const SCORING = { base: 100, timeBonus: 100, decline: 2, hintBonus: 60 };

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hattie', 'Ira', 'Jonas', 'Kit', 'Lula'];
// Phases in which the game is still going (the lobby counts as going).
const LIVE = ['lobby', 'choosing', 'drawing', 'between', 'scores'];
// Phases in which a turn is under way, so there is a drawer and a word (or a word about to be chosen).
const TURN = ['choosing', 'drawing', 'between'];
/** The characters of a word that are never hidden, because they are not what anybody is guessing. */
const ALWAYS_SHOWN = [' ', '-', '_', '.', '/'];

// The player-list vocabulary (who is in the room, and who is a person) is shared with the other party games.
export { hasPlayer, humans, isHuman, seatOf };

/**
 * Is the game still going (or still in the lobby)?
 * @param {object} room
 * @returns {boolean} false once it has finished
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);

/**
 * The player with this id, or undefined.
 * @param {object} room  the room
 * @param {number | string} id  a player id
 * @returns {object | undefined}
 * Side effects: none.
 */
const playerOf = (room, id) => room.players.find((p) => p.id === id);

/**
 * A function giving a player's name: the name saved with them, else `nameOf` (only rooms saved long ago lack names).
 * @param {object} room  the room
 * @param {(id: number | string) => string} nameOf  fallback lookup
 * @returns {(id: number | string) => string}
 * Side effects: none.
 */
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);

/**
 * Everybody who is not the drawer this turn: the people guessing.
 * @param {object} room  the room
 * @returns {object[]} the guessers
 * Side effects: none.
 */
const guessers = (room) => room.players.filter((p) => p.id !== room.drawer);

/**
 * Has this player already found the word this turn?
 * @param {object} room  the room
 * @param {number | string} id  the player
 * @returns {boolean}
 * Side effects: none.
 */
const hasGuessed = (room, id) => room.guessed.some((g) => g.id === id);

/**
 * May this player be shown the word (the drawer, and anybody who has already guessed it)?
 * @param {object} room  the room
 * @param {number | string} id  the player
 * @returns {boolean}
 * Side effects: none.
 */
const knowsWord = (room, id) => id === room.drawer || hasGuessed(room, id);

/**
 * Gives a bare player ({ kind, id, name }) the fields Scribblers keeps for everybody: the score, what they scored on the
 * turn just played, and the statistics counters.
 * @param {object} room  unused here; part of the shared makePlayer contract
 * @param {object} base  { kind: 'human' | 'bot', id, name? }
 * @returns {object} the player
 * Side effects: none.
 */
const makePlayer = (room, base) => ({ ...base, score: 0, lastScore: 0, roundStart: 0, drewThisRound: null, ...newCounters() });

/**
 * Makes a new room with the host in it.
 *
 * @param {object} args
 * @param {string} args.code        the invite code
 * @param {number} args.hostId      the host's account id
 * @param {string} [args.hostName]  the host's display name
 * @param {object} [args.settings]  what the host chose when creating it ({ rounds, drawTime, wordChoices }); an invalid
 *   setting is left at its default
 * @param {string} [args.language]  which word list to draw from (the host's language, if there is a list for it)
 * @param {number} args.now         the time to stamp it with
 * @returns {object} the room, in the lobby
 * Side effects: none outside the new room.
 */
export function createRoom({ code, hostId, hostName, settings = {}, language = DEFAULT_LANGUAGE, chooseMs = CHOOSE_MS, betweenMs = BETWEEN_MS, now }) {
  const room = {
    code,
    hostId,
    phase: 'lobby',
    language: typeof language === 'string' ? language : DEFAULT_LANGUAGE,
    chooseMs, // how long the drawer has to choose; the socket layer may shorten both of these for a test
    betweenMs, // how long the word stays up between turns
    rounds: ROUNDS.default,
    drawTime: DRAW_TIME.default,
    wordChoices: WORD_CHOICES.default,
    round: 0, // 1-based once the game starts
    turn: 0, // which place in the drawing order is drawing now
    order: [], // the ids of the players, in the order they draw
    players: [],
    nextBot: 1,
    drawer: null,
    choices: [], // the words offered to the drawer
    preChoice: 0, // which of them is chosen if they run out of time
    word: null,
    hints: [], // one per character of the word: { ch, fixed, shown }
    hintsLeft: 0,
    hintsTotal: 0,
    guessed: [], // [{ id, points }] in the order they found the word, this turn
    feed: [], // what the guess panel shows: [{ n, kind, id, name, text }]
    nextFeed: 1, // the number the next feed line gets, so the client can key them
    deadline: null, // when the current phase runs out (ms), or null when it does not
    nextHintAt: null, // when the next letter is revealed (ms), or null
    reveal: null, // between turns: { word, drawer, reason, points }
    ready: [], // between rounds: the people who have closed the scores
    used: [], // the words played this game
    history: [], // one entry per round, for the scoreboard
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
  room.players.push(makePlayer(room, typeof hostName === 'string' ? { kind: 'human', id: hostId, name: hostName } : { kind: 'human', id: hostId }));
  setSettings(room, hostId, settings); // a setting the host got wrong is simply left at its default
  return room;
}

/**
 * The lobby, joining, leaving, and computer-player rules, from shared/roster.js.  Somebody who leaves mid-game is
 * replaced by a computer player in their place, so the drawing order and the scores stay as they were (see takeOver).
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
 * The host changes the settings.  Only the settings that are given are changed, and one that is out of bounds is refused.
 *
 * @param {object} room
 * @param {number} id        who is asking (must be the host)
 * @param {object} settings  { rounds?, drawTime?, wordChoices? }
 * @returns {{ ok: boolean, error?: string, params?: object }}
 * Side effects: sets room.rounds, room.drawTime and room.wordChoices.
 */
export function setSettings(room, id, settings = {}) {
  const refused = hostInLobby(room, id);
  if (refused) return refused;
  for (const [key, bounds] of [
    ['rounds', ROUNDS],
    ['drawTime', DRAW_TIME],
    ['wordChoices', WORD_CHOICES],
  ]) {
    if (settings[key] === undefined) continue;
    const value = numberFrom(settings[key]);
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) return fail(key, { min: bounds.min, max: bounds.max });
    room[key] = value;
  }
  return ok();
}

/**
 * Scribblers has no "play again": a new game is made from the menu.  (The shared room server offers the event to every game.)
 * @returns {{ ok: false, error: string }}
 * Side effects: none.
 */
export function playAgain() {
  return fail('startFromMenu');
}

/**
 * The host starts the game: the drawing order is drawn, and the first player starts choosing a word.
 *
 * @param {object} room
 * @param {number} id   who is asking (must be the host)
 * @param {() => number} rng
 * @param {number} now  the clock, for the choosing deadline
 * @returns {{ ok: boolean, error?: string, params?: object }}
 * Side effects: sets the order, the round, and everything a turn needs (see beginTurn).
 */
export function start(room, id, rng, now) {
  if (id !== room.hostId) return fail('hostOnlyStart');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (room.players.length < MIN_PLAYERS) return fail('minPlayers', { min: MIN_PLAYERS });
  room.order = shuffled(room.players.map((p) => p.id), rng);
  room.round = 1;
  room.turn = 0;
  room.used = [];
  room.feed = [];
  room.history = [];
  for (const p of room.players) {
    p.roundStart = p.score;
    p.drewThisRound = null;
  }
  beginTurn(room, rng, now);
  return ok();
}

/**
 * A copy of a list in a random order (Fisher-Yates).
 * @param {Array} items  not changed
 * @param {() => number} rng  random source
 * @returns {Array} the shuffled copy
 * Side effects: none beyond advancing `rng`.
 */
function shuffled(items, rng) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Sets the room up for the next drawer: they are offered words to choose from, and have CHOOSE_MS to pick one.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the words
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: sets drawer, choices, preChoice, word, hints, guessed, reveal, deadline, nextHintAt and phase ('choosing').
 */
function beginTurn(room, rng, now) {
  room.drawer = room.order[room.turn] ?? null;
  room.choices = pickWords(room.wordChoices, room.used, rng, room.language);
  room.preChoice = Math.min(room.choices.length - 1, Math.floor(rng() * room.choices.length));
  room.word = null;
  room.hints = [];
  room.hintsLeft = 0;
  room.hintsTotal = 0;
  room.guessed = [];
  room.reveal = null;
  room.deadline = now + (room.chooseMs ?? CHOOSE_MS);
  room.nextHintAt = null;
  room.phase = 'choosing';
}

/**
 * How many letters of a word are revealed as the time runs out: none of a very short word, up to three of a long one
 * (scribble.rs's steps).
 * @param {string} word  the word
 * @returns {number} how many letters will be shown
 * Side effects: none.
 */
function hintCount(word) {
  const letters = [...word].filter((ch) => !ALWAYS_SHOWN.includes(ch)).length;
  if (letters <= 2) return 0;
  if (letters <= 4) return 1;
  if (letters <= 9) return 2;
  return 3;
}

/**
 * The drawer chooses one of the words they were offered and the drawing starts.
 *
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is choosing (must be the drawer)
 * @param {number} n  which word, as its place in the list the drawer was shown
 * @param {number} now  the clock, for the drawing deadline
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets word, used, hints, hintsLeft, hintsTotal, deadline, nextHintAt and phase ('drawing').
 */
export function chooseWord(room, id, n, now) {
  if (room.phase !== 'choosing') return fail('notChoosing');
  if (id !== room.drawer) return fail('drawerOnlyChooses');
  const place = numberFrom(n);
  if (!Number.isInteger(place) || place < 0 || place >= room.choices.length) return fail('pickAWord');
  const word = room.choices[place];
  room.word = word;
  room.used.push(word);
  const drawer = playerOf(room, room.drawer);
  if (drawer) drawer.drewThisRound = word;
  room.choices = [];
  room.hints = [...word].map((ch) => ({ ch, fixed: ALWAYS_SHOWN.includes(ch), shown: ALWAYS_SHOWN.includes(ch) }));
  room.hintsTotal = hintCount(word);
  room.hintsLeft = room.hintsTotal;
  room.deadline = now + room.drawTime * 1000;
  room.nextHintAt = nextHintTime(room, now);
  room.phase = 'drawing';
  return ok();
}

/**
 * When the next letter is due: the drawing time is divided evenly by the letters to come, so the last one is shown for a
 * fair share of the time (scribble.rs's rule).
 * @param {object} room  the room
 * @param {number} now  the clock
 * @returns {number | null} the time the next letter is shown, or null when there are none left
 * Side effects: none.
 */
function nextHintTime(room, now) {
  if (room.hintsLeft <= 0 || room.deadline === null) return null;
  const every = (room.drawTime * 1000) / (room.hintsTotal + 1);
  const at = room.deadline - every * room.hintsLeft;
  return Math.max(now, at);
}

/**
 * Shows one more letter of the word to the guessers.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for which letter
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets one hint's `shown`, lowers hintsLeft, and moves nextHintAt on.
 */
export function revealHint(room, rng, now) {
  if (room.phase !== 'drawing' || room.hintsLeft <= 0) return fail('noHintDue');
  const hidden = room.hints.flatMap((hint, i) => (hint.shown ? [] : [i]));
  if (!hidden.length) {
    room.hintsLeft = 0;
    room.nextHintAt = null;
    return ok();
  }
  room.hints[hidden[Math.min(hidden.length - 1, Math.floor(rng() * hidden.length))]].shown = true;
  room.hintsLeft--;
  room.nextHintAt = nextHintTime(room, now);
  return ok();
}

/**
 * What a guesser scores for finding the word now: a base, a bonus that falls away as the drawing time runs out, and a
 * bonus for every letter still hidden (scribble.rs's "chill" scoring).
 * @param {object} room  the room
 * @param {number} now  the clock
 * @returns {number} the points, a whole number
 * Side effects: none.
 */
function guesserPoints(room, now) {
  const secondsLeft = Math.max(0, Math.round(((room.deadline ?? now) - now) / 1000));
  const used = Math.max(0, room.drawTime - secondsLeft);
  const decline = SCORING.decline / room.drawTime;
  let points = Math.round(SCORING.base + SCORING.timeBonus * (1 - decline) ** used);
  if (room.hintsTotal > 0) points += room.hintsLeft * Math.floor(SCORING.hintBonus / room.hintsTotal);
  return points;
}

/**
 * A player's guess, or a word to the others while no word is being guessed.  A guess that is right scores and is not
 * shown to the table (it would give the word away); one that is nearly right is shown, and its writer is told it was
 * close; anything else is simply shown.  The drawer, and anybody who has already guessed, can only talk to each other.
 *
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is guessing
 * @param {string} text  what they typed
 * @param {number} now  the clock, for the scoring and the rate limit
 * @returns {{ ok: boolean, error?: string, params?: object, quality?: string }} `quality` is 'exact', 'close', 'wrong'
 *   or 'chat'
 * Side effects: adds a line to room.feed; a right guess scores and may end the turn (see endTurn).
 */
export function guess(room, id, text, now) {
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (!TURN.includes(room.phase) && room.phase !== 'scores') return fail('notPlaying');
  const player = playerOf(room, id);
  const clean = textFrom(text).replace(/\s+/g, ' ').trim().slice(0, GUESS_LENGTH);
  if (!clean) return fail('typeGuess');
  if (tooFast(player, now)) return fail('tooFast');
  // Outside the drawing, or for somebody who already knows the word, it is talk rather than a guess.
  if (room.phase !== 'drawing' || knowsWord(room, id)) {
    addFeed(room, { kind: 'chat', id, name: player.name, text: clean, private: room.phase === 'drawing' });
    return ok({ quality: 'chat' });
  }
  const quality = guessQuality(clean, room.word);
  if (quality === 'exact') {
    const points = guesserPoints(room, now);
    room.guessed.push({ id, points });
    player.lastScore = points;
    player.score += points;
    addFeed(room, { kind: 'correct', id, name: player.name, text: '' });
    if (guessers(room).every((p) => hasGuessed(room, p.id) || isBot(p))) endTurn(room, 'allGuessed', now);
    return ok({ quality });
  }
  addFeed(room, { kind: quality === 'close' ? 'close' : 'guess', id, name: player.name, text: clean });
  return ok({ quality });
}

/**
 * Is this player typing faster than the game allows (five in three seconds, as scribble.rs allows)?
 * @param {object} player  the player (mutated: their recent times are kept on them)
 * @param {number} now  the clock
 * @returns {boolean} true if this one should be refused
 * Side effects: records `now` in the player's recent times and drops the ones that have fallen out of the window.
 */
function tooFast(player, now) {
  player.talk = (player.talk ?? []).filter((at) => now - at < TALK_WINDOW_MS);
  if (player.talk.length >= TALK_BURST) return true;
  player.talk.push(now);
  return false;
}

/**
 * Adds a line to the guess panel, keeping only the last FEED_LENGTH of them.
 * @param {object} room  the room (mutated)
 * @param {object} line  { kind, id, name, text, private? }
 * @returns {void}
 * Side effects: pushes onto room.feed, trims it, and uses up one number from room.nextFeed.
 */
function addFeed(room, line) {
  room.feed.push({ n: room.nextFeed++, ...line });
  if (room.feed.length > FEED_LENGTH) room.feed = room.feed.slice(-FEED_LENGTH);
}

/**
 * Ends the turn: the drawer scores the average of what the guessers scored, the word is shown to everybody, and the room
 * waits BETWEEN_MS before the next drawer starts.
 *
 * @param {object} room  the room (mutated)
 * @param {'allGuessed' | 'timeUp' | 'drawerAway'} reason  why the turn ended, which the table tells the players
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: scores, bumps the statistics counters, sets room.reveal, the deadline and phase ('between').
 */
function endTurn(room, reason, now) {
  const drawer = playerOf(room, room.drawer);
  const scored = guessers(room).filter((p) => isHuman(p) || hasGuessed(room, p.id));
  const total = scored.reduce((sum, p) => sum + (room.guessed.find((g) => g.id === p.id)?.points ?? 0), 0);
  const average = scored.length ? Math.floor(total / scored.length) : 0;
  if (drawer) {
    drawer.lastScore = average;
    drawer.score += average;
  }
  const points = Object.fromEntries(room.guessed.map((g) => [g.id, g.points]));
  if (drawer && average) points[drawer.id] = average;
  for (const p of guessers(room)) if (!hasGuessed(room, p.id)) p.lastScore = 0;
  tallyTurn({ drawer, guessed: room.guessed.map((g) => playerOf(room, g.id)).filter(Boolean), guessers: guessers(room), reason, average });
  room.reveal = { word: room.word, drawer: room.drawer, reason, points, guessed: room.guessed.map((g) => g.id) };
  for (const hint of room.hints) hint.shown = true;
  room.deadline = now + (room.betweenMs ?? BETWEEN_MS);
  room.nextHintAt = null;
  room.phase = 'between';
}

/**
 * Moves on from the word being shown: the next player draws, or, at the end of a round, the scores go up (and after the
 * last round the game is over).
 *
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the next words
 * @param {number} now  the clock
 * @param {(id: *) => string} [nameOf]  name lookup for the scoreboard label
 * @returns {{ ok: boolean, error?: string, finished?: boolean }} `finished` is true when that was the last turn
 * Side effects: sets up the next turn, or pushes a scoreboard round and sets phase 'scores' or 'finished'.
 */
export function nextTurn(room, rng, now, nameOf = String) {
  if (room.phase !== 'between') return fail('nothingToMoveOn');
  room.turn++;
  if (room.turn < room.order.length) {
    beginTurn(room, rng, now);
    return ok({ finished: false });
  }
  endRound(room, namer(room, nameOf));
  if (room.round >= room.rounds) {
    room.phase = 'finished';
    room.deadline = null;
    return ok({ finished: true });
  }
  room.phase = 'scores';
  room.ready = [];
  room.deadline = null;
  return ok({ finished: false });
}

/**
 * Writes the round into the scoreboard history: what everybody scored over the round, and the words they drew.
 * @param {object} room  the room (mutated)
 * @param {(id: *) => string} nameOf  name lookup (unused in the label, kept for the message's sake)
 * @returns {void}
 * Side effects: pushes onto room.history and clears each player's round total.
 */
function endRound(room, nameOf) {
  const deltas = {};
  const notes = {};
  for (const p of room.players) {
    deltas[p.id] = p.score - (p.roundStart ?? 0);
    p.roundStart = p.score;
    if (p.drewThisRound) notes[p.id] = msg('notes.drew', { word: p.drewThisRound });
    p.drewThisRound = null;
  }
  room.history.push({ label: msg('scoreboard.round', { n: room.round, of: room.rounds }), deltas, notes });
}

/**
 * At the end of a round, a person has closed the scores and is ready for the next one; when everybody has, it starts.
 *
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is ready
 * @param {() => number} rng  random source for the next words
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string, started?: boolean }} `started` is true when the next round has just begun
 * Side effects: adds to room.ready and may start the next round (see startRound).
 */
export function ready(room, id, rng, now) {
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (room.phase !== 'scores') return fail('noScoresToClose');
  if (!room.ready.includes(id)) room.ready.push(id);
  if (unready(room).length) return ok({ started: false });
  startRound(room, rng, now);
  return ok({ started: true });
}

/**
 * Starts the next round whether or not everybody has closed the scores (the server does this after a wait).
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the next words
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as startRound.
 */
export function forceNextRound(room, rng, now) {
  if (room.phase !== 'scores') return fail('nothingToMoveOn');
  startRound(room, rng, now);
  return ok();
}

/**
 * Begins a round: everybody draws once, in a fresh order.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: sets round, order, turn, ready, and everything a turn needs (see beginTurn).
 */
function startRound(room, rng, now) {
  room.round++;
  room.order = shuffled(room.players.map((p) => p.id), rng);
  room.turn = 0;
  room.ready = [];
  beginTurn(room, rng, now);
}

/**
 * The people who have yet to close the scores (computer players never need to).
 * @param {object} room  the room
 * @returns {object[]}
 * Side effects: none.
 */
const unready = (room) => humans(room).filter((p) => !(room.ready ?? []).includes(p.id));

/**
 * Whatever the clock owes the room now that its deadline has passed: the word is chosen for a drawer who did not choose,
 * the drawing ends when the time is up, and the word stops being shown when its moment has passed.
 *
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source
 * @param {number} now  the clock
 * @param {(id: *) => string} [nameOf]  name lookup for the scoreboard label
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as chooseWord, endTurn or nextTurn, whichever the phase calls for.
 */
export function timeUp(room, rng, now, nameOf = String) {
  if (room.phase === 'choosing') return chooseWord(room, room.drawer, room.preChoice, now);
  if (room.phase === 'drawing') {
    endTurn(room, 'timeUp', now);
    return ok();
  }
  if (room.phase === 'between') return nextTurn(room, rng, now, nameOf);
  return fail('nothingToMoveOn');
}

/**
 * Ends the turn of a drawer who cannot draw it: one who has gone, or a computer player standing in for them.
 *
 * @param {object} room  the room (mutated)
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as endTurn (nobody scores, since nobody can have guessed).
 */
export function skipTurn(room, now) {
  if (!['choosing', 'drawing'].includes(room.phase)) return fail('nothingToSkip');
  endTurn(room, 'drawerAway', now);
  return ok();
}

/**
 * Is the drawing of this turn in the hands of a computer player (somebody left and it took their place)?
 * @param {object} room  the room
 * @returns {boolean}
 * Side effects: none.
 */
export const drawerIsBot = (room) => ['choosing', 'drawing'].includes(room.phase) && isBot(playerOf(room, room.drawer));

/**
 * Scribblers's part of a computer player taking the place of a person who left a game under way (the roster has already
 * put it in the list, with their score and counters): everything that named the person now names it, and a round that
 * was only waiting for that person to close the scores moves on.
 *
 * @param {object} room
 * @param {number} oldId  the account id of the person who left
 * @param {object} bot    the computer player now in their place
 * @returns {void}
 * Side effects: mutates the room (the order, the drawer, the guesses, the feed, the reveal, the ready list, the history).
 */
function takeOver(room, oldId, bot) {
  const renamed = (x) => (x === oldId ? bot.id : x);
  room.order = room.order.map(renamed);
  room.drawer = renamed(room.drawer);
  for (const entry of room.guessed) entry.id = renamed(entry.id);
  for (const line of room.feed) if (line.id === oldId) Object.assign(line, { id: bot.id, name: bot.name });
  if (room.reveal) {
    room.reveal.drawer = renamed(room.reveal.drawer);
    room.reveal.guessed = room.reveal.guessed.map(renamed);
    if (Object.hasOwn(room.reveal.points, oldId)) {
      room.reveal.points[bot.id] = room.reveal.points[oldId];
      delete room.reveal.points[oldId];
    }
  }
  room.ready = (room.ready ?? []).filter((x) => x !== oldId); // a computer player is always ready, so it needs no entry
  renameInHistory(room, oldId, bot.id);
}

/**
 * Brings a saved room up to date, so that rooms written before a change still load.
 *
 * @param {object} room
 * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
 * @returns {object} the same room
 * Side effects: mutates the room.  Running it twice changes nothing more.
 */
export function migrate(room, nameOf) {
  migratePlayers(room, nameOf);
  room.used ??= [];
  room.order ??= [];
  room.guessed ??= [];
  room.feed ??= [];
  room.ready ??= [];
  room.hints ??= [];
  room.choices ??= [];
  room.nextFeed ??= room.feed.length + 1;
  room.language ??= DEFAULT_LANGUAGE;
  room.chooseMs ??= CHOOSE_MS;
  room.betweenMs ??= BETWEEN_MS;
  if (!Array.isArray(room.history)) room.history = [];
  return room;
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

/**
 * The word as one person may see it: the whole word for the drawer, for anybody who has guessed it, and for everybody
 * once the turn is over; otherwise the letters that have been revealed, with the rest as blanks.
 *
 * @param {object} room  not changed
 * @param {number | string} userId  the viewer
 * @returns {{ ch: string | null, fixed: boolean, shown: boolean }[]} one entry per character
 * Side effects: none.
 */
function hintsFor(room, userId) {
  const open = knowsWord(room, userId) || ['between', 'scores', 'finished'].includes(room.phase);
  return room.hints.map((hint) => ({ ch: open || hint.shown ? hint.ch : null, fixed: hint.fixed, shown: hint.shown }));
}

/**
 * The guess panel as one person sees it: a guess that was close is marked only for the person who wrote it, and what the
 * people who know the word say to each other is kept from the ones still guessing.
 *
 * @param {object} room  not changed
 * @param {number | string} userId  the viewer
 * @returns {object[]} the lines to show
 * Side effects: none.
 */
function feedFor(room, userId) {
  const inTheKnow = knowsWord(room, userId) || !TURN.includes(room.phase);
  return room.feed
    .filter((line) => !line.private || inTheKnow)
    .map(({ n, kind, id, name, text }) => ({ n, kind: kind === 'close' && id !== userId ? 'guess' : kind, id, name, text }));
}

/**
 * One player as the table shows them to everybody.
 * @param {object} room  not changed
 * @param {object} p  the player
 * @param {{ online: (id: *) => boolean, final: Map<*, object>, nameOf: (id: *) => string }} context
 * @returns {object} the player entry for the view
 * Side effects: none.
 */
function playerView(room, p, { online, final, nameOf }) {
  return {
    id: p.id,
    name: nameOf(p.id),
    score: p.score,
    lastScore: p.lastScore ?? 0,
    online: isBot(p) || online(p.id),
    bot: isBot(p),
    drawing: p.id === room.drawer && TURN.includes(room.phase),
    guessed: hasGuessed(room, p.id),
    ready: room.phase === 'scores' ? isBot(p) || (room.ready ?? []).includes(p.id) : false,
    placement: final.get(p.id)?.placement ?? null,
    winner: final.get(p.id)?.winner ?? false,
  };
}

/**
 * The standard scoreboard (shared/scores.js): whoever the game is waiting for is `current` - the drawer while they
 * choose or draw, and everybody still to guess while a drawing is going on.
 *
 * @param {object} room  not changed
 * @param {number | string} userId  the viewer
 * @param {{ online: (id: *) => boolean, nameOf: (id: *) => string }} context
 * @returns {object} the scoreboard for the view
 * Side effects: none.
 */
function scoreboardView(room, userId, { online, nameOf }) {
  const mustAct = (p) => {
    if (room.phase === 'choosing') return p.id === room.drawer;
    if (room.phase === 'drawing') return p.id === room.drawer || !hasGuessed(room, p.id);
    return false;
  };
  const player = (p) =>
    playerScoreboardEntry(p, { name: nameOf(p.id), me: userId, current: mustAct(p), online, ready: room.phase === 'scores' ? isBot(p) || (room.ready ?? []).includes(p.id) : undefined });
  return { players: room.players.map(player), rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })), lowIsBetter: false };
}

/**
 * What one person may see.  A guesser never sees the word, the words the drawer is choosing between, or anybody's
 * correct guess; the drawer sees the word and may draw.
 *
 * @param {object} room  not changed
 * @param {number | string} userId  the account looking
 * @param {object} [options]
 * @param {(id: *) => string} [options.nameOf]  names for players who have left
 * @param {(id: *) => boolean} [options.online]  who is connected
 * @param {number} [options.now]  the clock, so the view can say how long is left
 * @returns {object} the view sent to that person
 * Side effects: none.
 */
export function viewFor(room, userId, { nameOf = String, online = () => true, now = 0 } = {}) {
  nameOf = namer(room, nameOf);
  const final = finalStandings(room.players, room.phase === 'finished');
  const isDrawer = room.drawer === userId && TURN.includes(room.phase);
  return {
    code: room.code,
    phase: room.phase,
    you: userId,
    hostId: room.hostId,
    round: room.round,
    rounds: room.rounds,
    turn: room.turn + 1,
    turns: room.order.length,
    drawer: room.drawer,
    drawerName: room.drawer === null ? null : nameOf(room.drawer),
    youDraw: isDrawer,
    word: knowsWord(room, userId) || ['between', 'scores', 'finished'].includes(room.phase) ? room.word : null,
    hints: hintsFor(room, userId),
    choices: room.phase === 'choosing' && isDrawer ? room.choices : [],
    guessedCount: room.guessed.length,
    youGuessed: hasGuessed(room, userId),
    feed: feedFor(room, userId),
    reveal: room.phase === 'between' ? room.reveal : null,
    remaining: room.deadline === null ? null : Math.max(0, room.deadline - now),
    drawTime: room.drawTime,
    players: room.players.map((p) => playerView(room, p, { online, final, nameOf })),
    scoreboard: scoreboardView(room, userId, { online, nameOf }),
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, rounds: ROUNDS, drawTime: DRAW_TIME, wordChoices: WORD_CHOICES },
    settings: { rounds: room.rounds, drawTime: room.drawTime, wordChoices: room.wordChoices },
  };
}

/**
 * May this person put strokes on the canvas right now?  The socket layer asks before it relays anything.
 * @param {object} room  the room
 * @param {number | string} id  the player
 * @returns {boolean}
 * Side effects: none.
 */
export const canDraw = (room, id) => room.phase === 'drawing' && room.drawer === id;
