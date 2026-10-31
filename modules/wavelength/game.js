// The rules of Wavelength, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// A turn: the psychic sees a hidden target on a dial (0 is the left end, 100 the right) and gives a clue; everyone else
// turns the dial to where they think it is. Once every guesser has locked in a guess the target is revealed and scored.
import { finalStandings, playerScoreboardEntry, standingsOf } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { aiById, assignAIs, describeAI } from '../../shared/ai.js';
import { MARKER_COLOURS, markerProblem, normaliseMarker, startingMarker } from '../../shared/markerColours.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { createRosterRules, hasPlayer, humans, isBot, isHuman, migratePlayers, seatOf } from '../../shared/roster.js';
import { AIS } from './ai/index.js';
import { BANDS, teamWinScore } from './scoring.js';
import { SPECTRA, spectrumById } from './spectra.js';
import { DIAL_MAX, DIAL_MIN, newCounters, statsExtras, tallyTurn } from './tally.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const TURNS_EACH = { min: 1, max: 5, default: 2 };
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
const LIVE = ['lobby', 'clue', 'guessing', 'reveal'];
const PLAYING = ['clue', 'guessing'];

// The player-list vocabulary (who is in the room, and who is a person) is shared with Just One and Tints and Hints.
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
/** Everybody but the psychic. */
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
 */
const makePlayer = (room, base, extras = {}) => ({
  ...base,
  colour: isBot(base) ? freeColour(room) : startingMarker(extras.colour ?? null, room.players.map((p) => p.colour), true),
  score: 0,
  ...newCounters(),
});
const freeColour = (room) => COLOURS.find((c) => !room.players.some((p) => p.colour === c));
const allGuessed = (room) => guessers(room).every((p) => room.guesses.some((g) => g.id === p.id));
const round1 = (n) => Math.round(n * 10) / 10;

/** The points a guess earns when the target is where it is. */
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
 * The lobby, joining, leaving and computer-player rules, from shared/roster.js. In Wavelength somebody who leaves mid-game is
 * not replaced: the game carries on with one fewer (see afterRemoval).
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
 * @param {object} settings  { turnsEach?, mode? }
 * @returns {{ ok: boolean, error?: string }}
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

/** The host picks who guesses how: everyone alone (`solo`), or all together with one marker (`team`). */
export function setMode(room, id, mode) {
  if (id !== room.hostId) return fail('Only the host can change the settings.');
  if (room.phase !== 'lobby') return fail('The game has already started.');
  if (!MODES.includes(mode)) return fail('That is not a way to play.');
  room.mode = mode;
  return ok();
}

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

export function setClue(room, id, text) {
  if (room.phase !== 'clue') return fail('The clue has already been given.');
  if (id !== room.psychic) return fail('Only the psychic gives the clue.');
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CLUE_LENGTH);
  if (!clean) return fail('Type a clue first.');
  room.clue = clean;
  room.phase = 'guessing';
  return ok();
}

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

/** The guessers of a team game, who share the marker. Returns the player or a failure. */
function teamGuesser(room, id) {
  if (room.mode !== 'team') return fail('This game is not played in a team.');
  if (room.phase === 'clue') return fail('Wait for the clue.');
  if (room.phase !== 'guessing') return fail('It is not time to guess.');
  if (!hasPlayer(room, id)) return fail('You are not in this game.');
  if (id === room.psychic) return fail('You are the psychic: your team moves the marker.');
  return null;
}

/** Team mode: any guesser moves the team's shared marker (everyone but the psychic sees it move). */
export function setMarker(room, id, position) {
  const refused = teamGuesser(room, id);
  if (refused) return refused;
  if (typeof position !== 'number' || !Number.isFinite(position) || position < DIAL_MIN || position > DIAL_MAX) return fail('Move the marker to a place between the two ends.');
  room.marker = round1(position);
  return ok();
}

/** Team mode: any guesser locks the marker in where it is, which scores it for everyone. */
export function lockIn(room, id, nameOf = String) {
  const refused = teamGuesser(room, id);
  if (refused) return refused;
  if (room.marker === null) return fail('Move the marker first.');
  room.guesses = guessers(room).map((p) => ({ id: p.id, position: room.marker }));
  room.lockedBy = id;
  scoreTurn(room, namer(room, nameOf));
  return ok();
}

/** Scores the turn and opens the reveal. */
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
 * Wavelength's part of somebody leaving a game that is under way (the roster has already taken them out of the list and, if
 * they were the host, handed the host on): their guess goes, the psychic's turn is skipped if the psychic left, and the turn
 * is scored if it was only waiting for them. Fewer than MIN_PLAYERS left means the game is abandoned.
 *
 * Side effects: mutates the room (guesses, ready, nextIdx, phase) and may score the turn or start the next one.
 *
 * @param {object} room
 * @param {number | string} id  who left
 * @param {number} index        where they were in the player list
 * @param {() => number} rng
 * @returns {{ abandoned: boolean, finished: boolean }}
 */
function afterRemoval(room, id, index, rng) {
  const wasPsychic = room.psychic === id && PLAYING.includes(room.phase);
  if (index < room.nextIdx) room.nextIdx--;
  if (room.players.length) room.nextIdx %= room.players.length;
  room.guesses = room.guesses.filter((g) => g.id !== id);
  room.ready = (room.ready ?? []).filter((x) => x !== id);
  if (room.players.length < MIN_PLAYERS) {
    room.phase = 'abandoned';
    room.ready = [];
    return { abandoned: true, finished: false };
  }
  if (room.phase === 'reveal') return { abandoned: false, finished: unready(room).length === 0 ? finishTurn(room, rng) : false };
  if (wasPsychic) return { abandoned: false, finished: finishTurn(room, rng) };
  if (room.phase === 'guessing' && allGuessed(room)) scoreTurn(room, namer(room, String)); // the one who was missing has gone
  return { abandoned: false, finished: false };
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
 * The statistics for a finished game, in the shape of ctx.stats.record. Computer players are not accounts: people only. A team
 * shares one score: it wins when it averaged at least the outer band a turn (see scoring.js), and loses otherwise.
 *
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}
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
 * @returns {object | null}
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
 * @returns {object}
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
 * The standard scoreboard (shared/scores.js): the psychic has the turn, and while the results are up each player shows whether
 * they are ready to go on.
 *
 * @param {object} room  not changed
 * @param {number} userId  the viewer
 * @param {{ nameOf: (id: number) => string, online: (id: number) => boolean }} context
 * @returns {object}
 */
function scoreboardView(room, userId, { nameOf, online }) {
  const player = (p) => playerScoreboardEntry(p, { name: nameOf(p.id), me: userId, current: (PLAYING.includes(room.phase) || room.phase === 'reveal') && p.id === room.psychic, online, ready: room.phase === 'reveal' ? isBot(p) || room.ready.includes(p.id) : undefined });
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
 */
export function runBotAction(room, rng, action = pendingBotAction(room), nameOf = String) {
  if (!action) return false;
  const player = playerOf(room, action.id);
  const ai = aiById(AIS, player.ai);
  const view = viewFor(room, action.id, { nameOf });
  const anchors = spectrumById(room.spectrum?.id)?.anchors ?? [];
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
