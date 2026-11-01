// The rules of Just One, without sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { WORDS, normal, relatedTo } from './words.js';
import { AIS } from './ai/index.js';
import { seeded } from '../../shared/testkit.js';

/** A started room of the given user ids; the first player is the first guesser when the seed says so (see `guesserOf`). */
function started(ids = [1, 2, 3, 4], { turnsEach = 1, seed = 4 } = {}) {
  const room = game.createRoom({ now: 0, code: 'boss-aware-you', hostId: ids[0] });
  for (const id of ids.slice(1)) assert.ok(game.addHuman(room, id).ok);
  assert.ok(game.setTurnsEach(room, ids[0], turnsEach).ok);
  assert.ok(game.start(room, ids[0], seeded(seed)).ok);
  return room;
}
const writersOf = (room) => room.players.filter((p) => p.id !== room.guesser).map((p) => p.id);
const score = (room, id) => room.players.find((p) => p.id === id).score;
const closeReveal = (room, rng = seeded(9)) => room.players.forEach((p) => game.ready(room, p.id, rng)); // seeded: the next word must not depend on luck
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
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1 });
  assert.ok(game.addHuman(room, 2).ok);
  assert.ok(game.addHuman(room, 2).ok, 'joining twice is harmless');
  assert.equal(game.setTurnsEach(room, 2, 3).ok, false, 'only the host');
  assert.equal(game.setTurnsEach(room, 1, 9).ok, false);
  assert.ok(game.setTurnsEach(room, 1, 3).ok);
  assert.equal(game.start(room, 1, Math.random).ok, false, 'three players are needed');
  assert.equal(game.addBot(room, 2).ok, false, 'only the host adds computers');
  assert.ok(game.fillWithBots(room, 1, 5).ok);
  assert.equal(room.players.length, 5);
  assert.ok(room.players.slice(2).every((p) => p.kind === 'bot' && p.id.startsWith('bot:')));
  while (room.players.length < game.MAX_PLAYERS) assert.ok(game.addBot(room, 1).ok);
  assert.equal(game.addBot(room, 1).ok, false, 'the table is full');
  assert.equal(game.addHuman(room, 99).ok, false, 'full');
  assert.equal(game.start(room, 2, Math.random).ok, false, 'only the host starts');
  assert.ok(game.start(room, 1, seeded(1)).ok);
  assert.equal(room.turnsTotal, 21);
  assert.ok(room.players.filter((p) => p.kind === 'bot').every((p) => AIS.some((ai) => ai.id === p.ai)), 'every bot has an AI');
  assert.equal(game.addHuman(room, 100).ok, false, 'too late to join');
});

test('a turn: clues, the guess, the best hint, the reveal and ready', () => {
  const room = started();
  const guesser = room.guesser;
  const [a, b, c] = writersOf(room);
  const word = room.word;
  assert.equal(room.phase, 'clues');
  assert.equal(game.submitClue(room, guesser, 'hello', Math.random).ok, false, 'the guesser does not write one');
  assert.equal(game.submitClue(room, 99, 'hello', Math.random).ok, false);
  assert.equal(game.submitClue(room, a, word, Math.random).ok, false, 'not the word itself');
  assert.equal(game.submitClue(room, a, 'two words', Math.random).ok, false);
  assert.equal(game.submitClue(room, a, 'x'.repeat(40), Math.random).ok, false);
  assert.ok(game.submitClue(room, a, 'alpha', Math.random).ok);
  assert.equal(game.submitClue(room, a, 'beta', Math.random).ok, false, 'one clue each');
  assert.equal(game.guess(room, guesser, word).ok, false, 'no guessing before the clues are in');
  assert.ok(game.submitClue(room, b, 'Alphas', Math.random).ok, 'a plural of the same clue');
  assert.equal(room.phase, 'clues');
  assert.ok(game.submitClue(room, c, 'gamma', Math.random).ok);
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

  assert.ok(game.ready(room, 1, Math.random).ok);
  assert.equal(game.ready(room, 99, Math.random).ok, false);
  assert.equal(room.phase, 'reveal', 'waits for the others');
  for (const id of [2, 3, 4]) game.ready(room, id, Math.random);
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
  game.submitClue(room, a, 'alpha', Math.random);
  assert.deepEqual(view(a).clues.map((x) => x.text), ['alpha'], 'you see your own clue');
  assert.deepEqual(view(b).clues, [], 'not anyone else\'s');
  assert.deepEqual(view(guesser).clues, []);
  assert.equal(view(b).players.find((p) => p.id === a).written, true, 'but they see who has written');
  assert.equal(view(a).players.find((p) => p.id === b).written, false);
  assert.ok(!JSON.stringify(view(b)).includes('alpha'));
  game.submitClue(room, b, 'alpha', Math.random);
  game.submitClue(room, c, 'gamma', Math.random);
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
  assert.deepEqual(view(guesser).scoreboard.players.filter((p) => p.current), [], 'at the reveal nobody is to act');
});

test('the scoreboard marks whoever the game is waiting for: the writers still to write, then the guesser', () => {
  const room = started();
  const guesser = room.guesser;
  const [a, b, c] = writersOf(room);
  const current = () => game.viewFor(room, guesser).scoreboard.players.filter((p) => p.current).map((p) => p.id).sort();
  assert.deepEqual(current(), [a, b, c].sort(), 'every writer, to begin with');
  game.submitClue(room, a, 'alpha', Math.random);
  assert.deepEqual(current(), [b, c].sort(), 'one fewer once a clue is in');
  game.submitClue(room, b, 'beta', Math.random);
  game.submitClue(room, c, 'gamma', Math.random);
  assert.deepEqual(current(), [guesser], 'then the guesser');
  game.guess(room, guesser, room.word);
  assert.deepEqual(current(), [guesser], 'who also picks the best hint');
});

test('everyone is the guesser turnsEach times, words do not repeat, and the game finishes with its history', () => {
  const room = started([1, 2, 3], { turnsEach: 2 });
  const guessers = [];
  const words = [];
  while (room.phase !== 'finished') {
    guessers.push(room.guesser);
    words.push(room.word);
    writeClues(room, ['qzx', 'xzq']); // nonsense clues that no secret word can contain
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

test('leaving: a computer player takes the place of a writer, of the guesser, and of the host; the last person out empties the room', () => {
  const room = started([1, 2, 3, 4]);
  const [a, b, c] = writersOf(room);
  game.submitClue(room, a, 'alpha', Math.random);
  game.submitClue(room, b, 'beta', Math.random);
  const slot = room.players.findIndex((p) => p.id === c);
  assert.deepEqual(game.removeHuman(room, c, seeded(1)), { ok: true, empty: false, replaced: true });
  const bot = room.players[slot];
  assert.equal(bot.kind, 'bot');
  assert.ok(bot.ai, 'it was given an AI');
  assert.equal(room.players.length, 4, 'nobody is lost');
  assert.equal(room.phase, 'clues', 'the clues are still not all in: the computer has to write one');
  assert.deepEqual(game.pendingBotAction(room), { type: 'clue', id: bot.id });
  assert.ok(game.runBotAction(room, seeded(2)));
  assert.equal(room.phase, 'guessing');
  assert.ok(room.order.includes(bot.id) || room.cancelled.includes(bot.id), 'its clue counts like anybody else\'s');

  const choosing = started([1, 2, 3, 4]);
  writeClues(choosing, ['red', 'tasty', 'tasty']); // one clue is left
  game.guess(choosing, choosing.guesser, choosing.word);
  assert.equal(choosing.phase, 'choosing');
  const [writer] = choosing.order;
  game.removeHuman(choosing, writer, seeded(1)); // the writer of the only hint left goes
  assert.equal(choosing.phase, 'choosing', 'the hint stays, under the computer player\'s name');
  assert.equal(choosing.order.length, 1);
  assert.equal(choosing.players.find((p) => p.id === choosing.order[0]).kind, 'bot');
  game.chooseBest(choosing, choosing.guesser, 0);
  assert.equal(score(choosing, choosing.order[0]), 1, 'and the best-hint point goes to it');

  const second = started([1, 2, 3, 4]);
  const gone = second.guesser;
  game.removeHuman(second, gone, seeded(1));
  assert.equal(second.phase, 'clues', 'the turn goes on');
  assert.equal(second.players.find((p) => p.id === second.guesser).kind, 'bot', 'with the computer player as guesser');
  assert.equal(second.turnsTotal, 4, 'and no turn is lost');

  const pair = started([1, 2, 3]);
  game.removeHuman(pair, 2, seeded(1));
  game.removeHuman(pair, 3, seeded(1));
  assert.equal(pair.phase, 'clues', 'one person and two computers play on');
  assert.equal(game.removeHuman(pair, 1, seeded(1)).empty, true, 'the last person leaving empties the room');
  assert.equal(game.removeHuman(game.createRoom({ now: 0, code: 'a-b-c', hostId: 1 }), 1, Math.random).empty, true);
  const host = started([1, 2, 3]);
  game.removeHuman(host, 1, seeded(1));
  assert.equal(host.hostId, 2, 'the host passes on');
});

test('a computer player taking over at the reveal does not hold the others up, and the history still adds up', () => {
  const room = started([1, 2, 3, 4]);
  writeClues(room, ['red', 'tasty', 'wet']);
  game.guess(room, room.guesser, room.word);
  game.chooseBest(room, room.guesser, 0);
  assert.equal(room.phase, 'reveal');
  const best = room.best;
  for (const p of room.players) if (p.id !== best) game.ready(room, p.id, seeded(1));
  assert.equal(room.phase, 'reveal', 'still waiting for the best writer');
  game.removeHuman(room, best, seeded(1));
  assert.equal(room.turn, 1, 'a computer player is always ready, so the turn ended');
  assert.equal(room.phase, 'clues', 'and the next one began');
  const bot = room.players.find((p) => p.kind === 'bot');
  assert.equal(bot.score, 1, 'the point stays with the seat');
  assert.equal(room.history[0].deltas[bot.id], 1, 'and the history names the seat by its new id');
  assert.equal(room.history[0].deltas[best], undefined);
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
  const room = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1 });
  game.fillWithBots(room, 1, count);
  room.players[0].kind = 'bot'; // every seat is a computer, so the whole game plays itself
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
    p.kind = 'bot';
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

test('kick refuses a finished game and removes nobody', () => {
  const room = (() => {
    const r = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann' });
    game.addHuman(r, 2, 'Bob');
    game.addBot(r, 1);
    game.start(r, 1, seeded(3));
    return r;
  })();
  room.phase = 'finished';
  const before = JSON.stringify(room);
  assert.deepEqual(game.kick(room, 1, 2, Math.random), { ok: false, error: 'The game is over: there is nobody to remove.' });
  assert.equal(JSON.stringify(room), before, 'nothing changed');
});

test('a room saved before players had a kind still loads: bot: true becomes kind: bot, and people are named from their account', () => {
  const room = (() => {
    const r = game.createRoom({ now: 0, code: 'a-b-c', hostId: 1, hostName: 'Ann' });
    game.addHuman(r, 2, 'Bob');
    game.addBot(r, 1);
    game.start(r, 1, seeded(3));
    return r;
  })();
  const bots = room.players.filter((p) => p.kind === 'bot').map((p) => p.id);
  assert.ok(bots.length >= 1);
  // Rewrite the room into the shape it was saved in before: bot: true, and no names for people.
  for (const p of room.players) {
    if (p.kind === 'bot') p.bot = true;
    else delete p.name;
    delete p.kind;
  }
  game.migrate(room, (id) => `Account ${id}`);
  assert.deepEqual(room.players.filter((p) => p.kind === 'bot').map((p) => p.id), bots);
  assert.ok(room.players.every((p) => !('bot' in p)), 'bot: true is gone');
  assert.ok(room.players.filter((p) => p.kind === 'human').every((p) => p.name === `Account ${p.id}`));
  const view = game.viewFor(room, 1);
  assert.deepEqual(view.players.filter((p) => p.bot).map((p) => p.id), bots, 'the view still says which are computer players');
  assert.deepEqual(game.statsPlayers({ ...room, phase: 'finished' }).map((s) => s.userId).sort(), room.players.filter((p) => p.kind === 'human').map((p) => p.id).sort(), 'only people are recorded');
  assert.equal(game.humans(room).length, room.players.length - bots.length);
});

test('a room saved without a ready list (or with none of the newer fields) still takes a ready', () => {
  const room = started([1, 2, 3]);
  writeClues(room, ['red', 'tasty']);
  game.guess(room, room.guesser, room.word);
  game.chooseBest(room, room.guesser, 0);
  assert.equal(room.phase, 'reveal');
  const saved = JSON.parse(JSON.stringify(room));
  delete saved.ready;
  delete saved.used;
  const back = game.migrate(saved);
  assert.deepEqual(back.ready, []);
  assert.equal(game.ready(back, 1, seeded(1)).ok, true);
});
