// The rules of Wavelength, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// A turn: the psychic sees a hidden target on a dial (0 is the left end, 100 the right) and gives a clue; everyone else
// turns the dial to where they think it is. Once every guesser has locked in a guess the target is revealed and scored.
//
// Depends on: shared/ (scores, tally, ai, markerColours, seats, roster) for the common room rules, ./ai (computer players),
// ./scoring.js (the bands), ./spectra.js (the spectra and their example clues) and ./tally.js (the statistics counters).
// Sockets, timers and saving are not here: server.js drives these rules through shared/roomServer.js.
import { finalStandings, playerScoreboardEntry, standingsOf } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { MARKER_COLOURS, markerProblem, normaliseMarker, startingMarker } from '../../shared/markerColours.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { createRosterRules, hasPlayer, humans, isBot, isHuman, migratePlayers, renameInHistory, seatOf } from '../../shared/roster.js';
import { AIS } from './ai/index.js';
import { BANDS, teamWinScore } from './scoring.js';
import { SPECTRA, spectrumById } from './spectra.js';
import { DIAL_MAX, DIAL_MIN, newCounters, statsExtras, tallyTurn } from './tally.js';

/** The fewest people that can play: one psychic and one guesser. */
export const MIN_PLAYERS = 2;
/** The most people in a room (the marker palette and the table only have room for so many). */
export const MAX_PLAYERS = 8;
/** How many turns each person gets as psychic: the game lasts turnsEach x players turns. */
export const TURNS_EACH = { min: 1, max: 5, default: 2 };
/** The longest clue, in characters; longer ones are cut (so a clue cannot swamp the table). */
export const CLUE_LENGTH = 80;
/** `solo`: everyone guesses alone. `team`: the guessers share one marker, move it together and lock it in. */
export const MODES = ['solo', 'team'];
export const COLOURS = MARKER_COLOURS; // the free palette; any other colour is a shop unlock (shared/markerColours.js)
// The scoring numbers (the bands, the most a turn can score, what a team must average to win) live in scoring.js so that the
// client can import them too. They are re-exported here so everything about the rules can still be had from game.js.
export { BANDS, MAX_TURN_POINTS, TEAM_WIN_TURN_POINTS, maxScore, teamWinScore } from './scoring.js';
/** The hidden target is always somewhere its whole outer band fits on the dial. */
export const TARGET_RANGE = { min: 13, max: 87 };

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana'];
/** The phases of a game that is still going (or not yet started). */
const LIVE = ['lobby', 'clue', 'guessing', 'reveal'];
/** The phases in which a turn is under way and the psychic matters (the reveal is after the turn). */
const PLAYING = ['clue', 'guessing'];

// The player-list vocabulary (who is in the room, and who is a person) is shared with Just One and Tints and Hints.
export { hasPlayer, humans, isHuman, seatOf };

/**
 * Is the game still going (or still in the lobby)?
 *
 * @param {object} room  the room to look at
 * @returns {boolean} false once it has finished or been abandoned
 *
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);
/**
 * The player with this id, or undefined.
 *
 * @param {object} room  the room to search
 * @param {number|string} id  the player id (an account id, or 'bot:<n>')
 * @returns {object|undefined} the player
 *
 * Side effects: none.
 */
const playerOf = (room, id) => room.players.find((p) => p.id === id);
/**
 * A function giving a player's name: the name saved with them, else `nameOf` (only rooms saved long ago lack names).
 *
 * @param {object} room  the room whose players are searched
 * @param {(id: number) => string} nameOf  fallback lookup, such as the account's display name
 * @returns {(id: number|string) => string} the lookup
 *
 * Side effects: none.
 */
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);
/**
 * Everybody but the psychic.
 *
 * @param {object} room  the room to look at
 * @returns {object[]} the players who guess this turn
 *
 * Side effects: none.
 */
const guessers = (room) => room.players.filter((p) => p.id !== room.psychic);

/**
 * Gives a bare player ({ kind, id, name }) the fields Wavelength keeps for everybody: the score, the statistics counters and
 * a marker colour. A computer player gets the first colour nobody has; a person gets the colour they prefer (`extras.colour`,
 * already checked to be one they may use) if it is free, otherwise the first free one.
 *
 * @param {object} room     the room the player is about to join (read for the colours already taken; not changed)
 * @param {object} base     { kind: 'human' | 'bot', id, name? }
 * @param {{ colour?: string | null }} [extras]  what the server knows about a person joining
 * @returns {object} the player
 *
 * Side effects: none (the room is only read).
 */
const makePlayer = (room, base, extras = {}) => ({
  ...base,
  colour: isBot(base) ? freeColour(room) : startingMarker(extras.colour ?? null, room.players.map((p) => p.colour), true),
  score: 0,
  ...newCounters(),
});
/**
 * The first palette colour no player has yet.
 *
 * @param {object} room  the room whose players are looked at
 * @returns {string|undefined} a free colour (undefined only if more players than colours, which MAX_PLAYERS prevents)
 *
 * Side effects: none.
 */
const freeColour = (room) => COLOURS.find((c) => !room.players.some((p) => p.colour === c));
/**
 * Whether every guesser has a guess in (the turn can then be scored).
 *
 * @param {object} room  the room to look at
 * @returns {boolean} true if nobody is still to guess
 *
 * Side effects: none.
 */
const allGuessed = (room) => guessers(room).every((p) => room.guesses.some((g) => g.id === p.id));
/**
 * Rounds to one decimal place, so stored positions stay tidy and compare reliably.
 *
 * @param {number} n  any number
 * @returns {number} n to the nearest tenth
 *
 * Side effects: none.
 */
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * The points a guess earns when the target is where it is: the points of the narrowest band the guess falls within, or 0.
 * BANDS runs from the middle outwards, so the first match is the best one.
 *
 * @param {number} position  the guessed position, 0 to 100
 * @param {number} target  the hidden position, 0 to 100
 * @returns {number} 0 to MAX_TURN_POINTS
 *
 * Side effects: none.
 */
export function pointsFor(position, target) {
  const distance = Math.abs(position - target);
  return BANDS.find((band) => distance <= band.within)?.points ?? 0;
}

/**
 * Makes a new room with the host in it.
 *
 * @param {object} args
 * @param {string} args.code         the invite code
 * @param {number} args.hostId       the host's account id
 * @param {string} [args.hostName]   the host's display name
 * @param {object} [args.settings]   settings the host chose when creating it ({ turnsEach, mode }); invalid ones are ignored
 * @param {number} [args.turnsEach]  turns each (default 2); `settings.turnsEach` wins if both are given
 * @param {string | null} [args.colour]  the host's default marker colour, already checked to be one they may use (ctx.markers.preferred)
 * @param {number} args.now        the time to stamp it with
 * @returns {object} the room, in the lobby
 *
 * Side effects: none outside the new room (it is built and returned, not stored).
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
    mode: 'solo',
    nextIdx: 0,
    ready: [], // at the reveal: the people who have closed the scores pop-up
    nextBot: 1, // computer players are players with kind 'bot', an id 'bot:<n>', a name and (once started) an ai id
    psychic: null,
    spectrum: null, // { id, left, right } of this turn (copied, so that a saved room never depends on the list)
    used: [], // the spectra already played this game
    target: null,
    clue: '',
    marker: null, // team mode: where the team's shared marker is
    guesses: [],
    result: null,
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
 * The lobby, joining, leaving and computer-player rules, from shared/roster.js. Somebody who leaves mid-game is replaced by
 * a computer player in their place, so no turn is lost (see takeOver).
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
 * The host changes the settings. Only the settings that are given are changed.
 *
 * @param {object} room
 * @param {number} id        who is asking (must be the host)
 * @param {object} settings  { turnsEach?, mode? }
 * @returns {{ ok: boolean, error?: string }}
 *
 * Side effects: sets room.turnsEach and/or room.mode when given; if the first is accepted and the second refused, the first stays changed.
 */
export function setSettings(room, id, settings = {}) {
  if (settings.turnsEach === undefined && settings.mode === undefined) return hostInLobby(room, id) ?? ok();
  if (settings.turnsEach !== undefined) {
    const outcome = setTurnsEach(room, id, settings.turnsEach);
    if (!outcome.ok) return outcome;
  }
  return settings.mode === undefined ? ok() : setMode(room, id, settings.mode);
}

/**
 * Wavelength has no "play again": a new game is made from the menu. (The shared room server offers the event to every game.)
 *
 * @returns {{ ok: false, error: string }} always a refusal
 *
 * Side effects: none.
 */
export function playAgain() {
  return fail('Start a new game from the menu.');
}

/**
 * A player picks their marker colour in the lobby.
 *
 * Side effects: changes the player's colour (only if it is allowed and not taken by somebody else).
 *
 * @param {object} room  the room (must be in the lobby)
 * @param {number} id  the player choosing
 * @param {string} colour  the wanted colour
 * @param {boolean} [canCustom]  this player has unlocked any marker colour (otherwise only the free palette is allowed)
 * @returns {{ ok: boolean, error?: string }} ok, or why not
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

/**
 * The host sets how many turns each person gets as psychic.
 *
 * @param {object} room  the room (must be in the lobby)
 * @param {number} id  who is asking (must be the host)
 * @param {number} turnsEach  an integer from TURNS_EACH.min to TURNS_EACH.max
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 *
 * Side effects: sets room.turnsEach.
 */
export function setTurnsEach(room, id, turnsEach) {
  if (id !== room.hostId) return fail('Only the host can change the settings.');
  if (room.phase !== 'lobby') return fail('The game has already started.');
  if (!Number.isInteger(turnsEach) || turnsEach < TURNS_EACH.min || turnsEach > TURNS_EACH.max) {
    return fail(`Choose between ${TURNS_EACH.min} and ${TURNS_EACH.max} turns each.`);
  }
  room.turnsEach = turnsEach;
  return ok();
}

/**
 * The host picks who guesses how: everyone alone (`solo`), or all together with one marker (`team`).
 *
 * @param {object} room  the room (must be in the lobby)
 * @param {number} id  who is asking (must be the host)
 * @param {string} mode  one of MODES
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 *
 * Side effects: sets room.mode.
 */
export function setMode(room, id, mode) {
  if (id !== room.hostId) return fail('Only the host can change the settings.');
  if (room.phase !== 'lobby') return fail('The game has already started.');
  if (!MODES.includes(mode)) return fail('That is not a way to play.');
  room.mode = mode;
  return ok();
}

/**
 * Sets up the next turn: the next person in the list becomes psychic, and a spectrum nobody has played this game (until all
 * have been used, then the list starts again) and a target are drawn. The target stays inside TARGET_RANGE so that the
 * whole outer band always fits on the dial.
 *
 * @param {object} room  the room to set up
 * @param {() => number} rng  random source for the spectrum and the target
 * @returns {void}
 *
 * Side effects: changes the psychic, nextIdx, used, spectrum, target and phase, and clears the clue, marker, guesses, result and ready list.
 */
function startTurn(room, rng) {
  room.psychic = room.players[room.nextIdx].id;
  room.nextIdx = (room.nextIdx + 1) % room.players.length;
  room.used ??= [];
  let fresh = SPECTRA.filter((s) => !room.used.includes(s.id));
  if (!fresh.length) {
    room.used = [];
    fresh = SPECTRA;
  }
  const chosen = fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))];
  room.used.push(chosen.id);
  room.spectrum = { id: chosen.id, left: chosen.left, right: chosen.right };
  room.target = TARGET_RANGE.min + Math.floor(rng() * (TARGET_RANGE.max - TARGET_RANGE.min + 1));
  room.clue = '';
  room.marker = null;
  room.lockedBy = null;
  room.guesses = [];
  room.result = null;
  room.ready = [];
  room.phase = 'clue';
}

/**
 * The host starts the game: works out how many turns there will be, picks the first psychic, the first spectrum and target,
 * and gives every computer player an AI for the whole game.
 *
 * Side effects: changes the phase and everything a turn sets up (see startTurn); uses `rng` for the order, the target and the AIs.
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
  room.used = [];
  room.nextIdx = Math.floor(rng() * room.players.length);
  startTurn(room, rng);
  // Every computer player gets an AI for the whole game (after the deal, so seeded games deal as they always did).
  const bots = room.players.filter(isBot);
  const picks = assignAIs(AIS, bots.map((p) => p.id), rng);
  for (const p of bots) p.ai = picks[p.id];
  return ok();
}

/**
 * The psychic gives the clue, which opens the guessing. Whitespace is tidied and the clue cut to CLUE_LENGTH.
 *
 * @param {object} room  the room (must be in the clue phase)
 * @param {number} id  who is asking (must be the psychic)
 * @param {*} text  the clue as typed
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 *
 * Side effects: sets room.clue and moves the phase to 'guessing'.
 */
export function setClue(room, id, text) {
  if (room.phase !== 'clue') return fail('The clue has already been given.');
  if (id !== room.psychic) return fail('Only the psychic gives the clue.');
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CLUE_LENGTH);
  if (!clean) return fail('Type a clue first.');
  room.clue = clean;
  room.phase = 'guessing';
  return ok();
}

/**
 * A guesser (solo mode) locks in a position on the dial. When the last guesser has done so the turn is scored.
 *
 * @param {object} room  the room (must be in the guessing phase, in solo mode)
 * @param {number} id  who is guessing (not the psychic)
 * @param {number} position  a finite number from DIAL_MIN to DIAL_MAX (stored to one decimal place)
 * @param {(id: number) => string} [nameOf]  fallback names for the history label
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 *
 * Side effects: adds to room.guesses; may score the turn (scores, history, result, phase become 'reveal').
 */
export function guess(room, id, position, nameOf = String) {
  if (room.phase === 'clue') return fail('Wait for the clue.');
  if (room.phase !== 'guessing') return fail('It is not time to guess.');
  if (room.mode === 'team') return fail('Your team has one marker: move it together, then lock it in.');
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (id === room.psychic) return fail('You are the psychic, so you cannot guess.');
  if (typeof position !== 'number' || !Number.isFinite(position) || position < DIAL_MIN || position > DIAL_MAX) return fail('Turn the dial to a place between the two ends.');
  if (room.guesses.some((g) => g.id === id)) return fail('You have already guessed. Wait for the others.');
  room.guesses.push({ id, position: round1(position) });
  if (allGuessed(room)) scoreTurn(room, namer(room, nameOf));
  return ok();
}

/**
 * Checks that this person may use the team marker now.
 *
 * @param {object} room  the room
 * @param {number} id  who is asking
 * @returns {{ ok: false, error: string }|null} the refusal, or null if they may (despite the name, it never returns the player)
 *
 * Side effects: none.
 */
function teamGuesser(room, id) {
  if (room.mode !== 'team') return fail('This game is not played in a team.');
  if (room.phase === 'clue') return fail('Wait for the clue.');
  if (room.phase !== 'guessing') return fail('It is not time to guess.');
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (id === room.psychic) return fail('You are the psychic: your team moves the marker.');
  return null;
}

/**
 * Team mode: any guesser moves the team's shared marker (everyone but the psychic sees it move).
 *
 * @param {object} room  the room (team mode, guessing phase)
 * @param {number} id  who is moving it (not the psychic)
 * @param {number} position  a finite number from DIAL_MIN to DIAL_MAX
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 *
 * Side effects: sets room.marker (to one decimal place).
 */
export function setMarker(room, id, position) {
  const refused = teamGuesser(room, id);
  if (refused) return refused;
  if (typeof position !== 'number' || !Number.isFinite(position) || position < DIAL_MIN || position > DIAL_MAX) return fail('Move the marker to a place between the two ends.');
  room.marker = round1(position);
  return ok();
}

/**
 * Team mode: any guesser locks the marker in where it is, which scores it for everyone. Every guesser gets the same position.
 *
 * @param {object} room  the room (team mode, guessing phase, marker already placed)
 * @param {number} id  who is locking it in (not the psychic)
 * @param {(id: number) => string} [nameOf]  fallback names for the history label
 * @returns {{ ok: boolean, error?: string }} ok, or why not
 *
 * Side effects: sets room.guesses and room.lockedBy and scores the turn (scores, history, result, phase become 'reveal').
 */
export function lockIn(room, id, nameOf = String) {
  const refused = teamGuesser(room, id);
  if (refused) return refused;
  if (room.marker === null) return fail('Move the marker first.');
  room.guesses = guessers(room).map((p) => ({ id: p.id, position: room.marker }));
  room.lockedBy = id;
  scoreTurn(room, namer(room, nameOf));
  return ok();
}

/**
 * Scores the turn and opens the reveal. Each guesser scores for where they guessed; the psychic scores the average of the
 * guessers' points (rounded), which rewards a clue that lets most people land near the target.
 *
 * @param {object} room  the room, with every guess in
 * @param {(id: number|string) => string} [nameOf]  names for the history label
 * @returns {void}
 *
 * Side effects: adds points to the players, updates the statistics counters (tallyTurn), sets room.result, appends to
 * room.history, clears room.ready and moves the phase to 'reveal'.
 */
function scoreTurn(room, nameOf = String) {
  const entries = [];
  for (const { id, position } of room.guesses) {
    const player = playerOf(room, id);
    if (!player) continue;
    const points = pointsFor(position, room.target);
    player.score += points;
    entries.push({ id, position, distance: Math.abs(position - room.target), points, bullseye: points === BANDS[0].points });
  }
  const psychic = playerOf(room, room.psychic);
  tallyTurn(entries, (id) => playerOf(room, id), psychic);
  const psychicPoints = entries.length ? Math.round(entries.reduce((sum, e) => sum + e.points, 0) / entries.length) : 0;
  if (psychic) {
    psychic.score += psychicPoints;
  }
  room.result = { target: room.target, psychic: room.psychic, psychicPoints, entries, ...(room.mode === 'team' ? { team: true, lockedBy: room.lockedBy ?? null } : {}) };
  recordHistory(room, nameOf);
  room.ready = [];
  room.phase = 'reveal';
}

/**
 * Appends the finished turn to room.history (the standard round shape of shared/scores.js). This only happens when
 * the turn is scored, i.e. at the reveal, so the history never shows anything the players have yet to see.
 * A turn that is skipped because its psychic left is never scored and so appends nothing.
 *
 * @param {object} room  the room, with room.result set
 * @param {(id: number|string) => string} nameOf  gives the psychic's name for the label
 * @returns {void}
 *
 * Side effects: pushes one round onto room.history.
 */
function recordHistory(room, nameOf) {
  const deltas = {};
  const notes = {};
  for (const e of room.result.entries) {
    deltas[e.id] = e.points;
    notes[e.id] = e.bullseye ? 'bullseye' : e.points ? 'in the target' : 'missed';
  }
  if (playerOf(room, room.psychic)) {
    deltas[room.psychic] = room.result.psychicPoints;
    notes[room.psychic] = 'psychic';
  }
  room.history.push({ label: `Turn ${room.turn + 1}: ${nameOf(room.psychic)}`, deltas, notes });
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
 */
export function migrate(room, nameOf) {
  migratePlayers(room, nameOf);
  room.used ??= [];
  room.mode ??= 'solo';
  room.marker ??= null;
  if (!Array.isArray(room.history)) room.history = [];
  return room;
}

/**
 * Ends the turn after the reveal: counts it, then finishes the game after the last turn or starts the next turn.
 *
 * @param {object} room  the room, at the reveal
 * @param {() => number} rng  random source for the next turn's spectrum and target
 * @returns {boolean} true if the game is now finished
 *
 * Side effects: increments room.turn, clears room.ready and either sets the phase to 'finished' or sets up the next turn (see startTurn).
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
 *
 * @param {object} room  the room to look at
 * @returns {object[]} the human players not in room.ready
 *
 * Side effects: none.
 */
const unready = (room) => humans(room).filter((p) => !room.ready.includes(p.id));

/**
 * At the reveal, a person has closed the scores pop-up and is ready for the next turn. Once every person is ready
 * (computer players always are) the next turn starts, or the game finishes after the last one.
 *
 * @param {object} room  the room (must be at the reveal)
 * @param {number} id  the person who closed the pop-up
 * @param {() => number} rng  random source for the next turn
 * @returns {{ ok: boolean, error?: string, finished?: boolean }} ok with whether the game finished, or why not
 *
 * Side effects: adds the person to room.ready; may end the turn (see finishTurn).
 */
export function ready(room, id, rng) {
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (room.phase !== 'reveal') return fail('There are no scores to close.');
  if (!room.ready.includes(id)) room.ready.push(id);
  return ok({ finished: unready(room).length === 0 ? finishTurn(room, rng) : false });
}

/**
 * Moves on from the reveal whether or not everyone has closed the pop-up (the server does this after a wait).
 *
 * @param {object} room  the room (must be at the reveal)
 * @param {() => number} rng  random source for the next turn
 * @returns {{ ok: boolean, error?: string, finished?: boolean }} ok with whether the game finished, or why not
 *
 * Side effects: ends the turn (see finishTurn).
 */
export function forceNext(room, rng) {
  if (room.phase !== 'reveal') return fail('There is nothing to move on from.');
  return ok({ finished: finishTurn(room, rng) });
}

/**
 * True while the reveal waits for people to close the scores (the server times this out).
 *
 * @param {object} room  the room to look at
 * @returns {boolean} whether the room is at the reveal
 *
 * Side effects: none.
 */
export const waitingForReady = (room) => room.phase === 'reveal';

/**
 * Wavelength's part of a computer player taking the place of a person who left a game under way (the roster has already
 * put it in the list, with the person's score, counters and colour): it gets an AI, everything that named the person now
 * names it (their turn as psychic, their guess, the team lock, the ready list, the history), and if the reveal was only
 * waiting for that person the next turn starts. Anything it now has to do (a clue, a guess) is picked up by pendingBotAction.
 *
 * Side effects: mutates the room (the bot, psychic, guesses, lockedBy, ready, result, history) and may start the next turn.
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
  room.psychic = renamed(room.psychic);
  room.lockedBy = renamed(room.lockedBy ?? null);
  for (const g of room.guesses) g.id = renamed(g.id);
  room.ready = (room.ready ?? []).filter((x) => x !== oldId); // a computer player is always ready, so it needs no entry
  if (room.result) {
    room.result.psychic = renamed(room.result.psychic);
    if ('lockedBy' in room.result) room.result.lockedBy = renamed(room.result.lockedBy);
    for (const e of room.result.entries) e.id = renamed(e.id);
  }
  renameInHistory(room, oldId, bot.id);
  if (room.phase === 'reveal' && unready(room).length === 0) finishTurn(room, rng);
}

/**
 * Players best first; tied scores share a placement and every tied leader wins.
 *
 * @param {object} room  not changed
 * @returns {object[]} copies of the players with `placement` and `winner`
 *
 * Side effects: none.
 */
export function standings(room) {
  return standingsOf(room.players);
}

/**
 * The statistics for a finished game, in the shape of ctx.stats.record. Computer players are not accounts: people only. A team
 * shares one score: it wins when it averaged at least the outer band a turn (see scoring.js), and loses otherwise.
 *
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}  one row per person
 *
 * Side effects: none.
 */
export function statsPlayers(room) {
  const teamWon = (p) => p.score >= teamWinScore(room.turnsTotal);
  return statsRows(standings(room), (p) => ({
    outcome: (room.mode === 'team' ? teamWon(p) : p.winner) ? 'win' : 'loss',
    placement: p.placement,
    score: p.score,
    extras: statsExtras(p),
  }));
}

/**
 * The result of the turn just scored, with the names filled in (only once it is revealed).
 *
 * @param {object} room  not changed
 * @param {(id: number) => string} nameOf  a player's name
 * @returns {object | null} the result with names, or null before the reveal
 *
 * Side effects: none.
 */
function resultView(room, nameOf) {
  const revealed = ['reveal', 'finished'].includes(room.phase);
  if (!(revealed && room.result)) return null;
  return { ...room.result, psychicName: nameOf(room.result.psychic), entries: room.result.entries.map((e) => ({ ...e, name: nameOf(e.id) })) };
}

/**
 * One player as the table shows them to everybody.
 *
 * @param {object} room  not changed
 * @param {object} p  the player
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean, final: Map<number, object> }} context
 * @returns {object} the public fields of the player (the AI is shown by its description, never its internals)
 *
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
    guessed: room.guesses.some((g) => g.id === p.id),
    ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : false,
    placement: final.get(p.id)?.placement ?? null,
    winner: final.get(p.id)?.winner ?? false,
  };
}

/**
 * The standard scoreboard (shared/scores.js): whoever the game is waiting for is `current` (the site's "Take your time"
 * clock reads it), and while the results are up each player shows whether they are ready to go on.
 *
 * @param {object} room  not changed
 * @param {number} userId  the viewer
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean }} context
 * @returns {object} the scoreboard in the shared shape
 *
 * Side effects: none.
 */
function scoreboardView(room, userId, { nameOf, online }) {
  // `current` marks who the game is waiting for: the psychic for the clue, then the guessers (all of a team, which decides
  // together; alone, those who have not guessed yet).
  const mustAct = (p) => {
    if (room.phase === 'clue') return p.id === room.psychic;
    if (room.phase !== 'guessing' || p.id === room.psychic) return false;
    return room.mode === 'team' || !room.guesses.some((g) => g.id === p.id);
  };
  const player = (p) => playerScoreboardEntry(p, { name: nameOf(p.id), me: userId, current: mustAct(p), online, ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : undefined });
  return {
    players: room.players.map(player),
    rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })),
    lowIsBetter: false,
  };
}

/**
 * What one person may see. Only the psychic knows the target until the reveal, and nobody sees anyone else's guess
 * until then either.
 *
 * @param {object} room  not changed
 * @param {number} userId  the account looking
 * @param {object} [options]
 * @param {(id: number) => string} [options.nameOf]  names for players who have left
 * @param {(id: number) => boolean} [options.online]  who is connected
 * @param {boolean} [options.canCustom]  whether this player may pick any colour (a shop unlock)
 * @returns {object} the view sent to that person
 *
 * Side effects: none.
 */
export function viewFor(room, userId, { nameOf = String, online = () => true, canCustom = false } = {}) {
  nameOf = namer(room, nameOf);
  const isPsychic = room.psychic === userId;
  const revealed = ['reveal', 'finished'].includes(room.phase);
  const final = finalStandings(room.players, ['finished', 'abandoned'].includes(room.phase));
  return {
    code: room.code,
    phase: room.phase,
    you: userId,
    hostId: room.hostId,
    turnsEach: room.turnsEach,
    mode: room.mode ?? 'solo',
    turn: Math.min(room.turn + 1, room.turnsTotal),
    turnsTotal: room.turnsTotal,
    psychic: room.psychic,
    spectrum: room.spectrum && room.phase !== 'lobby' ? { left: room.spectrum.left, right: room.spectrum.right } : null,
    target: isPsychic || revealed ? room.target : null,
    clue: room.phase === 'lobby' ? '' : room.clue,
    marker: revealed || (room.mode === 'team' && room.phase === 'guessing' && !isPsychic) ? room.marker ?? null : null,
    guesses: room.guesses.filter((g) => revealed || g.id === userId).map((g) => ({ id: g.id, position: g.position })),
    bands: BANDS,
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
 * The next thing a computer player has to do, or null: { type: 'clue' | 'guess', id }. Computer players never move on
 * from the reveal: that is up to the people (or the server's timeout), so a computer player cannot hold the game up or
 * rush people past their results.
 *
 * @param {object} room  the room to look at
 * @returns {{ type: 'clue' | 'guess' | 'marker' | 'lock', id: string }|null} the move and who makes it, or null if none is due
 *
 * Side effects: none.
 */
export function pendingBotAction(room) {
  if (room.phase === 'clue') {
    const psychic = playerOf(room, room.psychic);
    return isBot(psychic) ? { type: 'clue', id: psychic.id } : null;
  }
  if (room.phase !== 'guessing') return null;
  if (room.mode === 'team') {
    // A team of computer players only plays by itself when no person is in it: people agree on the marker themselves.
    if (guessers(room).some((p) => !isBot(p))) return null;
    const bot = guessers(room)[0];
    return { type: room.marker === null ? 'marker' : 'lock', id: bot.id };
  }
  const guesser = guessers(room).find((p) => isBot(p) && !room.guesses.some((g) => g.id === p.id));
  return guesser ? { type: 'guess', id: guesser.id } : null;
}

/**
 * Plays one pending computer move. The decision is made from that seat's own view (viewFor), so a computer guesser
 * never sees the target. An AI that throws or answers with something illegal is replaced by a random legal choice.
 *
 * @param {object} room  the room
 * @param {() => number} rng  random source handed to the AI
 * @param {{type: string, id: string}|null} [action]  the move to play (default: whatever pendingBotAction says)
 * @param {(id: number) => string} [nameOf]  fallback names
 * @returns {boolean} true if the game accepted the move
 *
 * Side effects: makes the move (a clue, marker, lock or guess), which mutates the room and may score the turn.
 */
export function runBotAction(room, rng, action = pendingBotAction(room), nameOf = String) {
  if (!action) return false;
  const player = playerOf(room, action.id);
  const ai = aiById(AIS, player.ai);
  const view = viewFor(room, action.id, { nameOf });
  const anchors = spectrumById(room.spectrum?.id)?.anchors ?? [];
  /** Runs an AI decision, returning undefined if it throws (a broken AI must not stop the game). */
  const attempt = (decide) => {
    try {
      return decide();
    } catch {
      return undefined; // a broken AI must not stop the game
    }
  };
  if (action.type === 'clue') {
    const text = attempt(() => ai.clue({ target: view.target, anchors }, rng));
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    return setClue(room, action.id, clean || 'something').ok;
  }
  if (action.type === 'lock') return lockIn(room, action.id, nameOf).ok;
  const position = attempt(() => ai.guess({ clue: view.clue, anchors }, rng));
  const clamped = typeof position === 'number' && Number.isFinite(position) ? Math.min(DIAL_MAX, Math.max(DIAL_MIN, position)) : 15 + rng() * 70;
  return (action.type === 'marker' ? setMarker(room, action.id, clamped) : guess(room, action.id, clamped, nameOf)).ok;
}
