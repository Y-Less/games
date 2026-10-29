// The rules of Just One, without sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { WORDS, normal, relatedTo } from './words.js';
import { AIS } from './ai/index.js';
import { seeded } from '../../shared/testkit.js';

/** A started room of the given user ids; the first player is the first guesser when the seed says so (see `guesserOf`). */
function started(ids = [1, 2, 3, 4], { turnsEach = 1, seed = 4 } = {}) {
  const room = game.createRoom({ code: 'boss-aware-you', hostId: ids[0] });
  for (const id of ids.slice(1)) assert.ok(game.addPlayer(room, id).ok);
  assert.ok(game.setTurnsEach(room, ids[0], turnsEach).ok);
  assert.ok(game.start(room, ids[0], seeded(seed)).ok);
  return room;
}
const writersOf = (room) => room.players.filter((p) => p.id !== room.guesser).map((p) => p.id);
const score = (room, id) => room.players.find((p) => p.id === id).score;
const closeReveal = (room) => room.players.forEach((p) => game.ready(room, p.id));
/** Everybody but the guesser sends a clue: the given words in turn. */
function writeClues(room, words, rng = seeded(1)) {
  writersOf(room).forEach((id, i) => assert.ok(game.submitClue(room, id, words[i], rng).ok, `${words[i]}`));
}

test('words: every word has plenty of usual clues, none of them the word itself, and the matching ignores case and plurals', () => {
  assert.equal(new Set(WORDS.map((w) => w.word)).size, WORDS.length, 'no word twice');
  assert.ok(WORDS.length >= 100);
  for (const { word, related } of WORDS) {
    assert.ok(related.length >= 6, word);
    assert.equal(new Set(related.map(normal)).size, related.length, `${word}: no usual clue twice`);
    for (const r of related) assert.equal(game.clueProblem(r, word), null, `${word}: usual clue ${r} is allowed`);
  }
  assert.equal(normal('Apples'), normal('apple'));
  assert.equal(normal(' Ice  Cream! '), normal('icecream'));
  assert.notEqual(normal('bus'), normal('bu'));
  assert.deepEqual(relatedTo('nonsense'), []);
});

test('a clue is one word, and not the secret word or part of it', () => {
  for (const bad of ['two words', '', ' ', 'a!b', 'x y', '-x']) assert.ok(game.clueProblem(bad, 'apple'), JSON.stringify(bad));
  for (const bad of ['apple', 'Apples', 'APPLE', 'pineapple', 'app']) assert.ok(game.clueProblem(bad, 'apple'), bad);
  assert.ok(game.clueProblem('ice', 'ice cream'), 'part of a two-word secret');
  for (const good of ['fruit', "o'clock", 'well-known', 'tree', 'ap']) assert.equal(game.clueProblem(good, 'apple'), null, good);
});

test('a lobby: players, settings and computer players', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  assert.ok(game.addPlayer(room, 2).ok);
  assert.ok(game.addPlayer(room, 2).ok, 'joining twice is harmless');
  assert.equal(game.setTurnsEach(room, 2, 3).ok, false, 'only the host');
  assert.equal(game.setTurnsEach(room, 1, 9).ok, false);
  assert.ok(game.setTurnsEach(room, 1, 3).ok);
  assert.equal(game.start(room, 1).ok, false, 'three players are needed');
  assert.equal(game.addBot(room, 2).ok, false, 'only the host adds computers');
  assert.ok(game.fillBots(room, 1, 5).ok);
  assert.equal(room.players.length, 5);
  assert.ok(room.players.slice(2).every((p) => p.bot && p.id.startsWith('bot:')));
  while (room.players.length < game.MAX_PLAYERS) assert.ok(game.addBot(room, 1).ok);
  assert.equal(game.addBot(room, 1).ok, false, 'the table is full');
  assert.equal(game.addPlayer(room, 99).ok, false, 'full');
  assert.equal(game.start(room, 2).ok, false, 'only the host starts');
  assert.ok(game.start(room, 1, seeded(1)).ok);
  assert.equal(room.turnsTotal, 21);
  assert.ok(room.players.filter((p) => p.bot).every((p) => AIS.some((ai) => ai.id === p.ai)), 'every bot has an AI');
  assert.equal(game.addPlayer(room, 100).ok, false, 'too late to join');
});

test('a turn: clues, the guess, the best hint, the reveal and ready', () => {
  const room = started();
  const guesser = room.guesser;
  const [a, b, c] = writersOf(room);
  const word = room.word;
  assert.equal(room.phase, 'clues');
  assert.equal(game.submitClue(room, guesser, 'hello').ok, false, 'the guesser does not write one');
  assert.equal(game.submitClue(room, 99, 'hello').ok, false);
  assert.equal(game.submitClue(room, a, word).ok, false, 'not the word itself');
  assert.equal(game.submitClue(room, a, 'two words').ok, false);
  assert.equal(game.submitClue(room, a, 'x'.repeat(40)).ok, false);
  assert.ok(game.submitClue(room, a, 'alpha').ok);
  assert.equal(game.submitClue(room, a, 'beta').ok, false, 'one clue each');
  assert.equal(game.guess(room, guesser, word).ok, false, 'no guessing before the clues are in');
  assert.ok(game.submitClue(room, b, 'Alphas').ok, 'a plural of the same clue');
  assert.equal(room.phase, 'clues');
  assert.ok(game.submitClue(room, c, 'gamma').ok);
  assert.equal(room.phase, 'guessing', 'the last clue opens the guessing');
  assert.deepEqual([...room.cancelled].sort(), [a, b].sort(), 'matching clues are both cancelled');
  assert.deepEqual(room.order, [c], 'one clue is left');

  assert.equal(game.guess(room, a, word).ok, false, 'only the guesser guesses');
  assert.equal(game.guess(room, guesser, '   ').ok, false);
  assert.ok(game.guess(room, guesser, `  ${word.toUpperCase()} `).ok, 'case and spacing do not matter');
  assert.equal(room.phase, 'choosing');
  assert.equal(room.guess.correct, true);
  assert.equal(game.chooseBest(room, a, 0).ok, false, 'only the guesser picks');
  for (const bad of [-1, 1, 1.5, '0', null, undefined]) assert.equal(game.chooseBest(room, guesser, bad).ok, false, String(bad));
  assert.ok(game.chooseBest(room, guesser, 0).ok);
  assert.equal(room.phase, 'reveal');
  assert.equal(room.best, c);
  assert.equal(score(room, guesser), 2);
  assert.equal(score(room, c), 1);
  for (const id of [a, b]) assert.equal(score(room, id), 0, 'nobody else scores');
  assert.equal(room.result.correct, true);
  assert.deepEqual(room.result.clues.map((x) => [x.id, x.cancelled, x.best]), [[a, true, false], [b, true, false], [c, false, true]]);
  assert.deepEqual(room.history[0].deltas, { [guesser]: 2, [c]: 1 });
  assert.equal(game.chooseBest(room, guesser, 0).ok, false, 'once');

  assert.ok(game.ready(room, 1).ok);
  assert.equal(game.ready(room, 99).ok, false);
  assert.equal(room.phase, 'reveal', 'waits for the others');
  for (const id of [2, 3, 4]) game.ready(room, id);
  assert.equal(room.phase, 'clues', 'the next turn');
  assert.equal(room.turn, 1);
  assert.notEqual(room.guesser, guesser);
  assert.deepEqual(room.clues, []);
  assert.notEqual(room.word, word);
});

test('a wrong guess or a pass scores nobody, and there is no best hint to pick', () => {
  for (const how of ['wrong', 'pass']) {
    const room = started();
    writeClues(room, ['red', 'tasty', 'round']);
    const guesser = room.guesser;
    assert.ok((how === 'wrong' ? game.guess(room, guesser, 'definitely not it') : game.pass(room, guesser)).ok);
    assert.equal(room.phase, 'reveal', how);
    assert.equal(room.best, null);
    for (const p of room.players) assert.equal(p.score, 0, how);
    assert.equal(room.result.correct, false);
    assert.equal(room.history[0].notes[guesser], how === 'wrong' ? 'missed' : 'passed');
    assert.equal(game.pass(room, guesser).ok, false, 'already over');
  }
});

test('a right guess when every clue was cancelled scores the guesser only', () => {
  const room = started();
  writeClues(room, ['same', 'Same', 'SAMES']);
  assert.deepEqual(room.order, []);
  assert.equal(room.cancelled.length, 3);
  assert.ok(game.guess(room, room.guesser, room.word).ok);
  assert.equal(room.phase, 'reveal', 'no best hint to pick');
  assert.equal(score(room, room.guesser), 2);
  assert.equal(room.players.reduce((n, p) => n + p.score, 0), 2);
});

test('the guesser sees neither the word nor the cancelled clues nor who wrote what; the others see everything but the writing in progress', () => {
  const room = started();
  const guesser = room.guesser;
  const [a, b, c] = writersOf(room);
  const view = (id) => game.viewFor(room, id);
  assert.equal(view(guesser).word, null);
  assert.equal(view(a).word, room.word);
  assert.equal(game.viewFor(room, 99).word, null, 'a stranger sees nothing');
  game.submitClue(room, a, 'alpha');
  assert.deepEqual(view(a).clues.map((x) => x.text), ['alpha'], 'you see your own clue');
  assert.deepEqual(view(b).clues, [], 'not anyone else\'s');
  assert.deepEqual(view(guesser).clues, []);
  assert.equal(view(b).players.find((p) => p.id === a).written, true, 'but they see who has written');
  assert.equal(view(a).players.find((p) => p.id === b).written, false);
  assert.ok(!JSON.stringify(view(b)).includes('alpha'));
  game.submitClue(room, b, 'alpha');
  game.submitClue(room, c, 'gamma');
  const g = view(guesser);
  assert.deepEqual(g.clues, [{ n: 0, text: 'gamma' }], 'the guesser sees only what is left, with no writer');
  assert.ok(!JSON.stringify(g).includes('alpha'));
  assert.equal(g.word, null);
  const others = view(a).clues;
  assert.deepEqual(others.map((x) => [x.name, x.text, x.cancelled]), [[String(c), 'gamma', false], [String(a), 'alpha', true], [String(b), 'alpha', true]]);
  assert.equal(view(a).word, room.word);
  game.guess(room, guesser, room.word);
  assert.equal(view(guesser).word, null, 'still hidden while picking');
  assert.equal(view(a).guess.text.toLowerCase(), room.word);
  game.chooseBest(room, guesser, 0);
  assert.equal(view(guesser).word, room.word, 'revealed to all');
  assert.equal(view(guesser).clues.length, 3);
  assert.equal(view(guesser).scoreboard.players.filter((p) => p.current).length, 1, 'the guesser is the current player');
});

test('everyone is the guesser turnsEach times, words do not repeat, and the game finishes with its history', () => {
  const room = started([1, 2, 3], { turnsEach: 2 });
  const guessers = [];
  const words = [];
  while (room.phase !== 'finished') {
    guessers.push(room.guesser);
    words.push(room.word);
    writeClues(room, ['one', 'two']);
    if (guessers.length % 2) {
      game.guess(room, room.guesser, room.word);
      if (room.phase === 'choosing') game.chooseBest(room, room.guesser, 0);
    } else game.pass(room, room.guesser);
    closeReveal(room);
  }
  assert.equal(guessers.length, 6);
  for (const id of [1, 2, 3]) assert.equal(guessers.filter((x) => x === id).length, 2);
  assert.equal(new Set(words).size, 6);
  assert.equal(room.history.length, 6);
  for (const p of room.players) assert.equal(room.history.reduce((n, r) => n + (r.deltas[p.id] ?? 0), 0), p.score, 'the history adds up');
  const stats = game.statsPlayers(room);
  assert.deepEqual(stats.map((s) => s.userId).sort(), [1, 2, 3]);
  assert.ok(stats.some((s) => s.outcome === 'win'));
});

test('leaving: a writer, the guesser, and too few players', () => {
  const room = started([1, 2, 3, 4]);
  const [a, b, c] = writersOf(room);
  game.submitClue(room, a, 'alpha');
  game.submitClue(room, b, 'beta');
  assert.ok(game.removePlayer(room, c).ok);
  assert.equal(room.phase, 'guessing', 'the clues are in once the missing writer has gone');
  assert.deepEqual([...room.order].sort(), [a, b].sort());

  const choosing = started([1, 2, 3, 4]);
  writeClues(choosing, ['red', 'tasty', 'tasty']); // one clue is left
  game.guess(choosing, choosing.guesser, choosing.word);
  assert.equal(choosing.phase, 'choosing');
  assert.equal(choosing.order.length, 1);
  for (const id of [...choosing.order]) game.removePlayer(choosing, id); // the writer of the only hint left goes
  assert.equal(choosing.phase, 'reveal', 'with no hint left to pick the turn is scored');
  assert.equal(score(choosing, choosing.guesser), 2);

  const second = started([1, 2, 3, 4]);
  const gone = second.guesser;
  game.removePlayer(second, gone);
  assert.equal(second.phase, 'clues', 'the turn is skipped and the next one starts');
  assert.notEqual(second.guesser, gone);
  assert.equal(second.history.length, 0, 'a skipped turn scores nothing');

  const pair = started([1, 2, 3]);
  game.removePlayer(pair, 2);
  assert.equal(pair.phase, 'clues', 'two players can still play');
  game.removePlayer(pair, 3);
  assert.equal(pair.phase, 'abandoned');
  assert.equal(game.removePlayer(game.createRoom({ code: 'a-b-c', hostId: 1 }), 1).empty, true);
  const host = started([1, 2, 3]);
  game.removePlayer(host, 1);
  assert.equal(host.hostId, 2, 'the host passes on');
});

test('a saved room comes back as it was', () => {
  const room = started();
  writeClues(room, ['red', 'tasty', 'red']);
  const copy = game.migrate(JSON.parse(JSON.stringify(room)));
  assert.deepEqual(copy, room);
  delete copy.cancelled;
  delete copy.order;
  assert.deepEqual(game.migrate(copy).order, [], 'rooms saved without them still load');
});

// ---------- computer players ----------

function botGame(seed, { turnsEach = 2, count = 4 } = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1 });
  game.fillBots(room, 1, count);
  room.players[0].bot = true; // every seat is a computer, so the whole game plays itself
  room.players[0].name = 'Host';
  room.turnsEach = turnsEach;
  assert.ok(game.start(room, 1, rng).ok);
  let moves = 0;
  while (room.phase !== 'finished') {
    if (room.phase === 'reveal') game.forceNext(room, rng);
    else assert.ok(game.runBotAction(room, rng), `a move is pending in ${room.phase}`);
    assert.ok(++moves < 2000, 'the game ends');
  }
  return room;
}

test('computer players play whole games legally, over many seeds, and the people-free game scores something', () => {
  let guessed = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const room = botGame(seed);
    assert.equal(room.history.length, room.turnsTotal);
    for (const p of room.players) assert.ok(Number.isInteger(p.score) && p.score >= 0);
    guessed += room.players.reduce((n, p) => n + p.correctGuesses, 0);
  }
  assert.ok(guessed > 30, `some words were guessed (${guessed})`);
});

test('a computer guesser never sees the word, and a broken AI cannot stop the game', () => {
  const room = started([1, 2, 3, 4]);
  for (const p of room.players) {
    p.bot = true;
    p.name = `B${p.id}`;
    p.ai = 'standard';
  }
  const seen = [];
  const original = AIS[0].guess;
  AIS[0].guess = (ctx) => {
    seen.push(JSON.stringify(ctx.clues));
    throw new Error('boom');
  };
  try {
    while (room.phase === 'clues') assert.ok(game.runBotAction(room, seeded(2)));
    assert.equal(room.phase, 'guessing');
    assert.ok(game.runBotAction(room, seeded(2)), 'a broken guesser passes');
  } finally {
    AIS[0].guess = original;
  }
  assert.equal(room.phase, 'reveal');
  assert.equal(room.guess.passed, true);
  assert.ok(seen.every((c) => !c.includes(room.word) || c.length < 2000));
});
