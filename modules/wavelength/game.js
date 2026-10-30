// The rules of Wavelength, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// A turn: the psychic sees a hidden target on a dial (0 is the left end, 100 the right) and gives a clue; everyone else
// turns the dial to where they think it is. Once every guesser has locked in a guess the target is revealed and scored.
import { placements } from '../../shared/scores.js';
import { aiById, assignAIs, describeAI } from '../../shared/ai.js';
import { MARKER_COLOURS, markerProblem, normaliseMarker, startingMarker } from '../../shared/markerColours.js';
import { AIS } from './ai/index.js';
import { SPECTRA, spectrumById } from './spectra.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const TURNS_EACH = { min: 1, max: 5, default: 2 };
export const CLUE_LENGTH = 80;
/** `solo`: everyone guesses alone. `team`: the guessers share one marker, move it together and lock it in. */
export const MODES = ['solo', 'team'];
export const COLOURS = MARKER_COLOURS; // the free palette; any other colour is a shop unlock (shared/markerColours.js)
/** The bands of the target, from the middle outwards: a guess within `within` of the target scores `points`. */
export const BANDS = [
  { within: 2.5, points: 4 },
  { within: 7.5, points: 3 },
  { within: 12.5, points: 2 },
];
/** The hidden target is always somewhere its whole outer band fits on the dial. */
export const TARGET_RANGE = { min: 13, max: 87 };

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana'];
const LIVE = ['lobby', 'clue', 'guessing', 'reveal'];
const PLAYING = ['clue', 'guessing'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export const isLive = (room) => LIVE.includes(room.phase);
export const hasPlayer = (room, id) => room.players.some((p) => p.id === id);
const playerOf = (room, id) => room.players.find((p) => p.id === id);
const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);
const guessers = (room) => room.players.filter((p) => p.id !== room.psychic);
const newPlayer = (id, colour) => ({ id, colour, score: 0, bullseyes: 0, cluesGiven: 0, onlyScorer: 0, highGuesses: 0, lowGuesses: 0, blankClues: 0 });
const bump = (player, key) => (player[key] = (player[key] ?? 0) + 1); // (rooms saved before these were counted have no such keys)
/** People (accounts), as opposed to computer players. */
export const humans = (room) => room.players.filter((p) => !p.bot);
const freeColour = (room) => COLOURS.find((c) => !room.players.some((p) => p.colour === c));
const allGuessed = (room) => guessers(room).every((p) => room.guesses.some((g) => g.id === p.id));
const round1 = (n) => Math.round(n * 10) / 10;

/** The points a guess earns when the target is where it is. */
export function pointsFor(position, target) {
  const distance = Math.abs(position - target);
  return BANDS.find((band) => distance <= band.within)?.points ?? 0;
}

/** `colour` is the host's default marker colour, already checked to be one they may use (ctx.markers.preferred). */
export function createRoom({ code, hostId, now = Date.now(), turnsEach = TURNS_EACH.default, colour = null }) {
  return {
    code,
    hostId,
    phase: 'lobby',
    turnsEach,
    turnsTotal: 0,
    turn: 0,
    players: [newPlayer(hostId, startingMarker(colour, [], true))],
    mode: 'solo',
    nextIdx: 0,
    ready: [], // at the reveal: the people who have closed the scores pop-up
    nextBot: 1, // computer players are seats named 'bot:<n>' with bot: true, a name and (once started) an ai id
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
}

/** `colour` is the player's default marker colour, already checked to be one they may use; it is used if it is free. */
export function addPlayer(room, id, colour = null) {
  if (hasPlayer(room, id)) return ok();
  if (room.phase !== 'lobby') return fail('That game has already started.');
  if (room.players.length >= MAX_PLAYERS) return fail('That game is full.');
  room.players.push(newPlayer(id, startingMarker(colour, room.players.map((p) => p.colour), true)));
  return ok();
}

/** `canCustom`: this player has unlocked any marker colour (otherwise only the free palette is allowed). */
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

function newBot(room) {
  const used = new Set(room.players.filter((p) => p.bot).map((p) => p.name));
  let name = BOT_NAMES.find((n) => !used.has(n)) ?? 'Computer';
  for (let n = 2; used.has(name); n++) name = `Computer ${n}`;
  room.nextBot ??= 1;
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

export function start(room, id, rng = Math.random) {
  if (id !== room.hostId) return fail('Only the host can start the game.');
  if (room.phase !== 'lobby') return fail('The game has already started.');
  if (room.players.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players.`);
  room.turnsTotal = room.turnsEach * room.players.length;
  room.turn = 0;
  room.used = [];
  room.nextIdx = Math.floor(rng() * room.players.length);
  startTurn(room, rng);
  // Every computer player gets an AI for the whole game (after the deal, so seeded games deal as they always did).
  const bots = room.players.filter((p) => p.bot);
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
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 100) return fail('Turn the dial to a place between the two ends.');
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
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 100) return fail('Move the marker to a place between the two ends.');
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
    if (points === BANDS[0].points) player.bullseyes++;
    entries.push({ id, position, points, bullseye: points === BANDS[0].points });
  }
  // With three or more people: the one guesser who scored, and a clue nobody scored on.
  const scorers = entries.filter((e) => e.points > 0);
  if (entries.length >= 2 && scorers.length === 1) bump(playerOf(room, scorers[0].id), 'onlyScorer');
  for (const e of entries) {
    if (e.position === 100) bump(playerOf(room, e.id), 'highGuesses'); // the very top of the dial
    if (e.position === 0) bump(playerOf(room, e.id), 'lowGuesses'); // and the very bottom
  }
  const psychic = playerOf(room, room.psychic);
  if (psychic && entries.length >= 2 && !scorers.length) bump(psychic, 'blankClues');
  const psychicPoints = entries.length ? Math.round(entries.reduce((sum, e) => sum + e.points, 0) / entries.length) : 0;
  if (psychic) {
    psychic.score += psychicPoints;
    psychic.cluesGiven++;
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

/** Brings a saved room up to date (nothing has changed shape yet; here for the day something does). */
export function migrate(room) {
  room.nextBot ??= 1;
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
  const wasPsychic = room.psychic === id && PLAYING.includes(room.phase);
  room.players.splice(index, 1);
  if (index < room.nextIdx) room.nextIdx--;
  if (room.players.length) room.nextIdx %= room.players.length;
  room.guesses = room.guesses.filter((g) => g.id !== id);
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
  if (wasPsychic) return ok({ empty: false, abandoned: false, finished: finishTurn(room, rng) });
  if (room.phase === 'guessing' && allGuessed(room)) scoreTurn(room, namer(room, nameOf)); // the one who was missing has gone
  return ok({ empty: false, abandoned: false, finished: false });
}

/** Players best first; tied scores share a placement and every tied leader wins. */
export function standings(room) {
  const places = placements(Object.fromEntries(room.players.map((p) => [p.id, p.score])));
  return [...room.players].sort((a, b) => b.score - a.score).map((p) => ({ ...p, placement: places[p.id], winner: places[p.id] === 1 }));
}

/** The statistics for a finished game, in the shape of ctx.stats.record. Computer players are not accounts: people only. */
export function statsPlayers(room) {
  // A team shares one score. It wins when it averaged at least the outer band (2 points) a turn, and loses otherwise.
  const teamWon = (p) => p.score >= 2 * room.turnsTotal;
  return standings(room).filter((p) => !p.bot).map((p) => ({
    userId: p.id,
    outcome: (room.mode === 'team' ? teamWon(p) : p.winner) ? 'win' : 'loss',
    placement: p.placement,
    score: p.score,
    extras: { bullseyes: p.bullseyes, cluesGiven: p.cluesGiven, onlyScorer: p.onlyScorer ?? 0, highGuesses: p.highGuesses ?? 0, lowGuesses: p.lowGuesses ?? 0, blankClues: p.blankClues ?? 0 },
  }));
}

/**
 * What one person may see. Only the psychic knows the target until the reveal, and nobody sees anyone else's guess
 * until then either.
 */
export function viewFor(room, userId, { nameOf = String, onlineOf = () => true, canCustom = false } = {}) {
  nameOf = namer(room, nameOf);
  const isPsychic = room.psychic === userId;
  const revealed = ['reveal', 'finished'].includes(room.phase);
  const final = ['finished', 'abandoned'].includes(room.phase) ? new Map(standings(room).map((p) => [p.id, p])) : new Map();
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
    result: revealed && room.result
      ? { ...room.result, psychicName: nameOf(room.result.psychic), entries: room.result.entries.map((e) => ({ ...e, name: nameOf(e.id) })) }
      : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: nameOf(p.id),
      colour: p.colour,
      score: p.score,
      online: p.bot || onlineOf(p.id),
      bot: Boolean(p.bot),
      ai: p.bot && p.ai ? describeAI(aiById(AIS, p.ai)) : null, // computer players only, once a game has started
      guessed: room.guesses.some((g) => g.id === p.id),
      ready: room.phase === 'reveal' ? Boolean(p.bot) || room.ready.includes(p.id) : false,
      placement: final.get(p.id)?.placement ?? null,
      winner: final.get(p.id)?.winner ?? false,
    })),
    scoreboard: {
      players: room.players.map((p) => ({ id: p.id, name: nameOf(p.id), userId: p.bot ? undefined : p.id, score: p.score, isMe: p.id === userId, bot: Boolean(p.bot), current: PLAYING.includes(room.phase) || room.phase === 'reveal' ? p.id === room.psychic : false, away: !p.bot && !onlineOf(p.id), ...(room.phase === 'reveal' ? { ready: Boolean(p.bot) || room.ready.includes(p.id) } : {}) })),
      rounds: (room.history ?? []).map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: false,
    },
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
    return psychic?.bot ? { type: 'clue', id: psychic.id } : null;
  }
  if (room.phase !== 'guessing') return null;
  if (room.mode === 'team') {
    // A team of computer players only plays by itself when no person is in it: people agree on the marker themselves.
    if (guessers(room).some((p) => !p.bot)) return null;
    const bot = guessers(room)[0];
    return { type: room.marker === null ? 'marker' : 'lock', id: bot.id };
  }
  const guesser = guessers(room).find((p) => p.bot && !room.guesses.some((g) => g.id === p.id));
  return guesser ? { type: 'guess', id: guesser.id } : null;
}

/**
 * Plays one pending computer move. The decision is made from that seat's own view (viewFor), so a computer guesser
 * never sees the target. An AI that throws or answers with something illegal is replaced by a random legal choice.
 */
export function runBotAction(room, rng = Math.random, action = pendingBotAction(room), nameOf = String) {
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
  const clamped = typeof position === 'number' && Number.isFinite(position) ? Math.min(100, Math.max(0, position)) : 15 + rng() * 70;
  return (action.type === 'marker' ? setMarker(room, action.id, clamped) : guess(room, action.id, clamped, nameOf)).ok;
}
