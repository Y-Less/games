// The rules of Draw!, with no sockets, no files and no canvas: a room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error, params? }, where `error` is a code under `errors.` in
// the game's locale file or the site's (see MODULES.md, Languages).
//
// A round: TWO players draw at once, each their own word, and everybody else races to guess either drawing.  The
// first drawing anybody names wins the round, and only that drawer and that guesser score.  A game plays every pair
// of players (`cycles` times over), so at a table of four everybody draws three times, over six rounds.
//
// It is meant to be quick: five seconds to pick a word, no letters revealed, and no scores to close between rounds.
// The drawings themselves are not in the view - see server.js, and shared/drawing.js.
//
// Depends on: shared/input.js, shared/messages.js, shared/scores.js, shared/seats.js, shared/roster.js (the lobby),
// shared/tally.js, shared/words.js (the word list and comparing a guess), ./pairings.js (who draws against whom) and
// ./tally.js (the counters).
import { numberFrom, textFrom } from '../../shared/input.js';
import { msg } from '../../shared/messages.js';
import { finalStandings, playerScoreboardEntry, standingsOf } from '../../shared/scores.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { createRosterRules, defaultPlayers, hasPlayer, historyView, humans, isBot, isHuman, migratePlayers, seatOf, withSlot } from '../../shared/roster.js';
import { statsRows } from '../../shared/tally.js';
import { DEFAULT_LANGUAGE, guessQuality, pickWords, wordList } from '../../shared/words.js';
import { AI } from './ai.js';
import { pairings } from './pairings.js';
import { newCounters, statsExtras, tallyGuess, tallyRound } from './tally.js';

/** Two to draw and at least one to guess. */
export const MIN_PLAYERS = 3;
/** Every pair of players draws, so the rounds grow fast: eight is twenty-eight rounds already. */
export const MAX_PLAYERS = 8;
/** How many a new game is for, until the host says otherwise. */
export const DEFAULT_PLAYERS = defaultPlayers(MIN_PLAYERS, MAX_PLAYERS);
/** How many times the game runs through every pair of drawers. */
export const CYCLES = { min: 1, max: 5, default: 1 };
/** How long a drawing lasts, in seconds. */
export const DRAW_TIME = { min: 10, max: 120, default: 45 };
/** How many words a drawer is offered. */
export const WORD_CHOICES = { min: 2, max: 5, default: 3 };
/** How long a drawer has to pick a word.  Five seconds: this is a quick-fire game, and both of them are waiting. */
export const CHOOSE_MS = 5000;
/** How long the two words stay up before the next round.  No scores to close: the game simply carries on. */
export const BETWEEN_MS = 4000;
/** The longest a guess may be. */
export const GUESS_LENGTH = 60;
/** What the drawer and the guesser each score for a drawing that is named. */
export const POINT = 1;

const FEED_LENGTH = 60;
const TALK_BURST = 5;
const TALK_WINDOW_MS = 3000;
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hattie'];
const LIVE = ['lobby', 'choosing', 'drawing', 'between'];
/** The phases in which a round is under way. */
const ROUND = ['choosing', 'drawing', 'between'];
/** Characters a guesser always sees in the shape of a word, because they are not letters to be guessed. */
const ALWAYS_SHOWN = [' ', '-', '_', '.', '/'];

export { hasPlayer, humans, isBot, isHuman, seatOf };

/**
 * Is the game still going (or still in the lobby)?
 * @param {object} room  not changed
 * @returns {boolean} false once it has finished
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);

/**
 * The player with this id, or undefined.
 * @param {object} room  not changed
 * @param {number | string} id  a player id
 * @returns {object | undefined}
 * Side effects: none.
 */
const playerOf = (room, id) => room.players.find((p) => p.id === id);

/**
 * Is this player one of the two drawing this round?
 * @param {object} room  not changed
 * @param {number | string} id  a player id
 * @returns {boolean}
 * Side effects: none.
 */
export const isDrawer = (room, id) => (room.drawers ?? []).includes(id);

/**
 * The players who are guessing this round: everybody who is not drawing.
 * @param {object} room  not changed
 * @returns {object[]}
 * Side effects: none.
 */
const guessers = (room) => room.players.filter((p) => !isDrawer(room, p.id));

/**
 * A name lookup that prefers the name saved with the player (only rooms saved long ago lack one).
 * @param {object} room  not changed
 * @param {(id: *) => string} nameOf  fallback lookup
 * @returns {(id: *) => string}
 * Side effects: none.
 */
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);

/**
 * Gives a bare player ({ kind, id, name }) the fields Draw! keeps for everybody: the score, what they scored last
 * round, and the statistics counters.
 * @param {object} room  unused here; part of the shared makePlayer contract
 * @param {object} base  { kind: 'human' | 'bot', id, name? }
 * @returns {object} the player
 * Side effects: none.
 */
const makePlayer = (room, base) => ({ ...base, score: 0, lastScore: 0, tries: 0, ...newCounters() });

/**
 * Makes a new room with the host in it.
 *
 * @param {object} args
 * @param {string} args.code  the invite code
 * @param {number} args.hostId  the host's account id
 * @param {string} [args.hostName]  the host's display name
 * @param {object} [args.settings]  what the host chose when creating it; an invalid setting is left at its default
 * @param {string} [args.language]  which word list to draw from
 * @param {number} [args.chooseMs]  how long a drawer has to pick (the socket layer shortens it for a test)
 * @param {number} [args.betweenMs]  how long the words stay up between rounds
 * @param {number} args.now  the time to stamp it with
 * @returns {object} the room, in the lobby
 * Side effects: none outside the new room.
 */
export function createRoom({ code, hostId, hostName, settings = {}, language = DEFAULT_LANGUAGE, chooseMs = CHOOSE_MS, betweenMs = BETWEEN_MS, now }) {
  const room = {
    code,
    hostId,
    phase: 'lobby',
    language: typeof language === 'string' ? language : DEFAULT_LANGUAGE,
    chooseMs,
    betweenMs,
    cycles: CYCLES.default,
    drawTime: DRAW_TIME.default,
    wordChoices: WORD_CHOICES.default,
    round: 0, // 1-based once the game starts
    order: [], // the pairs of drawers, in the order they draw (see pairings.js)
    players: [],
    size: MAX_PLAYERS, // the most who may join; the host may set it lower, and starting settles it for good
    nextBot: 1,
    drawers: [], // the two drawing this round
    choices: {}, // drawer id -> the words they were offered
    preChoice: {}, // drawer id -> which of them the clock picks for them
    words: {}, // drawer id -> the word they are drawing, once they have chosen
    winner: null, // { drawer, guesser, word } once a drawing has been named
    feed: [], // what the guess panel shows: [{ n, kind, id, name, text }]
    nextFeed: 1,
    deadline: null, // when this phase runs out (ms), or null
    reveal: null, // between rounds: { words, winner }
    used: [], // the words played this game
    history: [], // one entry per round, for the scoreboard
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
  room.players.push(withSlot(room, makePlayer(room, typeof hostName === 'string' ? { kind: 'human', id: hostId, name: hostName } : { kind: 'human', id: hostId })));
  setSettings(room, hostId, settings);
  return room;
}

/**
 * Brings a saved room up to date.
 * @param {object} room  the room to bring up to date
 * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
 * @returns {object} the same room
 * Side effects: mutates the room.  Running it twice changes nothing more.
 */
export function migrate(room, nameOf) {
  migratePlayers(room, nameOf, { maxPlayers: MAX_PLAYERS });
  room.drawers ??= [];
  room.choices ??= {};
  room.preChoice ??= {};
  room.words ??= {};
  room.used ??= [];
  room.feed ??= [];
  room.nextFeed ??= 1;
  room.order ??= [];
  room.cycles ??= CYCLES.default;
  if (!Array.isArray(room.history)) room.history = [];
  for (const player of room.players) {
    player.score ??= 0;
    player.lastScore ??= 0;
    player.tries ??= 0;
    Object.assign(player, { ...newCounters(), ...player });
  }
  return room;
}

// ---------- the lobby ----------

/**
 * Renames one player's id everywhere this game writes one down: the pairs still to be drawn, the two drawing now,
 * their words and choices, the winner, the guess panel and the scoreboard history.  A place changes hands in both
 * directions - a computer player takes a person's when they leave, and a latecomer takes a computer player's - and
 * both are this same renaming.
 *
 * @param {object} room  the room to change
 * @param {number | string} from  the id leaving
 * @param {number | string} to  the id taking its place
 * @param {string} [name]  the new name, for lines already in the guess panel
 * @returns {void}
 * Side effects: mutates the room's own fields and its scoreboard history.
 */
function renameId(room, from, to, name) {
  const renamed = (x) => (x === from ? to : x);
  const rekey = (table) => Object.fromEntries(Object.entries(table ?? {}).map(([key, value]) => [String(key) === String(from) ? to : key, value]));
  room.order = room.order.map((pair) => pair.map(renamed));
  room.drawers = room.drawers.map(renamed);
  room.choices = rekey(room.choices);
  room.preChoice = rekey(room.preChoice);
  room.words = rekey(room.words);
  if (room.winner) {
    room.winner.drawer = renamed(room.winner.drawer);
    room.winner.guesser = renamed(room.winner.guesser);
  }
  if (room.reveal?.winner) {
    room.reveal.winner.drawer = renamed(room.reveal.winner.drawer);
    room.reveal.winner.guesser = renamed(room.reveal.winner.guesser);
  }
  if (room.reveal) room.reveal.words = rekey(room.reveal.words);
  for (const line of room.feed) {
    if (line.id === from) {
      line.id = to;
      if (name) line.name = name;
    }
  }
  // The scoreboard history is not renamed: it is written by slot, and the slot goes with the place.
}

/**
 * A computer player has taken the place of somebody who left: everything that named them now names it.
 * @param {object} room  the room to change
 * @param {number} oldId  the account id of the person who left
 * @param {object} bot  the computer player now in their place
 * @returns {void}
 * Side effects: as renameId.
 */
const takeOver = (room, oldId, bot) => renameId(room, oldId, bot.id, bot.name);

/**
 * The mirror of takeOver: somebody arriving has taken a computer player's place.
 * @param {object} room  the room to change
 * @param {string} botId  the computer player whose place was taken
 * @param {object} person  the newcomer, already in its place in the list
 * @returns {void}
 * Side effects: as renameId.
 */
const handOver = (room, botId, person) => renameId(room, botId, person.id, person.name);

/**
 * The lobby, joining, leaving and computer-player rules, from shared/roster.js.
 * Side effects: each rule it provides mutates the room's player list.
 */
const roster = createRosterRules({ isLive, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, botNames: BOT_NAMES, makePlayer, takeOver, handOver });
export const { addHuman, removeHuman, addBot, removeBot, fillWithBots, kick } = roster;

// ---------- settings ----------

/** The settings the host may choose, and what each one will take. */
const SETTINGS = { cycles: CYCLES, drawTime: DRAW_TIME, wordChoices: WORD_CHOICES };

/**
 * The host changes the settings.  Only the settings that are given are changed, and one that is out of bounds is
 * refused without changing any of them, so the room is never left half changed.
 *
 * @param {object} room  the room to change
 * @param {number} id  who is asking (must be the host)
 * @param {object} [settings]  { cycles?, drawTime?, wordChoices? }
 * @returns {{ ok: boolean, error?: string, params?: object }}
 * Side effects: may set room.cycles, room.drawTime and room.wordChoices.
 */
export function setSettings(room, id, settings = {}) {
  const refused = hostInLobby(room, id);
  if (refused) return refused;
  if (settings.size !== undefined) {
    const sized = roster.setSize(room, id, settings.size);
    if (!sized.ok) return sized;
  }
  const wanted = {};
  for (const [key, bounds] of Object.entries(SETTINGS)) {
    if (settings[key] === undefined) continue;
    const n = Math.round(numberFrom(settings[key]));
    if (!Number.isFinite(n) || n < bounds.min || n > bounds.max) return fail(key, { min: bounds.min, max: bounds.max });
    wanted[key] = n;
  }
  Object.assign(room, wanted);
  return ok();
}

/**
 * How many rounds a game of this size will take: every pair of players, as many times over as the host asked for.
 * @param {object} room  not changed
 * @returns {number}
 * Side effects: none.
 */
export const roundsInGame = (room) => ((room.players.length * (room.players.length - 1)) / 2) * room.cycles;

// ---------- the game ----------

/**
 * The host starts the game: the drawing order is worked out (see pairings.js) and the first pair choose their words.
 * @param {object} room  the room to change
 * @param {number} id  who is asking (must be the host)
 * @param {() => number} rng  random source for the order and the words
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string, params?: object }}
 * Side effects: resets the players and the history, sets the order, and enters the 'choosing' phase.
 */
export function start(room, id, rng, now) {
  if (id !== room.hostId) return fail('hostOnlyStart');
  if (room.phase !== 'lobby') return fail('alreadyStarted');
  if (room.players.length < MIN_PLAYERS) return fail('minPlayers', { min: MIN_PLAYERS });
  roster.lockSize(room); // the game is for whoever is here now; a place kept open is a computer player holding it
  room.order = pairings(room.players.map((p) => p.id), room.cycles, rng);
  room.round = 0;
  room.used = [];
  room.feed = [];
  room.history = [];
  for (const player of room.players) Object.assign(player, { score: 0, lastScore: 0, tries: 0 }, newCounters());
  beginRound(room, rng, now);
  return ok();
}

/**
 * Everybody back to the lobby, with the scores cleared, so the same table can play again.
 * @param {object} room  the room to change
 * @param {number} id  who is asking (must be the host)
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: resets the round, the drawings and the history.
 */
export function playAgain(room, id) {
  if (id !== room.hostId) return fail('hostOnlyEnd');
  if (room.phase === 'lobby') return fail('alreadyInLobby');
  for (const player of room.players) Object.assign(player, { score: 0, lastScore: 0, tries: 0 }, newCounters());
  Object.assign(room, { phase: 'lobby', round: 0, order: [], drawers: [], choices: {}, preChoice: {}, words: {}, winner: null, reveal: null, feed: [], used: [], history: [], deadline: null, recorded: false });
  return ok();
}

/**
 * Sets the room up for the next pair of drawers: each is offered words, and both have `chooseMs` to pick one.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the words
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: sets round, drawers, choices, preChoice, words, winner, reveal, deadline and phase ('choosing').
 */
function beginRound(room, rng, now) {
  room.round++;
  room.drawers = [...(room.order[room.round - 1] ?? [])];
  room.choices = {};
  room.preChoice = {};
  room.words = {};
  room.winner = null;
  room.reveal = null;
  // Each drawer is offered their own words, and no word is offered to both of them in the same round.
  const taken = [...room.used];
  for (const drawer of room.drawers) {
    const words = pickWords(room.wordChoices, taken, rng, room.language);
    room.choices[drawer] = words;
    room.preChoice[drawer] = Math.min(words.length - 1, Math.floor(rng() * words.length));
    room.words[drawer] = null;
    taken.push(...words);
  }
  for (const player of room.players) player.tries = 0;
  room.deadline = now + (room.chooseMs ?? CHOOSE_MS);
  room.phase = 'choosing';
}

/**
 * A drawer picks one of the words they were offered.  The drawing starts once both of them have, so that neither gets
 * a head start.
 *
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is choosing (must be one of the two drawers)
 * @param {number} n  which word, as its place in the list they were shown
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets that drawer's word, and starts the drawing when both have chosen.
 */
export function chooseWord(room, id, n, now) {
  if (room.phase !== 'choosing') return fail('notChoosing');
  if (!isDrawer(room, id)) return fail('drawersOnlyChoose');
  if (room.words[id]) return fail('alreadyChosen');
  const offered = room.choices[id] ?? [];
  const place = numberFrom(n);
  if (!Number.isInteger(place) || place < 0 || place >= offered.length) return fail('pickAWord');
  room.words[id] = offered[place];
  room.used.push(offered[place]);
  if (room.drawers.every((drawer) => room.words[drawer])) beginDrawing(room, now);
  return ok();
}

/**
 * Both words are settled: the drawing begins, and the clock is the same for both of them.
 * @param {object} room  the room (mutated)
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: clears the choices, sets the deadline and phase ('drawing').
 */
function beginDrawing(room, now) {
  room.choices = {};
  room.preChoice = {};
  room.deadline = now + room.drawTime * 1000;
  room.phase = 'drawing';
}

/**
 * The clock has run out on whatever the room was waiting for: a word picked for a drawer who dithered, the end of the
 * drawing, or the end of the two words being shown.
 *
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string, finished?: boolean }}
 * Side effects: as chooseWord, endRound or nextRound, whichever the phase calls for.
 */
export function timeUp(room, rng, now) {
  if (room.phase === 'choosing') {
    // Whoever has not chosen gets the word the clock had ready for them; the drawing starts either way.
    for (const drawer of room.drawers) {
      if (room.words[drawer]) continue;
      const offered = room.choices[drawer] ?? [];
      const word = offered[room.preChoice[drawer] ?? 0];
      room.words[drawer] = word ?? null;
      if (word) room.used.push(word);
    }
    beginDrawing(room, now);
    return ok();
  }
  if (room.phase === 'drawing') {
    endRound(room, now);
    return ok();
  }
  if (room.phase === 'between') return nextRound(room, rng, now);
  return fail('nothingToMoveOn');
}

/**
 * A guess at either drawing, or a word to the table.  The two drawers do not type: one of them naming the other's
 * word would be a race nobody else could win, and naming their own would give it away.
 *
 * @param {object} room  the room (mutated)
 * @param {number | string} id  who is guessing
 * @param {string} text  what they typed
 * @param {number} now  the clock, for the rate limit
 * @returns {{ ok: boolean, error?: string, quality?: string }} `quality` is 'exact', 'close' or 'wrong'
 * Side effects: adds a line to the guess panel; a right guess ends the round (see endRound).
 */
export function guess(room, id, text, now) {
  if (!hasPlayer(room, id)) return fail('notInGame');
  if (room.phase !== 'drawing') return fail('notGuessing');
  if (isDrawer(room, id)) return fail('drawersDoNotGuess');
  const player = playerOf(room, id);
  const clean = textFrom(text).replace(/\s+/g, ' ').trim().slice(0, GUESS_LENGTH);
  if (!clean) return fail('typeGuess');
  if (tooFast(player, now)) return fail('tooFast');
  player.tries = (player.tries ?? 0) + 1;
  tallyGuess(player);
  // One guess, two drawings: it is tried against both, and naming either of them wins the round.
  const named = room.drawers.find((drawer) => room.words[drawer] && guessQuality(clean, room.words[drawer]) === 'exact');
  if (named !== undefined) {
    room.winner = { drawer: named, guesser: id, word: room.words[named] };
    addFeed(room, { kind: 'correct', id, name: player.name, text: '' });
    endRound(room, now);
    return ok({ quality: 'exact' });
  }
  const close = room.drawers.some((drawer) => room.words[drawer] && guessQuality(clean, room.words[drawer]) === 'close');
  addFeed(room, { kind: close ? 'close' : 'guess', id, name: player.name, text: clean });
  return ok({ quality: close ? 'close' : 'wrong' });
}

/**
 * Is this player typing faster than the game allows (five in three seconds)?
 * @param {object} player  the player (mutated: their recent times are kept on them)
 * @param {number} now  the clock
 * @returns {boolean} true if this one should be refused
 * Side effects: records `now` and drops the times that have fallen out of the window.
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
 * @param {object} line  { kind, id, name, text }
 * @returns {void}
 * Side effects: pushes onto room.feed and trims it.
 */
function addFeed(room, line) {
  room.feed.push({ n: room.nextFeed++, ...line });
  if (room.feed.length > FEED_LENGTH) room.feed = room.feed.slice(-FEED_LENGTH);
}

/**
 * Ends the round: the drawer whose drawing was named and the guesser who named it each score a point, both words go
 * up for everybody to see, and the room waits before the next pair draw.  When nobody guessed, nobody scores.
 *
 * @param {object} room  the room (mutated)
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: scores, bumps the counters, adds a scoreboard row, sets reveal, the deadline and phase ('between').
 */
function endRound(room, now) {
  const deltas = Object.fromEntries(room.players.map((p) => [p.slot, 0]));
  for (const player of room.players) player.lastScore = 0;
  if (room.winner) {
    for (const id of [room.winner.drawer, room.winner.guesser]) {
      const player = playerOf(room, id);
      if (!player) continue;
      player.score += POINT;
      player.lastScore = POINT;
      deltas[player.slot] = POINT;
    }
  }
  tallyRound({
    drawers: room.drawers.map((id) => playerOf(room, id)).filter(Boolean),
    winner: room.winner ? playerOf(room, room.winner.drawer) : null,
    guesser: room.winner ? playerOf(room, room.winner.guesser) : null,
  });
  // Keyed by slot, not by id: a person who leaves is replaced by a computer player with a different id, and the slot
  // is what survives that, so a finished round is written once and never touched again.  viewFor sends it back out
  // keyed by id (shared/roster.js historyView), so the scoreboard sees what it always did.
  // (`slotOf` in this file is Draw's own word for which of the two boards somebody is drawing on, so the player's slot
  // is taken straight off the player rather than looked up through it.)
  const notes = {};
  for (const drawer of room.drawers) {
    const player = playerOf(room, drawer);
    if (player && room.words[drawer]) notes[player.slot] = msg('notes.drew', { word: room.words[drawer] });
  }
  room.history.push({ label: msg('scoreboard.round', { n: room.round, of: room.order.length }), deltas, notes });
  room.reveal = { words: { ...room.words }, winner: room.winner, drawers: [...room.drawers] };
  room.deadline = now + (room.betweenMs ?? BETWEEN_MS);
  room.phase = 'between';
}

/**
 * Moves on from the two words being shown: the next pair draw, or the game is over.
 * @param {object} room  the room (mutated)
 * @param {() => number} rng  random source for the next words
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string, finished?: boolean }}
 * Side effects: begins the next round, or sets phase 'finished'.
 */
export function nextRound(room, rng, now) {
  if (room.phase !== 'between') return fail('nothingToMoveOn');
  if (room.round >= room.order.length) {
    room.phase = 'finished';
    room.deadline = null;
    room.reveal = null;
    return ok({ finished: true });
  }
  beginRound(room, rng, now);
  return ok({ finished: false });
}

/**
 * Ends a round nobody is there to draw: both drawers have gone, or the one who was going to draw has.  Nobody scores.
 * @param {object} room  the room (mutated)
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as endRound.
 */
export function skipRound(room, now) {
  if (!['choosing', 'drawing'].includes(room.phase)) return fail('nothingToSkip');
  room.winner = null;
  endRound(room, now);
  return ok();
}

// ---------- the statistics ----------

/**
 * Players best first; tied scores share a placement and every tied leader wins.
 * @param {object} room  not changed
 * @returns {object[]}
 * Side effects: none.
 */
export const standings = (room) => standingsOf(room.players);

/**
 * What a finished game reports, in the shape of ctx.stats.record.  Computer players are not accounts: people only.
 * @param {object} room  a finished room (not changed)
 * @returns {object[]}
 * Side effects: none.
 */
export function statsPlayers(room) {
  return statsRows(standings(room), (p) => ({ outcome: p.winner ? 'win' : 'loss', placement: p.placement, score: p.score, extras: statsExtras(p) }));
}

// ---------- what each player is allowed to see ----------

/**
 * The shape of a word for somebody who may not read it: the spaces and hyphens, and a blank for every letter.  There
 * are no letters revealed in Draw! - it is over too quickly - so the shape is all a guesser ever gets.
 * @param {string | null} word  the word, or null before it is chosen
 * @returns {Array<string | null>} one entry per character
 * Side effects: none.
 */
const shapeOf = (word) => (word ? [...word].map((ch) => (ALWAYS_SHOWN.includes(ch) ? ch : null)) : []);

/**
 * The two drawings as one person sees them: who is drawing each, whether they have a word yet, and the word itself
 * only for the person drawing it (and for everybody once the round is over).
 *
 * @param {object} room  not changed
 * @param {number | string} userId  the viewer
 * @param {(id: *) => string} nameOf  a player's name
 * @returns {object[]} one entry per drawer, in the order they are shown
 * Side effects: none.
 */
function boardsFor(room, userId, nameOf) {
  const over = ['between', 'finished'].includes(room.phase);
  return (room.drawers ?? []).map((drawer) => ({
    drawer,
    name: nameOf(drawer),
    yours: drawer === userId,
    chosen: Boolean(room.words[drawer]),
    word: drawer === userId || over ? (room.words[drawer] ?? null) : null,
    shape: shapeOf(room.words[drawer]),
    won: over && room.reveal?.winner?.drawer === drawer,
  }));
}

/**
 * The guess panel as one person sees it: a guess that was close is marked only for the person who wrote it.
 * @param {object} room  not changed
 * @param {number | string} userId  the viewer
 * @returns {object[]}
 * Side effects: none.
 */
const feedFor = (room, userId) =>
  room.feed.map(({ n, kind, id, name, text }) => ({ n, kind: kind === 'close' && id !== userId ? 'guess' : kind, id, name, text }));

/**
 * One player as the table shows them to everybody.
 * @param {object} room  not changed
 * @param {object} p  the player
 * @param {{ online: (id: *) => boolean, final: Map<*, object>, nameOf: (id: *) => string }} context
 * @returns {object}
 * Side effects: none.
 */
function playerView(room, p, { online, final, nameOf }) {
  return {
    id: p.id,
    slot: p.slot, // how the client names this place when it asks for somebody to be removed (shared/layout.js)
    name: nameOf(p.id),
    score: p.score,
    lastScore: p.lastScore ?? 0,
    online: isBot(p) || online(p.id),
    bot: isBot(p),
    drawing: isDrawer(room, p.id) && ROUND.includes(room.phase),
    placement: final.get(p.id)?.placement ?? null,
    winner: final.get(p.id)?.winner ?? false,
  };
}

/**
 * The standard scoreboard (shared/scores.js): the two drawers are who the game is waiting for while they choose, and
 * everybody still guessing is while a drawing is going on.
 * @param {object} room  not changed
 * @param {number | string} userId  the viewer
 * @param {{ online: (id: *) => boolean, nameOf: (id: *) => string }} context
 * @returns {object}
 * Side effects: none.
 */
function scoreboardView(room, userId, { online, nameOf }) {
  const mustAct = (p) => {
    if (room.phase === 'choosing') return isDrawer(room, p.id) && !room.words[p.id];
    if (room.phase === 'drawing') return true;
    return false;
  };
  return {
    players: room.players.map((p) => playerScoreboardEntry(p, { name: nameOf(p.id), me: userId, current: mustAct(p), online })),
    rounds: historyView(room),
    lowIsBetter: false,
  };
}

/**
 * What one person may see.  A guesser never sees either word, nor the words a drawer is choosing between; a drawer
 * sees their own word and may draw, and sees the other drawing without ever being told what it is.
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
  const drawing = isDrawer(room, userId) && ROUND.includes(room.phase);
  return {
    code: room.code,
    phase: room.phase,
    you: userId,
    hostId: room.hostId,
    round: room.round,
    rounds: room.order.length,
    youDraw: drawing,
    boards: boardsFor(room, userId, nameOf),
    choices: room.phase === 'choosing' && drawing && !room.words[userId] ? (room.choices[userId] ?? []) : [],
    reveal: room.phase === 'between' ? room.reveal : null,
    feed: feedFor(room, userId),
    remaining: room.deadline === null ? null : Math.max(0, room.deadline - now),
    drawTime: room.drawTime,
    players: room.players.map((p) => playerView(room, p, { online, final, nameOf })),
    scoreboard: scoreboardView(room, userId, { online, nameOf }),
    size: roster.sizeOf(room), // the most who may join, which the host may lower in the lobby
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS, cycles: CYCLES, drawTime: DRAW_TIME, wordChoices: WORD_CHOICES, guessLength: GUESS_LENGTH },
    settings: { cycles: room.cycles, drawTime: room.drawTime, wordChoices: room.wordChoices },
    roundsToPlay: room.phase === 'lobby' ? roundsInGame(room) : room.order.length,
  };
}

/**
 * May this person put strokes on a board right now, and on which one?  The socket layer asks before it relays
 * anything: each drawer owns one board, and nobody else may touch either.
 * @param {object} room  not changed
 * @param {number | string} id  the player
 * @returns {boolean}
 * Side effects: none.
 */
export const canDraw = (room, id) => room.phase === 'drawing' && isDrawer(room, id);

/**
 * Which of the two boards this player draws on: 0, 1, or -1 for everybody else.  The boards are known by their place
 * rather than by who is drawing them, so that a computer player taking somebody's place mid-round inherits the
 * strokes already on it instead of starting a blank one beside the old.
 * @param {object} room  not changed
 * @param {number | string} id  the player
 * @returns {number} 0, 1 or -1
 * Side effects: none.
 */
export const slotOf = (room, id) => (room.drawers ?? []).indexOf(id);

// ---------- computer players ----------

/**
 * What one computer player is allowed to know, as plain data: the words it has been offered (when it is drawing), the
 * shapes of the two words, the word list, and what the table has guessed.  Neither word is ever in it unless this
 * player is the one drawing it.
 *
 * @param {object} room  not changed
 * @param {number | string} id  the computer player
 * @param {() => number} rng  random source, which the AI uses instead of any of its own
 * @returns {object} the AI context
 * Side effects: none.
 */
export function aiContext(room, id, rng) {
  const seat = viewFor(room, id);
  const mine = room.feed.filter((line) => line.id === id).map((line) => line.text);
  const everybody = room.feed.filter((line) => ['guess', 'close'].includes(line.kind)).map((line) => line.text);
  // Two drawings to guess at, so the AI is given both shapes; one of them may be all it can work from.
  const shapes = seat.boards.map((board) => board.shape);
  return { choices: seat.choices, shapes, hints: shapes[0] ?? [], words: wordList(room.language), tried: mine, seen: everybody, rng };
}

/**
 * The next thing a computer player has to do, or null: pick a word to draw, or have another guess.  Several of them
 * take it in turns to guess, the one with the fewest guesses this round going next.
 * @param {object} room  not changed
 * @returns {{ type: 'word' | 'guess', id: number | string } | null}
 * Side effects: none.
 */
export function pendingBotAction(room) {
  if (room.phase === 'choosing') {
    const waiting = room.drawers.map((id) => playerOf(room, id)).find((p) => p && isBot(p) && !room.words[p.id] && (room.choices[p.id] ?? []).length);
    return waiting ? { type: 'word', id: waiting.id } : null;
  }
  if (room.phase !== 'drawing') return null;
  const waiting = guessers(room).filter(isBot);
  if (!waiting.length) return null;
  const next = waiting.reduce((fewest, p) => ((p.tries ?? 0) < (fewest.tries ?? 0) ? p : fewest), waiting[0]);
  return { type: 'guess', id: next.id };
}

/**
 * Plays one pending computer move.  The decision is made from that player's own context (see aiContext), so a
 * computer player never guesses a word it has been told.  An AI that throws, or answers with something the rules
 * refuse, is replaced by a legal choice.
 *
 * @param {object} room  the room (mutated by the move played)
 * @param {() => number} rng  random source handed to the AI
 * @param {number} now  the clock
 * @param {object | null} [action]  the move to play (default: pendingBotAction)
 * @param {object} [ai]  the computer player to decide with (default: the one this game has, ./ai.js)
 * @returns {boolean} true if a move was played
 * Side effects: plays the move (chooseWord or guess) and so changes the room as they do.
 */
export function runBotAction(room, rng, now, action = pendingBotAction(room), ai = AI) {
  if (!action) return false;
  const player = playerOf(room, action.id);
  if (!player) return false;
  const context = aiContext(room, action.id, rng);
  const attempt = (decide) => {
    try {
      return decide();
    } catch {
      return undefined; // a broken AI must not stop the game
    }
  };
  if (action.type === 'word') {
    const offered = room.choices[action.id] ?? [];
    const chosen = attempt(() => ai.chooseWord(context));
    const n = Number.isInteger(chosen) && chosen >= 0 && chosen < offered.length ? chosen : Math.floor(rng() * offered.length);
    return chooseWord(room, action.id, n, now).ok;
  }
  const guessed = attempt(() => ai.guess(context));
  const text = typeof guessed === 'string' && guessed.trim() ? guessed.trim() : (context.words[Math.floor(rng() * context.words.length)] ?? 'something');
  const outcome = guess(room, action.id, text, now);
  // Being refused for guessing too fast is not a failure: the server simply asks again in a moment.
  return outcome.ok || outcome.error === 'tooFast';
}
