// Randomised play of the Wavelength rules: seeded games where people (and strangers) try legal and illegal actions in
// any order, leave, and come back, in both modes. After every action the room and every player's view must be sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/testkit.js';

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const POSITIONS = [0, 100, 50, 12.5, 87.5, 33.3, -1, 101, NaN, Infinity, '50', null, undefined, [], {}, 49.96];
const TEXTS = ['a hot bath', '', '   ', 'x'.repeat(200), 'two\nlines', 7, null, undefined];

function checkRoom(room, label) {
  const ids = room.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: no player twice`);
  assert.equal(new Set(room.players.map((p) => p.colour)).size, ids.length, `${label}: colours are unique`);
  assert.ok(room.players.length <= game.MAX_PLAYERS, `${label}: not too many players`);
  for (const p of room.players) assert.ok(Number.isInteger(p.score) && p.score >= 0, `${label}: ${p.id} has a sound score`);
  assert.ok(['solo', 'team'].includes(room.mode), `${label}: mode`);
  assert.ok(['lobby', 'clue', 'guessing', 'reveal', 'finished', 'abandoned'].includes(room.phase), `${label}: phase ${room.phase}`);
  assert.ok(room.guesses.every((g) => ids.includes(g.id) && g.id !== room.psychic), `${label}: guesses are from guessers in the room`);
  assert.equal(new Set(room.guesses.map((g) => g.id)).size, room.guesses.length, `${label}: one guess each`);
  assert.ok(room.guesses.every((g) => g.position >= 0 && g.position <= 100), `${label}: guesses lie on the dial`);
  assert.ok(room.marker === null || (room.marker >= 0 && room.marker <= 100), `${label}: the marker lies on the dial`);
  if (room.mode === 'solo') assert.equal(room.marker, null, `${label}: no marker in a solo game`);
  assert.ok(room.ready.every((id) => ids.includes(id)), `${label}: ready is a subset of the players`);
  if (['clue', 'guessing'].includes(room.phase)) assert.ok(ids.includes(room.psychic), `${label}: the psychic is in the room`);
  if (['clue', 'guessing', 'reveal'].includes(room.phase)) {
    // (At the reveal the psychic may have left since: the result already holds what they scored.)
    assert.ok(room.target >= game.TARGET_RANGE.min && room.target <= game.TARGET_RANGE.max, `${label}: the target is in range`);
    assert.ok(room.spectrum?.left && room.spectrum?.right, `${label}: a spectrum`);
  }
  if (room.phase === 'clue') assert.ok(!room.clue && !room.guesses.length && room.marker === null, `${label}: nothing yet in the clue phase`);
  if (room.phase === 'guessing') assert.ok(room.clue, `${label}: guessing needs the clue`);
  if (room.phase === 'reveal') {
    assert.ok(room.result && room.result.target === room.target, `${label}: a result with the target`);
    assert.ok(room.result.entries.length >= room.guesses.length, `${label}: the result keeps everyone who guessed (some may have left since)`);
  }
  assert.doesNotThrow(() => JSON.stringify(room), `${label}: the room can be saved`);
  assert.deepEqual(game.migrate(JSON.parse(JSON.stringify(room))), room, `${label}: a saved room loads as it was`);
}

function checkViews(room, label, strangers = [99]) {
  const psychicNow = ['clue', 'guessing'].includes(room.phase) ? room.psychic : null;
  for (const id of [...room.players.map((p) => p.id), ...strangers]) {
    const view = game.viewFor(room, id);
    const text = JSON.stringify(view);
    assert.doesNotThrow(() => JSON.parse(text), `${label}: a view is plain JSON`);
    if (psychicNow !== null && id !== psychicNow) {
      assert.equal(view.target, null, `${label}: ${id} must not see the target`);
      assert.ok(!text.includes(`"target":${room.target}`), `${label}: the target is nowhere in ${id}'s view`);
    }
    if (psychicNow !== null && id === psychicNow) assert.equal(view.marker, null, `${label}: the psychic does not see the marker`);
    if (['clue', 'guessing'].includes(room.phase)) {
      assert.ok(view.guesses.every((g) => g.id === id), `${label}: ${id} sees only their own guess so far`);
      assert.equal(view.result, null);
    }
    if (room.phase === 'guessing' && room.mode === 'solo') assert.equal(view.marker, null);
  }
}

function playRandom(seed) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  const label = (n) => `seed ${seed}, step ${n}`;
  const people = [1, 2, 3, 4];
  for (const id of people.slice(1)) if (rng() < 0.8) game.addPlayer(room, id);
  if (room.players.length < 2) game.addPlayer(room, 2);
  const actions = [
    (id) => game.setMode(room, id, pick(rng, ['solo', 'team', 'chaos', null])),
    (id) => game.setTurnsEach(room, id, pick(rng, [1, 2, 3, 0, 9, '2'])),
    (id) => game.setColour(room, id, pick(rng, [...game.COLOURS, '#123456', 'red', null]), rng() < 0.5),
    (id) => game.addBot(room, id),
    (id) => game.fillBots(room, id, pick(rng, [2, 4, 8, 99, 'x'])),
    (id) => game.removeBot(room, id, pick(rng, ['bot:1', 'bot:2', id])),
    (id) => game.start(room, id, rng),
    (id) => game.setClue(room, id, pick(rng, TEXTS)),
    (id) => game.guess(room, id, pick(rng, POSITIONS)),
    (id) => game.setMarker(room, id, pick(rng, POSITIONS)),
    (id) => game.lockIn(room, id),
    (id) => game.ready(room, id, rng),
    (id) => game.removePlayer(room, id, rng),
    (id) => game.addPlayer(room, id),
    () => game.pendingBotAction(room) && game.runBotAction(room, rng),
    () => room.phase === 'reveal' && rng() < 0.2 && game.forceNext(room, rng),
  ];
  let started = false;
  for (let n = 0; n < 400 && room.phase !== 'finished' && room.phase !== 'abandoned'; n++) {
    // Mostly sensible: after the start, bias towards the action that moves the game on.
    const id = pick(rng, [...people, 99]);
    let action = pick(rng, actions);
    if (room.phase === 'lobby' && rng() < 0.35) action = actions[6];
    if (room.phase === 'clue' && rng() < 0.5) action = (who) => game.setClue(room, who === 99 ? room.psychic : who, pick(rng, TEXTS));
    if (room.phase === 'guessing' && rng() < 0.5) action = room.mode === 'team' ? (rng() < 0.6 ? actions[9] : actions[10]) : actions[8];
    if (room.phase === 'reveal' && rng() < 0.5) action = actions[11];
    const before = JSON.stringify(room);
    const result = action(id);
    if (result && result.ok === false) assert.equal(JSON.stringify(room), before, `${label(n)}: a refused action changed the room`);
    if (result?.empty) break; // the last person left: the server throws the room away
    if (room.phase !== 'lobby') started = true;
    checkRoom(room, label(n));
    checkViews(room, label(n));
  }
  return { room, started };
}

test('random legal and illegal play keeps every room and view sound, in both modes', () => {
  let started = 0;
  const modes = new Set();
  const phases = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const { room, started: did } = playRandom(seed);
    if (did) started++;
    modes.add(room.mode);
    phases.add(room.phase);
  }
  assert.ok(started > 200, `most random games got going (${started})`);
  assert.deepEqual([...modes].sort(), ['solo', 'team'], 'both modes were played');
  assert.ok(phases.has('finished'), 'and some games were finished');
});

test('whatever the order of play, a finished game has a history that adds up and statistics for the people only', () => {
  let finished = 0;
  for (let seed = 1000; seed < 1400; seed++) {
    const rng = seeded(seed);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
    game.addPlayer(room, 2);
    if (rng() < 0.5) game.addPlayer(room, 3);
    if (rng() < 0.5) game.addBot(room, 1);
    game.setTurnsEach(room, 1, 1 + Math.floor(rng() * 2));
    game.setMode(room, 1, rng() < 0.5 ? 'team' : 'solo');
    game.start(room, 1, rng);
    for (let step = 0; step < 500 && room.phase !== 'finished'; step++) {
      const guessers = room.players.filter((p) => p.id !== room.psychic);
      if (room.phase === 'clue') game.setClue(room, room.psychic, 'x');
      else if (room.phase === 'guessing') {
        if (room.mode === 'team') {
          game.setMarker(room, pick(rng, guessers).id, rng() * 100);
          if (rng() < 0.5) game.lockIn(room, pick(rng, guessers).id);
        } else game.guess(room, pick(rng, guessers).id, rng() * 100);
      } else if (room.phase === 'reveal') game.ready(room, pick(rng, room.players).id, rng);
      if (room.phase === 'reveal' && rng() < 0.3) game.forceNext(room, rng);
    }
    assert.equal(room.phase, 'finished', `seed ${seed} finishes`);
    finished++;
    for (const p of room.players) assert.equal(room.history.reduce((n, r) => n + (r.deltas[p.id] ?? 0), 0), p.score, `seed ${seed}: the history adds up for ${p.id}`);
    const stats = game.statsPlayers(room);
    assert.deepEqual(stats.map((s) => s.userId).sort(), room.players.filter((p) => !p.bot).map((p) => p.id).sort(), 'only people are recorded');
    for (const s of stats) {
      assert.ok(['win', 'loss'].includes(s.outcome));
      assert.ok(Number.isInteger(s.extras.bullseyes) && Number.isInteger(s.extras.cluesGiven));
    }
    if (room.mode === 'team') assert.equal(new Set(room.players.map((p) => p.score)).size, 1, `seed ${seed}: a team shares one score`);
  }
  assert.equal(finished, 400);
});
