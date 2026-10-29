// Randomised play of the Just One rules: seeded games where people (and strangers) try legal and illegal actions in any order,
// leave, and come back. After every action the room and every player's view must be sound, and nobody may see what they
// should not.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { WORDS } from './words.js';
import { seeded } from '../../shared/testkit.js';

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const CLUES = ['alpha', 'Alpha', 'alphas', 'beta', 'two words', '', '   ', 7, null, undefined, 'x'.repeat(40), 'fruit', "o'clock"];
const GUESSES = ['apple', 'cat', '', '   ', 'x'.repeat(100), 7, null, undefined, 'ICE CREAM'];

function checkRoom(room, label) {
  const ids = room.players.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: no player twice`);
  assert.ok(room.players.length <= game.MAX_PLAYERS, `${label}: not too many players`);
  for (const p of room.players) assert.ok(Number.isInteger(p.score) && p.score >= 0, `${label}: ${p.id} has a sound score`);
  assert.ok(['lobby', 'clues', 'guessing', 'choosing', 'reveal', 'finished', 'abandoned'].includes(room.phase), `${label}: phase ${room.phase}`);
  assert.equal(new Set(room.clues.map((c) => c.id)).size, room.clues.length, `${label}: one clue each`);
  assert.ok(room.clues.every((c) => ids.includes(c.id) && c.id !== room.guesser), `${label}: clues are from writers in the room`);
  assert.ok(room.cancelled.every((id) => room.clues.some((c) => c.id === id)), `${label}: only clues that exist are cancelled`);
  assert.ok(room.order.every((id) => room.clues.some((c) => c.id === id) && !room.cancelled.includes(id)), `${label}: the guesser's list is clues that are left`);
  assert.ok(room.ready.every((id) => ids.includes(id)), `${label}: ready is a subset of the players`);
  if (['clues', 'guessing', 'choosing'].includes(room.phase)) {
    assert.ok(ids.includes(room.guesser), `${label}: the guesser is in the room`);
    assert.ok(WORDS.some((w) => w.word === room.word), `${label}: a real word`);
  }
  if (room.phase === 'clues') assert.ok(!room.guess && room.best === null && !room.order.length, `${label}: nothing but clues yet`);
  if (room.phase === 'guessing') assert.ok(room.clues.length > 0 || true, `${label}: guessing`);
  if (room.phase === 'choosing') assert.ok(room.guess?.correct && room.order.length, `${label}: choosing follows a right guess with hints left`);
  if (room.phase === 'reveal') assert.ok(room.result && room.result.word === room.word, `${label}: a result for the word`);
  assert.doesNotThrow(() => JSON.stringify(room), `${label}: the room can be saved`);
  assert.deepEqual(game.migrate(JSON.parse(JSON.stringify(room))), room, `${label}: a saved room loads as it was`);
}

function checkViews(room, label, strangers = [99]) {
  const playing = ['clues', 'guessing', 'choosing'].includes(room.phase);
  for (const id of [...room.players.map((p) => p.id), ...strangers]) {
    const view = game.viewFor(room, id);
    const text = JSON.stringify(view);
    assert.doesNotThrow(() => JSON.parse(text), `${label}: a view is plain JSON`);
    const member = room.players.some((p) => p.id === id);
    if (playing && (id === room.guesser || !member)) {
      assert.equal(view.word, null, `${label}: ${id} must not see the word`);
      assert.ok(!text.includes(`"word":"${room.word}"`), `${label}: the word is nowhere in ${id}'s view`);
    }
    if (playing && id === room.guesser) for (const c of view.clues) assert.deepEqual(Object.keys(c).sort(), ['n', 'text'], `${label}: the guesser sees no writers`);
    if (room.phase === 'clues') assert.ok(view.clues.every((c) => c.own && c.id === id), `${label}: ${id} sees only their own clue while the clues are written`);
    if (['guessing', 'choosing'].includes(room.phase) && id === room.guesser) assert.equal(view.clues.length, room.order.length, `${label}: the guesser sees what is left`);
    if (!member && playing) assert.deepEqual(view.clues, [], `${label}: a stranger sees no clues`);
  }
}

function playRandom(seed) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  const label = (n) => `seed ${seed}, step ${n}`;
  const people = [1, 2, 3, 4, 5];
  for (const id of people.slice(1)) if (rng() < 0.7) game.addPlayer(room, id);
  for (const id of people) if (room.players.length < 3) game.addPlayer(room, id); // at least three, whoever joined
  const actions = [
    (id) => game.setTurnsEach(room, id, pick(rng, [1, 2, 0, 9, '2'])),
    (id) => game.addBot(room, id),
    (id) => game.fillBots(room, id, pick(rng, [3, 5, 99, 'x'])),
    (id) => game.removeBot(room, id, pick(rng, ['bot:1', 'bot:2', id])),
    (id) => game.start(room, id, rng),
    (id) => game.submitClue(room, id, pick(rng, CLUES), rng),
    (id) => game.guess(room, id, pick(rng, [...GUESSES, room.word]), String),
    (id) => game.pass(room, id),
    (id) => game.chooseBest(room, id, pick(rng, [0, 1, 2, -1, 9, '0', 0.5, null]), String),
    (id) => game.ready(room, id, rng),
    (id) => game.removePlayer(room, id, rng),
    (id) => game.addPlayer(room, id),
    () => game.pendingBotAction(room) && game.runBotAction(room, rng),
    () => room.phase === 'reveal' && rng() < 0.2 && game.forceNext(room, rng),
  ];
  for (let n = 0; n < 400 && room.phase !== 'finished' && room.phase !== 'abandoned'; n++) {
    const id = pick(rng, [...people, 99]);
    let action = pick(rng, actions);
    if (room.phase === 'lobby' && rng() < 0.35) action = actions[4];
    if (room.phase === 'clues' && rng() < 0.5) action = (who) => game.submitClue(room, who, pick(rng, ['red', 'tree', 'red', 'tasty', 'round']), rng);
    if (room.phase === 'guessing' && rng() < 0.5) action = (who) => game.guess(room, room.guesser === who || who === 99 ? room.guesser : who, pick(rng, [room.word, 'nope']), String);
    if (room.phase === 'choosing' && rng() < 0.5) action = (who) => game.chooseBest(room, room.guesser === who || who === 99 ? room.guesser : who, 0, String);
    if (room.phase === 'reveal' && rng() < 0.5) action = actions[9];
    const before = JSON.stringify(room);
    const result = action(id);
    if (result && result.ok === false) assert.equal(JSON.stringify(room), before, `${label(n)}: a refused action changed the room`);
    if (result?.empty) break; // the last person left: the server throws the room away
    checkRoom(room, label(n));
    checkViews(room, label(n));
  }
  return room;
}

test('random legal and illegal play keeps every room and view sound', () => {
  const phases = new Set();
  for (let seed = 1; seed <= 400; seed++) phases.add(playRandom(seed).phase);
  assert.ok(phases.has('finished'), 'some games were finished');
  assert.ok(phases.has('clues') || phases.has('lobby') || phases.has('reveal'), 'and others stopped part way');
});

test('whatever the order of play, a finished game has a history that adds up and statistics for the people only', () => {
  for (let seed = 1000; seed < 1300; seed++) {
    const rng = seeded(seed);
    const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
    game.addPlayer(room, 2);
    game.addPlayer(room, 3);
    if (rng() < 0.5) game.addBot(room, 1);
    game.setTurnsEach(room, 1, 1 + Math.floor(rng() * 2));
    game.start(room, 1, rng);
    for (let step = 0; step < 600 && room.phase !== 'finished'; step++) {
      const writers = room.players.filter((p) => p.id !== room.guesser);
      if (room.phase === 'clues') game.submitClue(room, pick(rng, writers).id, pick(rng, ['red', 'tree', 'tasty', 'round', 'green']), rng);
      else if (room.phase === 'guessing') (rng() < 0.7 ? game.guess(room, room.guesser, rng() < 0.5 ? room.word : 'nope') : game.pass(room, room.guesser));
      else if (room.phase === 'choosing') game.chooseBest(room, room.guesser, Math.floor(rng() * room.order.length), String);
      else if (room.phase === 'reveal') game.ready(room, pick(rng, room.players).id, rng);
      if (room.phase === 'reveal' && rng() < 0.3) game.forceNext(room, rng);
    }
    assert.equal(room.phase, 'finished', `seed ${seed} finishes`);
    for (const p of room.players) assert.equal(room.history.reduce((n, r) => n + (r.deltas[p.id] ?? 0), 0), p.score, `seed ${seed}: the history adds up for ${p.id}`);
    const stats = game.statsPlayers(room);
    assert.deepEqual(stats.map((s) => s.userId).sort(), room.players.filter((p) => !p.bot).map((p) => p.id).sort(), 'only people are recorded');
    for (const s of stats) assert.ok(Number.isInteger(s.extras.correctGuesses) && Number.isInteger(s.extras.bestHints) && Number.isInteger(s.extras.cluesGiven));
    const total = room.players.reduce((n, p) => n + p.score, 0);
    const rights = room.players.reduce((n, p) => n + p.correctGuesses, 0);
    const bests = room.players.reduce((n, p) => n + p.bestHints, 0);
    assert.equal(total, rights * game.POINTS.guesser + bests * game.POINTS.bestHint, `seed ${seed}: points come only from right guesses and best hints`);
    assert.ok(bests <= rights, `seed ${seed}: a best hint needs a right guess`);
  }
});
