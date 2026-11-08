// The rules of Draw!, with no sockets: two drawers a round, one guess panel aimed at both of them, the first drawing
// named winning it, and a game that plays every pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded } from '../../shared/random.js';
import * as game from './game.js';

/** A room of the named people (the first is the host, account 1), with the settings a test asks for. */
function room(names, settings = {}) {
  const rng = seeded(5);
  const made = game.createRoom({ code: 'test-draw-game', hostId: 1, hostName: names[0], chooseMs: 5000, betweenMs: 4000, now: 0 });
  names.slice(1).forEach((name, i) => assert.equal(game.addHuman(made, i + 2, name).ok, true));
  if (Object.keys(settings).length) assert.equal(game.setSettings(made, 1, settings).ok, true);
  return { made, rng };
}

/** Starts the game and takes both drawers through choosing, so the room is drawing. */
function drawing(names, settings = {}) {
  const { made, rng } = room(names, settings);
  assert.equal(game.start(made, 1, rng, 0).ok, true);
  for (const drawer of made.drawers) assert.equal(game.chooseWord(made, drawer, 0, 0).ok, true);
  assert.equal(made.phase, 'drawing');
  const guesser = made.players.find((p) => !game.isDrawer(made, p.id));
  return { made, rng, guesser: guesser.id, words: { ...made.words } };
}

test('a game plays every pair of players: four of them draw three times each over six rounds', () => {
  const { made, rng } = room(['Ann', 'Bob', 'Cat', 'Dan']);
  assert.equal(game.roundsInGame(made), 6);
  assert.equal(game.start(made, 1, rng, 0).ok, true);
  assert.equal(made.order.length, 6);
  const drawn = new Map(made.players.map((p) => [p.id, 0]));
  for (const pair of made.order) for (const id of pair) drawn.set(id, drawn.get(id) + 1);
  for (const [, times] of drawn) assert.equal(times, 3);
  assert.equal(made.round, 1);
  assert.equal(made.drawers.length, 2, 'two of them draw at once');
});

test('the host chooses how many times the game runs through every pair', () => {
  const { made } = room(['Ann', 'Bob', 'Cat', 'Dan'], { cycles: 3 });
  assert.equal(made.cycles, 3);
  assert.equal(game.roundsInGame(made), 18);
  const { made: one } = room(['Ann', 'Bob', 'Cat', 'Dan']);
  assert.equal(one.cycles, 1, 'once through by default');
  assert.equal(game.setSettings(one, 1, { cycles: 0 }).error, 'cycles');
  assert.equal(game.setSettings(one, 1, { cycles: 99 }).error, 'cycles');
  assert.equal(game.setSettings(one, 2, { cycles: 2 }).error, 'hostOnly');
  assert.equal(one.cycles, 1, 'a refused setting leaves the room as it was');
});

test('both drawers choose before either draws, so neither gets a head start', () => {
  const { made, rng } = room(['Ann', 'Bob', 'Cat']);
  game.start(made, 1, rng, 0);
  const [first, second] = made.drawers;
  assert.equal(made.phase, 'choosing');
  assert.equal(game.chooseWord(made, first, 0, 0).ok, true);
  assert.equal(made.phase, 'choosing', 'still waiting for the other one');
  assert.equal(game.chooseWord(made, first, 1, 0).error, 'alreadyChosen');
  assert.equal(game.chooseWord(made, second, 0, 0).ok, true);
  assert.equal(made.phase, 'drawing');
  assert.ok(made.words[first] && made.words[second]);
  assert.notEqual(made.words[first], made.words[second], 'and they are not drawing the same word');
});

test('a guesser cannot choose a word, and a drawer cannot choose out of range', () => {
  const { made, rng } = room(['Ann', 'Bob', 'Cat']);
  game.start(made, 1, rng, 0);
  const guesser = made.players.find((p) => !game.isDrawer(made, p.id)).id;
  assert.equal(game.chooseWord(made, guesser, 0, 0).error, 'drawersOnlyChoose');
  assert.equal(game.chooseWord(made, made.drawers[0], 9, 0).error, 'pickAWord');
  assert.equal(game.chooseWord(made, made.drawers[0], -1, 0).error, 'pickAWord');
});

test('five seconds to choose, and the clock picks for whoever has not', () => {
  const { made, rng } = room(['Ann', 'Bob', 'Cat']);
  game.start(made, 1, rng, 0);
  assert.equal(made.deadline, 5000, 'a quick-fire five seconds');
  const [first, second] = made.drawers;
  game.chooseWord(made, first, 0, 0);
  assert.equal(game.timeUp(made, rng, 5000).ok, true);
  assert.equal(made.phase, 'drawing');
  assert.ok(made.words[second], 'the clock chose for the one who dithered');
  assert.equal(made.words[first], made.choices[first]?.[0] ?? made.words[first], 'and left the one who chose alone');
  assert.equal(made.deadline, 5000 + made.drawTime * 1000);
});

test('one guess is tried against both drawings, and naming either wins the round', () => {
  const { made, guesser, words } = drawing(['Ann', 'Bob', 'Cat']);
  const [first, second] = made.drawers;
  assert.equal(game.guess(made, guesser, 'definitely not it', 100).quality, 'wrong');
  assert.equal(made.phase, 'drawing');
  const outcome = game.guess(made, guesser, words[second], 200);
  assert.equal(outcome.quality, 'exact');
  assert.equal(made.phase, 'between');
  assert.equal(made.winner.drawer, second, 'the second drawing was the one named');
  assert.equal(made.winner.guesser, guesser);
  assert.equal(made.winner.word, words[second]);
  void first;
});

test('only the drawer whose drawing was named, and the guesser who named it, score', () => {
  const { made, guesser, words } = drawing(['Ann', 'Bob', 'Cat', 'Dan']);
  const named = made.drawers[0];
  const other = made.drawers[1];
  game.guess(made, guesser, words[named], 200);
  assert.equal(made.phase, 'between');
  const scoreOf = (id) => made.players.find((p) => p.id === id).score;
  assert.equal(scoreOf(named), game.POINT);
  assert.equal(scoreOf(guesser), game.POINT);
  assert.equal(scoreOf(other), 0, 'the other drawer gets nothing');
  for (const p of made.players) if (![named, guesser].includes(p.id)) assert.equal(p.score, 0);
  assert.deepEqual(made.history.at(-1).deltas[other], 0);
});

test('the two drawers do not type: one of them naming the other would be a race nobody could win', () => {
  const { made, words } = drawing(['Ann', 'Bob', 'Cat']);
  const [first, second] = made.drawers;
  assert.equal(game.guess(made, first, words[second], 100).error, 'drawersDoNotGuess');
  assert.equal(game.guess(made, second, words[second], 100).error, 'drawersDoNotGuess');
  assert.equal(made.phase, 'drawing', 'and nothing happened');
});

test('a guess close to either word is told to its writer alone', () => {
  const { made, guesser, words } = drawing(['Ann', 'Bob', 'Cat', 'Dan']);
  const other = made.players.find((p) => !game.isDrawer(made, p.id) && p.id !== guesser).id;
  const near = `${words[made.drawers[0]]}s`;
  const outcome = game.guess(made, guesser, near, 100);
  assert.equal(outcome.quality, 'close');
  const mine = game.viewFor(made, guesser).feed.at(-1);
  const theirs = game.viewFor(made, other).feed.at(-1);
  assert.equal(mine.kind, 'close');
  assert.equal(theirs.kind, 'guess', 'everybody else simply sees a guess');
  assert.equal(theirs.text, near, 'and the word they tried');
});

test('nobody guessing means nobody scores, and the round still ends', () => {
  const { made, rng } = drawing(['Ann', 'Bob', 'Cat']);
  assert.equal(game.timeUp(made, rng, 999999).ok, true);
  assert.equal(made.phase, 'between');
  assert.equal(made.winner, null);
  for (const p of made.players) assert.equal(p.score, 0);
  assert.ok(made.reveal.words[made.drawers[0]], 'both words go up anyway');
  assert.ok(made.reveal.words[made.drawers[1]]);
});

test('the round ends at the first drawing named, however many guessers there are', () => {
  const { made, words } = drawing(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
  const [one, two] = made.players.filter((p) => !game.isDrawer(made, p.id)).map((p) => p.id);
  game.guess(made, one, words[made.drawers[1]], 100);
  assert.equal(made.phase, 'between');
  assert.equal(game.guess(made, two, words[made.drawers[0]], 110).error, 'notGuessing', 'the race is over');
  assert.equal(made.players.find((p) => p.id === two).score, 0);
});

test('a game runs through its rounds and finishes, with no scores to close on the way', () => {
  const made = room(['Ann', 'Bob', 'Cat', 'Dan']);
  const { made: r, rng } = made;
  game.start(r, 1, rng, 0);
  const phases = new Set();
  for (let guard = 0; guard < 100 && r.phase !== 'finished'; guard++) {
    phases.add(r.phase);
    if (r.phase === 'choosing') for (const drawer of r.drawers) game.chooseWord(r, drawer, 0, 0);
    else if (r.phase === 'drawing') game.timeUp(r, rng, 999999);
    else game.nextRound(r, rng, 0);
  }
  assert.equal(r.phase, 'finished');
  assert.equal(r.round, 6);
  assert.equal(r.history.length, 6, 'one scoreboard row a round');
  assert.deepEqual([...phases].sort(), ['between', 'choosing', 'drawing'], 'and no scores phase at all');
});

test('the view: a guesser is told the shape of each word but never a letter of it', () => {
  const { made, guesser, words } = drawing(['Ann', 'Bob', 'Cat']);
  const seen = game.viewFor(made, guesser);
  assert.equal(seen.boards.length, 2, 'both drawings, side by side');
  for (const board of seen.boards) {
    assert.equal(board.word, null, 'never the word');
    assert.equal(board.chosen, true);
    assert.ok(board.shape.length > 0, 'but its shape');
    assert.ok(board.shape.every((ch) => ch === null || [' ', '-', '_', '.', '/'].includes(ch)), 'only the punctuation shows');
  }
  assert.equal(JSON.stringify(seen).includes(words[made.drawers[0]]), false, 'and no word of it anywhere in the view');
});

test('the view: a drawer sees their own word and the other drawing, but not the other word', () => {
  const { made, words } = drawing(['Ann', 'Bob', 'Cat']);
  const [mine, theirs] = made.drawers;
  const seen = game.viewFor(made, mine);
  assert.equal(seen.youDraw, true);
  const own = seen.boards.find((b) => b.drawer === mine);
  const other = seen.boards.find((b) => b.drawer === theirs);
  assert.equal(own.word, words[mine]);
  assert.equal(own.yours, true);
  assert.equal(other.word, null, 'the other drawer is drawing something they must guess at like anybody');
  assert.equal(other.yours, false);
  assert.equal(JSON.stringify(seen).includes(words[theirs]), false);
});

test('the view: once the round is over both words are shown to everybody', () => {
  const { made, guesser, words } = drawing(['Ann', 'Bob', 'Cat']);
  game.guess(made, guesser, words[made.drawers[0]], 100);
  const seen = game.viewFor(made, guesser);
  assert.deepEqual(seen.boards.map((b) => b.word).sort(), Object.values(words).sort());
  assert.equal(seen.reveal.winner.guesser, guesser);
  assert.equal(seen.boards.find((b) => b.drawer === made.drawers[0]).won, true);
  assert.equal(seen.boards.find((b) => b.drawer === made.drawers[1]).won, false);
});

test('the statistics count what each player drew, had named, and named first', () => {
  const { made, guesser, words } = drawing(['Ann', 'Bob', 'Cat']);
  const [named, unnamed] = made.drawers;
  game.guess(made, guesser, words[named], 100);
  const counter = (id, key) => made.players.find((p) => p.id === id)[key];
  assert.equal(counter(named, 'drawn'), 1);
  assert.equal(counter(named, 'wasNamed'), 1);
  assert.equal(counter(named, 'wentUnnamed'), 0);
  assert.equal(counter(unnamed, 'drawn'), 1);
  assert.equal(counter(unnamed, 'wentUnnamed'), 1, 'nobody named theirs');
  assert.equal(counter(guesser, 'guessedFirst'), 1);
  made.phase = 'finished';
  const rows = game.statsPlayers(made);
  assert.equal(rows.length, 3, 'three people');
  assert.deepEqual(Object.keys(rows[0].extras).sort(), ['drawn', 'guessedFirst', 'wasNamed', 'wentUnnamed']);
});

test('somebody leaving mid-round is replaced, and the computer player keeps their word and their place in the order', () => {
  const { made, rng, words } = drawing(['Ann', 'Bob', 'Cat', 'Dan']);
  const leaving = made.drawers[0];
  const pairs = JSON.stringify(made.order);
  assert.equal(game.removeHuman(made, leaving, rng, 0).ok, true);
  const stand = made.players.find((p) => p.stoodInFor === leaving);
  assert.equal(stand.kind, 'bot');
  assert.equal(made.drawers.includes(stand.id), true, 'it is drawing in their place');
  assert.equal(made.words[stand.id], words[leaving], 'with the word they had chosen');
  assert.equal(made.words[leaving], undefined);
  assert.notEqual(JSON.stringify(made.order), pairs, 'and the rounds still to come name it instead');
  assert.equal(JSON.stringify(made.order).includes(`"${leaving}"`), false);
  assert.equal(game.addHuman(made, leaving, 'Ann').ok, true, 'and they can take their place back');
  assert.equal(made.drawers.includes(leaving), true);
});

test('a round nobody is there to draw is skipped, and scores nothing', () => {
  const { made } = drawing(['Ann', 'Bob', 'Cat']);
  assert.equal(game.skipRound(made, 500).ok, true);
  assert.equal(made.phase, 'between');
  assert.equal(made.winner, null);
  for (const p of made.players) assert.equal(p.score, 0);
});

test('the host can start again from a finished game, with the scores cleared', () => {
  const { made, rng, guesser, words } = drawing(['Ann', 'Bob', 'Cat']);
  game.guess(made, guesser, words[made.drawers[0]], 100);
  made.phase = 'finished';
  assert.equal(game.playAgain(made, 2).error, 'hostOnlyEnd');
  assert.equal(game.playAgain(made, 1).ok, true);
  assert.equal(made.phase, 'lobby');
  assert.ok(made.players.every((p) => p.score === 0));
  assert.deepEqual(made.order, []);
  assert.equal(game.playAgain(made, 1).error, 'alreadyInLobby');
  assert.equal(game.start(made, 1, rng, 0).ok, true, 'and the table can play again');
});

test('three is the fewest: two to draw and one to guess', () => {
  const { made, rng } = room(['Ann', 'Bob']);
  assert.equal(game.start(made, 1, rng, 0).error, 'minPlayers');
  assert.equal(game.addHuman(made, 3, 'Cat').ok, true);
  assert.equal(game.start(made, 1, rng, 0).ok, true);
});

test('computer players choose a word and guess at both drawings', () => {
  const { made, rng } = room(['Ann']);
  assert.equal(game.fillWithBots(made, 1, 4).ok, true);
  assert.equal(game.start(made, 1, rng, 0).ok, true);
  // Whichever of them is drawing, a pending move is found and played until the round moves on.
  for (let guard = 0; guard < 50 && made.phase === 'choosing'; guard++) {
    const action = game.pendingBotAction(made);
    if (!action) break;
    assert.equal(action.type, 'word');
    assert.equal(game.runBotAction(made, rng, 0, action), true);
  }
  // Ann is the only person, and may be drawing; if she is, she chooses too.
  if (made.phase === 'choosing') game.chooseWord(made, 1, 0, 0);
  assert.equal(made.phase, 'drawing');
  let guessed = 0;
  for (let guard = 0; guard < 200 && made.phase === 'drawing'; guard++) {
    const action = game.pendingBotAction(made);
    if (!action) break;
    assert.equal(action.type, 'guess');
    assert.equal(game.runBotAction(made, rng, 100 + guard * 1000, action), true);
    guessed++;
  }
  assert.ok(guessed > 0, 'they had a go');
});
