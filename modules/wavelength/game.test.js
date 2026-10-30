// The rules of Wavelength, without sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { SPECTRA, spectrumById } from './spectra.js';
import { AIS } from './ai/index.js';
import { seeded } from '../../shared/testkit.js';

/** A room of the given user ids, started with the first player as the first psychic. */
function started(ids = [1, 2, 3], { turnsEach = 2, seed = 7 } = {}) {
  const room = game.createRoom({ code: 'boss-aware-you', hostId: ids[0] });
  for (const id of ids.slice(1)) assert.ok(game.addPlayer(room, id).ok);
  assert.ok(game.setTurnsEach(room, ids[0], turnsEach).ok);
  const rng = seeded(seed);
  assert.ok(game.start(room, ids[0], rng).ok);
  return room;
}
const guessersOf = (room) => room.players.filter((p) => p.id !== room.psychic);
const score = (room, id) => room.players.find((p) => p.id === id).score;
const closeReveal = (room) => room.players.forEach((p) => game.ready(room, p.id));

test('the bands score 4, 3, 2 and 0 by distance from the target', () => {
  assert.equal(game.pointsFor(50, 50), 4);
  assert.equal(game.pointsFor(52.5, 50), 4);
  assert.equal(game.pointsFor(47.4, 50), 3);
  assert.equal(game.pointsFor(57.5, 50), 3);
  assert.equal(game.pointsFor(57.6, 50), 2);
  assert.equal(game.pointsFor(37.5, 50), 2);
  assert.equal(game.pointsFor(37.4, 50), 0);
  assert.equal(game.pointsFor(0, 50), 0);
});

test('every spectrum is well formed and its examples lie on the dial', () => {
  assert.equal(new Set(SPECTRA.map((s) => s.id)).size, SPECTRA.length, 'unique ids');
  for (const s of SPECTRA) {
    assert.ok(s.left && s.right && s.left !== s.right, s.id);
    assert.ok(s.anchors.length >= 3, `${s.id} has examples`);
    for (const a of s.anchors) assert.ok(a.text && a.position >= 0 && a.position <= 100, `${s.id}: ${a.text}`);
    assert.deepEqual([...s.anchors].sort((a, b) => a.position - b.position), s.anchors, `${s.id} examples run left to right`);
  }
  assert.equal(spectrumById('temperature').left, 'Cold');
  assert.equal(spectrumById('nonsense'), null);
});

test('a lobby: players, colours, settings and computer players', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  assert.ok(game.addPlayer(room, 2).ok);
  assert.ok(game.addPlayer(room, 2).ok, 'joining twice is harmless');
  assert.equal(game.setColour(room, 2, room.players[0].colour).ok, false, 'colours are unique');
  assert.equal(game.setColour(room, 2, '#123456').ok, false);
  assert.equal(game.setTurnsEach(room, 2, 3).ok, false, 'only the host');
  assert.equal(game.setTurnsEach(room, 1, 9).ok, false);
  assert.ok(game.setTurnsEach(room, 1, 3).ok);
  assert.equal(game.addBot(room, 2).ok, false, 'only the host adds computers');
  assert.ok(game.fillBots(room, 1, 4).ok);
  assert.equal(room.players.length, 4);
  assert.ok(room.players.slice(2).every((p) => p.bot && p.id.startsWith('bot:')));
  assert.equal(game.start(room, 2).ok, false, 'only the host starts');
  assert.ok(game.start(room, 1, seeded(1)).ok);
  assert.equal(room.turnsTotal, 12);
  assert.ok(room.players.filter((p) => p.bot).every((p) => AIS.some((ai) => ai.id === p.ai)), 'every bot has an AI');
  assert.equal(game.addPlayer(room, 9).ok, false, 'too late to join');
  assert.equal(game.addBot(room, 1).ok, false);
});

test('a turn: clue, guesses, reveal and ready', () => {
  const room = started([1, 2, 3]);
  const psychic = room.psychic;
  const [a, b] = guessersOf(room).map((p) => p.id);
  assert.equal(room.phase, 'clue');
  assert.ok(room.target >= game.TARGET_RANGE.min && room.target <= game.TARGET_RANGE.max);
  assert.equal(game.guess(room, a, 50).ok, false, 'no guessing before the clue');
  assert.equal(game.setClue(room, a, 'a hot bath').ok, false, 'only the psychic gives the clue');
  assert.equal(game.setClue(room, psychic, '   ').ok, false, 'a clue is needed');
  assert.ok(game.setClue(room, psychic, `  a   hot\nbath  `).ok);
  assert.equal(room.clue, 'a hot bath', 'whitespace is tidied');
  assert.equal(game.setClue(room, psychic, 'again').ok, false, 'one clue a turn');
  assert.equal(room.phase, 'guessing');

  assert.equal(game.guess(room, psychic, 50).ok, false, 'the psychic cannot guess');
  for (const bad of [-1, 101, NaN, Infinity, '50', null, undefined, {}]) assert.equal(game.guess(room, a, bad).ok, false, String(bad));
  assert.equal(game.guess(room, 99, 50).ok, false, 'a stranger cannot guess');
  assert.ok(game.guess(room, a, room.target).ok);
  assert.equal(game.guess(room, a, 10).ok, false, 'one guess a turn');
  assert.equal(room.phase, 'guessing');
  assert.ok(game.guess(room, b, room.target > 50 ? room.target - 20 : room.target + 20).ok);

  assert.equal(room.phase, 'reveal', 'the last guess reveals the target');
  assert.equal(score(room, a), 4);
  assert.equal(score(room, b), 0);
  assert.equal(score(room, psychic), 2, 'the psychic gets the average, rounded');
  assert.equal(room.result.psychicPoints, 2);
  assert.equal(room.history.length, 1);
  assert.deepEqual(room.history[0].deltas, { [a]: 4, [b]: 0, [psychic]: 2 });
  assert.equal(room.players.find((p) => p.id === a).bullseyes, 1);
  assert.equal(room.players.find((p) => p.id === psychic).cluesGiven, 1);

  assert.ok(game.ready(room, 1).ok);
  assert.equal(room.phase, 'reveal', 'waits for the others');
  assert.equal(game.ready(room, 99).ok, false);
  assert.ok(game.ready(room, 2).ok);
  assert.ok(game.ready(room, 3).ok);
  assert.equal(room.phase, 'clue');
  assert.equal(room.turn, 1);
  assert.notEqual(room.psychic, psychic, 'the next player is the psychic');
  assert.deepEqual(room.guesses, []);
  assert.equal(room.clue, '');
});

test('everyone is the psychic turnsEach times, spectra do not repeat, and the game finishes', () => {
  const room = started([1, 2, 3], { turnsEach: 2 });
  const psychics = [];
  const spectra = [];
  while (room.phase !== 'finished') {
    psychics.push(room.psychic);
    spectra.push(room.spectrum.id);
    assert.ok(game.setClue(room, room.psychic, 'something').ok);
    for (const p of guessersOf(room)) assert.ok(game.guess(room, p.id, 50).ok);
    closeReveal(room);
  }
  assert.equal(psychics.length, 6);
  for (const id of [1, 2, 3]) assert.equal(psychics.filter((x) => x === id).length, 2);
  assert.equal(new Set(spectra).size, 6, 'no spectrum twice in a short game');
  assert.equal(room.history.length, 6);
  const total = (id) => room.history.reduce((n, r) => n + (r.deltas[id] ?? 0), 0);
  for (const p of room.players) assert.equal(total(p.id), p.score, 'the history adds up to the score');
  assert.equal(game.guess(room, 2, 50).ok, false);
});

test('the view hides the target from guessers and every guess until the reveal', () => {
  const room = started([1, 2, 3]);
  const psychic = room.psychic;
  const [a, b] = guessersOf(room).map((p) => p.id);
  const view = (id) => game.viewFor(room, id);
  assert.equal(view(psychic).target, room.target);
  assert.equal(view(a).target, null);
  game.setClue(room, psychic, 'warm');
  game.guess(room, a, 33);
  assert.deepEqual(view(a).guesses, [{ id: a, position: 33 }], 'you see your own guess');
  assert.deepEqual(view(b).guesses, []);
  assert.deepEqual(view(psychic).guesses, [], 'even the psychic waits');
  assert.equal(view(b).players.find((p) => p.id === a).guessed, true);
  assert.ok(!JSON.stringify(view(a)).includes(`"target":${room.target}`));
  assert.ok(!JSON.stringify(view(b)).includes('"result":{'), 'no result yet');
  game.guess(room, b, 70);
  assert.equal(view(a).target, room.target, 'revealed');
  assert.equal(view(a).guesses.length, 2);
  assert.equal(view(a).result.entries.length, 2);
  assert.equal(view(a).scoreboard.players.filter((p) => p.current).length, 1, 'the psychic is the current player');
  assert.equal(room.players.every((p) => view(p.id).spectrum.left), true);
  assert.deepEqual(game.viewFor(game.createRoom({ code: 'x-y-z', hostId: 1 }), 1).spectrum, null, 'no spectrum in the lobby');
});

test('leaving: a guesser who was holding up the reveal, the psychic, and too few players', () => {
  const room = started([1, 2, 3, 4]);
  const psychic = room.psychic;
  const [a, b, c] = guessersOf(room).map((p) => p.id);
  game.setClue(room, psychic, 'warm');
  game.guess(room, a, 50);
  game.guess(room, b, 50);
  const outcome = game.removePlayer(room, c);
  assert.ok(outcome.ok && !outcome.abandoned);
  assert.equal(room.phase, 'reveal', 'the missing guess is no longer waited for');
  assert.equal(room.history.length, 1);

  const second = started([1, 2, 3, 4]);
  game.setClue(second, second.psychic, 'warm');
  const gone = second.psychic;
  game.removePlayer(second, gone);
  assert.equal(second.phase, 'clue', 'the turn is skipped and the next one starts');
  assert.notEqual(second.psychic, gone);
  assert.equal(second.history.length, 0, 'a skipped turn scores nothing');
  assert.equal(second.players.length, 3);

  const pair = started([1, 2]);
  game.removePlayer(pair, 2);
  assert.equal(pair.phase, 'abandoned');
  assert.equal(game.removePlayer(game.createRoom({ code: 'a-b-c', hostId: 1 }), 1).empty, true);
  const host = started([1, 2, 3]);
  game.removePlayer(host, 1);
  assert.equal(host.hostId, 2, 'the host passes on');
});

/** Plays one turn: the psychic gives a clue and every guesser guesses `where(player, target)`. */
function playTurn(room, where) {
  game.setClue(room, room.psychic, 'x');
  for (const p of guessersOf(room)) assert.ok(game.guess(room, p.id, where(p, room.target)).ok);
  assert.equal(room.phase, 'reveal');
}
const countOf = (room, id, key) => room.players.find((p) => p.id === id)[key] ?? 0;

test('being the only guesser to score, with three or more people', () => {
  const room = started([1, 2, 3, 4]);
  const [a, b, c] = guessersOf(room).map((p) => p.id);
  const psychic = room.psychic;
  const far = (t) => (t > 50 ? t - 40 : t + 40);
  playTurn(room, (p, t) => (p.id === a ? t : far(t)));
  assert.equal(countOf(room, a, 'onlyScorer'), 1);
  assert.equal(countOf(room, b, 'onlyScorer') + countOf(room, c, 'onlyScorer'), 0);
  assert.equal(countOf(room, psychic, 'blankClues'), 0, 'somebody scored');
  closeReveal(room);
  playTurn(room, (p, t) => t);
  const total = room.players.reduce((n, p) => n + countOf(room, p.id, 'onlyScorer'), 0);
  assert.equal(total, 1, 'when everybody scores, nobody was the only one');
});

test('a clue that nobody scores on, and guesses at the very top and bottom of the dial', () => {
  const room = started([1, 2, 3]);
  const [a, b] = guessersOf(room).map((p) => p.id);
  const psychic = room.psychic;
  const far = (t) => (t > 50 ? t - 40 : t + 40);
  playTurn(room, (p, t) => (p.id === a ? 100 : far(t)));
  assert.equal(countOf(room, psychic, 'blankClues'), 1, 'both guessers scored nothing');
  assert.equal(countOf(room, a, 'highGuesses'), 1);
  assert.equal(countOf(room, a, 'lowGuesses'), 0);
  assert.equal(countOf(room, a, 'onlyScorer') + countOf(room, b, 'onlyScorer'), 0, 'nobody scored');
  closeReveal(room);
  const [x, y] = guessersOf(room).map((p) => p.id);
  const highsBefore = countOf(room, y, 'highGuesses');
  playTurn(room, (p) => (p.id === x ? 0 : 100));
  assert.equal(countOf(room, x, 'lowGuesses'), 1);
  assert.equal(countOf(room, y, 'highGuesses'), highsBefore + 1);
  const stats = game.statsPlayers(Object.assign(room, { phase: 'finished' }));
  for (const s of stats) for (const key of ['onlyScorer', 'highGuesses', 'lowGuesses', 'blankClues']) assert.equal(typeof s.extras[key], 'number', key);
});

test('with only two people a clue nobody scores on, or the only scorer, does not count', () => {
  const room = started([1, 2]);
  const far = (t) => (t > 50 ? t - 40 : t + 40);
  playTurn(room, (p, t) => far(t));
  assert.equal(countOf(room, room.psychic, 'blankClues'), 0, 'one guesser: not a group');
  closeReveal(room);
  playTurn(room, (p, t) => t);
  for (const p of room.players) assert.equal(countOf(room, p.id, 'onlyScorer'), 0, 'one guesser is not the only one of several');
});

test('rooms saved before these were counted keep working', () => {
  const room = started([1, 2, 3]);
  for (const p of room.players) for (const key of ['onlyScorer', 'highGuesses', 'lowGuesses', 'blankClues']) delete p[key];
  playTurn(room, (p) => 100);
  assert.equal(guessersOf(room).every((p) => p.highGuesses === 1), true);
  assert.equal(room.players.find((p) => p.id === room.psychic).blankClues, 1);
});

test('statistics list the people, with their bullseyes and clues', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  game.addPlayer(room, 2);
  game.addBot(room, 1);
  game.start(room, 1, seeded(3));
  while (room.phase !== 'finished') {
    if (room.phase === 'clue') game.setClue(room, room.psychic, 'x');
    if (room.phase === 'guessing') for (const p of guessersOf(room)) game.guess(room, p.id, room.target);
    if (room.phase === 'reveal') closeReveal(room);
  }
  const stats = game.statsPlayers(room);
  assert.deepEqual(stats.map((s) => s.userId).sort(), [1, 2], 'no computer players');
  for (const s of stats) {
    assert.equal(s.extras.cluesGiven, 2);
    assert.ok(s.extras.bullseyes > 0);
  }
  assert.ok(stats.some((s) => s.outcome === 'win'));
});

// ---------- computer players ----------

function playBots(seed, { turnsEach = 2, count = 4 } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 'bot:0' });
  room.players.length = 0;
  room.hostId = null;
  for (let i = 0; i < count; i++) room.players.push({ id: `bot:${i + 1}`, colour: game.COLOURS[i], score: 0, bullseyes: 0, cluesGiven: 0, bot: true, name: `B${i}` });
  room.nextBot = count + 1;
  room.turnsEach = turnsEach;
  room.turnsTotal = turnsEach * count;
  game.migrate(room);
  // start() needs a host; give it one that is a bot, which is fine for a rules test
  room.hostId = room.players[0].id;
  assert.ok(game.start(room, room.hostId, rng).ok);
  let moves = 0;
  while (room.phase !== 'finished') {
    if (room.phase === 'reveal') {
      game.forceNext(room, rng);
      continue;
    }
    assert.ok(game.runBotAction(room, rng), `a move is pending in ${room.phase}`);
    assert.ok(++moves < 1000, 'the game ends');
  }
  return room;
}

test('computer players play whole games legally, over many seeds', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const room = playBots(seed);
    assert.equal(room.history.length, room.turnsTotal);
    for (const p of room.players) assert.ok(Number.isInteger(p.score) && p.score >= 0);
  }
});

test('a good computer player beats a random one, and every AI is legal on its own', () => {
  const totals = { standard: 0, random: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
    room.players.length = 0;
    for (let i = 0; i < 4; i++) room.players.push({ id: `bot:${i + 1}`, colour: game.COLOURS[i], score: 0, bullseyes: 0, cluesGiven: 0, bot: true, name: `B${i}`, ai: i < 2 ? 'standard' : 'random' });
    room.hostId = 'bot:1';
    room.turnsEach = 2;
    game.start(room, 'bot:1', rng);
    for (const p of room.players) p.ai = p.id <= 'bot:2' ? 'standard' : 'random';
    while (room.phase !== 'finished') {
      if (room.phase === 'reveal') game.forceNext(room, rng);
      else game.runBotAction(room, rng);
    }
    for (const p of room.players) totals[p.ai] += p.score;
  }
  assert.ok(totals.standard > totals.random * 1.4, `standard ${totals.standard} against random ${totals.random}`);
});

test('a computer player never sees the target, and a broken AI cannot stop the game', () => {
  const room = started([1, 2, 3]);
  room.players[1].bot = true;
  room.players[1].name = 'Ada';
  room.players[2].bot = true;
  room.players[2].name = 'Bram';
  room.players[1].ai = room.players[2].ai = 'standard';
  const seen = [];
  const original = AIS[0].guess;
  AIS[0].guess = (ctx, rng) => {
    seen.push(JSON.stringify(ctx));
    throw new Error('boom');
  };
  try {
    game.setClue(room, room.psychic === 1 ? 1 : room.psychic, 'a hot bath');
    while (game.pendingBotAction(room)) assert.ok(game.runBotAction(room, seeded(2)));
  } finally {
    AIS[0].guess = original;
  }
  assert.ok(seen.every((c) => !c.includes('target')), 'the guess context has no target');
  assert.equal(room.phase === 'reveal' || room.phase === 'guessing', true);
});

test('a saved room comes back as it was', () => {
  const room = started([1, 2, 3]);
  game.setClue(room, room.psychic, 'warm');
  const copy = game.migrate(JSON.parse(JSON.stringify(room)));
  assert.deepEqual(copy, room);
  delete copy.used;
  delete copy.nextBot;
  assert.deepEqual(game.migrate(copy).used, [], 'rooms saved without a history of spectra still load');
});

test('marker colours: a default is used when free, any colour needs the unlock, and colours stay unique', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, colour: '#6a00ff' });
  assert.equal(room.players[0].colour, '#6a00ff', 'the host gets their default');
  assert.equal(game.createRoom({ code: 'a-b-c', hostId: 1 }).players[0].colour, game.COLOURS[0], 'no default: the first colour');
  assert.ok(game.addPlayer(room, 2, '#6a00ff').ok);
  assert.equal(room.players[1].colour, game.COLOURS[0], 'the default is taken: the first free colour');
  assert.ok(game.addPlayer(room, 3, '#123456').ok);
  assert.ok(game.addPlayer(room, 4, '#123456').ok);
  assert.equal(room.players[3].colour, game.COLOURS[1], 'colours are unique, even custom ones');
  assert.equal(game.setColour(room, 2, '#abcdef').ok, false, 'a custom colour needs the unlock');
  assert.ok(game.setColour(room, 2, '#ABCDEF', true).ok);
  assert.equal(room.players[1].colour, '#abcdef', 'kept in lower case');
  assert.equal(game.setColour(room, 3, '#abcdef', true).ok, false, 'someone else has it');
  assert.equal(game.setColour(room, 3, 'red', true).ok, false);
  assert.ok(game.setColour(room, 2, game.COLOURS[2]).ok, 'back to a free one without the unlock');
  assert.equal(game.viewFor(room, 1).canCustomColour, false);
  assert.equal(game.viewFor(room, 1, { canCustom: true }).canCustomColour, true);
  const bot = game.addBot(room, 1);
  assert.ok(bot.ok && room.players.at(-1).colour, 'a computer player gets a free colour too');
});

// ---------- team mode ----------

function teamRoom(ids = [1, 2, 3, 4], seed = 5) {
  const room = game.createRoom({ code: 'a-b-c', hostId: ids[0] });
  for (const id of ids.slice(1)) game.addPlayer(room, id);
  assert.ok(game.setTurnsEach(room, ids[0], 1).ok);
  assert.ok(game.setMode(room, ids[0], 'team').ok);
  assert.ok(game.start(room, ids[0], seeded(seed)).ok);
  return room;
}

test('the host chooses the mode in the lobby only', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  game.addPlayer(room, 2);
  assert.equal(room.mode, 'solo');
  assert.equal(game.setMode(room, 2, 'team').ok, false, 'only the host');
  assert.equal(game.setMode(room, 1, 'chaos').ok, false);
  assert.ok(game.setMode(room, 1, 'team').ok);
  assert.equal(game.viewFor(room, 1).mode, 'team');
  game.start(room, 1, seeded(1));
  assert.equal(game.setMode(room, 1, 'solo').ok, false, 'not once it has started');
});

test('a team moves one marker together and anyone can lock it in; everyone scores the same', () => {
  const room = teamRoom();
  const psychic = room.psychic;
  const [a, b, c] = guessersOf(room).map((p) => p.id);
  assert.equal(game.setMarker(room, a, 50).ok, false, 'no moving before the clue');
  game.setClue(room, psychic, 'a hot bath');
  assert.equal(game.guess(room, a, 50).ok, false, 'a team does not guess alone');
  assert.equal(game.setMarker(room, psychic, 50).ok, false, 'the psychic does not move it');
  for (const bad of [-1, 101, NaN, '50', null]) assert.equal(game.setMarker(room, a, bad).ok, false, String(bad));
  assert.equal(game.lockIn(room, a).ok, false, 'move it first');
  assert.ok(game.setMarker(room, a, 20).ok);
  assert.ok(game.setMarker(room, b, 31.26).ok, 'any guesser can move it');
  assert.equal(room.marker, 31.3);
  assert.equal(game.viewFor(room, c).marker, 31.3, 'the other guessers see it');
  assert.equal(game.viewFor(room, psychic).marker, null, 'the psychic does not');
  assert.equal(game.viewFor(room, psychic).target, room.target);
  assert.equal(game.lockIn(room, psychic).ok, false);
  game.setMarker(room, c, room.target + 1);
  assert.ok(game.lockIn(room, b).ok);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.result.team, true);
  assert.equal(room.result.lockedBy, b);
  assert.equal(room.result.entries.length, 3);
  for (const p of room.players) assert.equal(p.score, 4, 'everyone, the psychic too, scores the team points');
  assert.equal(game.viewFor(room, psychic).marker, room.marker, 'the marker is shown at the reveal');
  assert.equal(game.setMarker(room, a, 10).ok, false, 'locked');
  closeReveal(room);
  assert.equal(room.phase, 'clue', 'the next turn');
  assert.equal(room.marker, null);
});

test('a team game is won or lost together in the statistics', () => {
  const play = (position) => {
    const room = teamRoom([1, 2, 3]);
    while (room.phase !== 'finished') {
      if (room.phase === 'clue') game.setClue(room, room.psychic, 'x');
      else if (room.phase === 'guessing') {
        const g = guessersOf(room)[0].id;
        game.setMarker(room, g, position(room));
        game.lockIn(room, g);
      } else closeReveal(room);
    }
    return game.statsPlayers(room);
  };
  const good = play((room) => room.target);
  assert.deepEqual(good.map((s) => s.outcome), ['win', 'win', 'win']);
  assert.equal(good[0].score, 12);
  const bad = play((room) => (room.target > 50 ? 0 : 100));
  assert.deepEqual(bad.map((s) => s.outcome), ['loss', 'loss', 'loss']);
});

test('a team of computer players moves and locks the marker by itself, but waits for people', () => {
  const room = teamRoom([1, 2, 3]);
  for (const p of room.players) p.bot = true;
  for (const p of room.players) p.name = `B${p.id}`;
  let moves = 0;
  while (room.phase !== 'finished') {
    if (room.phase === 'reveal') game.forceNext(room, seeded(9));
    else assert.ok(game.runBotAction(room, seeded(moves)), `a move is pending in ${room.phase}`);
    assert.ok(++moves < 100);
  }
  assert.equal(room.history.length, 3);

  const mixed = teamRoom([1, 2, 3]);
  mixed.players[1].bot = true;
  mixed.players[2].bot = true;
  game.setClue(mixed, mixed.psychic, 'x');
  const person = guessersOf(mixed).some((p) => !p.bot);
  if (person) assert.equal(game.pendingBotAction(mixed), null, 'a person among the guessers: the bots wait for them');
  else assert.equal(game.pendingBotAction(mixed).type, 'marker', 'only bots guess: they place the marker');
});

test('a team game survives the psychic leaving, and a saved room keeps its mode and marker', () => {
  const room = teamRoom();
  game.setClue(room, room.psychic, 'x');
  game.setMarker(room, guessersOf(room)[0].id, 42);
  const copy = game.migrate(JSON.parse(JSON.stringify(room)));
  assert.equal(copy.mode, 'team');
  assert.equal(copy.marker, 42);
  const gone = room.psychic;
  game.removePlayer(room, gone);
  assert.equal(room.phase, 'clue');
  assert.equal(room.marker, null, 'a new turn starts with the marker unplaced');
  const old = game.migrate({ ...JSON.parse(JSON.stringify(started())), mode: undefined, marker: undefined });
  assert.equal(old.mode, 'solo', 'a room saved before team mode is a solo game');
});
