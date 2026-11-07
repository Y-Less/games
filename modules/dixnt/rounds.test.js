import test from 'node:test';
import assert from 'node:assert/strict';
import { createRules, DEFAULT_ROUNDS_EACH } from './game.js';
import { makeRoom, range } from './harness.js';

/** A lobby of the named people, judged by the chooser alone so that a round takes few calls. */
const setup = (names, roundsEach) => makeRoom(names, { cardCount: 200, seed: 3, judging: 'chooser', roundsEach });

/** Plays one complete round (word, cards, the chooser's verdict).  Returns the chooser's id. */
function playRound({ game, room, rng }, { guessRight = true } = {}) {
  const chooserId = room.chooserId;
  game.submitWord(room, chooserId, 'a word', rng);
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  const targets = game.cardPlayers(room);
  const target = guessRight ? targets.find((p) => p.id === room.imposterId) : targets.find((p) => p.id !== room.imposterId);
  game.vote(room, chooserId, target.id);
  assert.equal(room.phase, 'results');
  return chooserId;
}

test('each player chooses twice by default, so four players play eight rounds', () => {
  assert.equal(DEFAULT_ROUNDS_EACH, 2);
  const made = setup(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room, rng } = made;
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(room.roundsEach, 2);
  assert.equal(game.viewFor(room, 1).totalRounds, 8);

  const choosers = [];
  while (room.phase !== 'finished') {
    choosers.push(playRound(made));
    game.nextRound(room, 1, rng);
    assert.ok(choosers.length <= 8, 'the game must stop by itself');
  }
  assert.equal(choosers.length, 8);
  for (const p of room.players) assert.equal(choosers.filter((id) => id === p.id).length, 2, `${p.name} chose twice`);
  assert.deepEqual(choosers.slice(0, 4), choosers.slice(4), 'the rotation repeats in the same order');
  assert.equal(room.completed, 8);
});

test('the number of rounds is configurable by the host, in the lobby, within limits', () => {
  const { game, room, rng } = setup(['Ann', 'Bob', 'Cat']);
  assert.equal(game.setSettings(room, 2, { roundsEach: 3 }).error, 'hostOnly');
  assert.equal(game.setSettings(room, 1, { roundsEach: 0 }).error, 'turnsEach');
  assert.equal(game.setSettings(room, 1, { roundsEach: 11 }).error, 'turnsEach');
  assert.equal(game.setSettings(room, 1, { roundsEach: 'lots' }).error, 'turnsEach');
  assert.equal(game.setSettings(room, 1, { roundsEach: 1 }).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(game.viewFor(room, 1).roundsEach, 1);
  assert.equal(game.viewFor(room, 1).totalRounds, 3);
  assert.equal(game.setSettings(room, 1, { roundsEach: 3 }).error, 'settingsBeforeStart', 'not once the game has started');
});

test('with one turn each the game ends after the last player has chosen, and shows the winners', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 1);
  const { game, room, rng } = made;
  assert.equal(game.start(room, 1, rng).ok, true);
  for (let round = 1; round <= 3; round++) {
    assert.equal(room.phase, 'word');
    assert.equal(game.viewFor(room, 1).completedRounds, round - 1);
    playRound(made);
    game.nextRound(room, 1, rng);
  }
  assert.equal(room.phase, 'finished');
  const view = game.viewFor(room, 1);
  assert.equal(view.phase, 'finished');
  assert.equal(view.me.hand.length, 0);
  assert.equal(view.results, null);
  const best = Math.max(...view.players.map((p) => p.score));
  assert.deepEqual([...view.winners].sort(), view.players.filter((p) => p.score === best).map((p) => p.id).sort());
  assert.equal(game.nextRound(room, 1, rng).error, 'roundNotOver', 'nothing more to play');
});

test('shared top scores produce several winners', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 1);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  for (let i = 0; i < 3; i++) {
    playRound(made, { guessRight: true }); // the chooser scores a point each time
    game.nextRound(room, 1, rng);
  }
  assert.equal(game.viewFor(room, 1).winners.length, 3, 'everyone scored once');
});

test('a skipped round does not count as anyone\'s turn', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 1);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  const skipped = room.chooserId;
  assert.equal(game.abortRound(room, 1, rng).ok, true);
  assert.equal(game.playerOf(room, skipped).turns, 0);
  assert.equal(room.completed, 0);

  const choosers = [];
  while (room.phase !== 'finished') {
    choosers.push(playRound(made));
    game.nextRound(room, 1, rng);
    assert.ok(choosers.length <= 4);
  }
  assert.equal(new Set(choosers).size, 3, 'everyone still got their turn, including the skipped chooser');
  assert.equal(choosers.length, 3, 'nobody had to choose twice');
});

test('somebody arriving late takes a computer player\'s turns, so the game is no longer than it was', () => {
  const made = setup(['Ann', 'Bob'], 1);
  const { game, room, rng } = made;
  assert.equal(game.addBot(room, 1).ok, true);
  game.start(room, 1, rng);
  assert.equal(game.viewFor(room, 1).totalRounds, 3);
  assert.equal(game.addHuman(room, 9, 'Late').ok, true);
  assert.equal(game.viewFor(room, 1).totalRounds, 3, 'they took a place rather than making one');

  const choosers = [];
  while (room.phase !== 'finished') {
    choosers.push(playRound(made));
    game.nextRound(room, 1, rng);
    assert.ok(choosers.length <= 3);
  }
  assert.equal(choosers.length, 3);
  assert.ok(choosers.includes(9), 'they chose the word in their turn');
  assert.equal(game.playerOf(room, 9).turns, 1);
});

test('the host removing the only player who still owes a turn leaves a computer player to take it', () => {
  const made = setup(['Ann', 'Bob', 'Cat', 'Dan'], 1);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  for (let i = 0; i < 3; i++) {
    playRound(made);
    game.nextRound(room, 1, rng);
  }
  assert.equal(room.phase, 'word');
  const lastToChoose = game.playerOf(room, room.chooserId);
  assert.equal(lastToChoose.turns, 0);
  assert.equal(game.kick(room, 1, lastToChoose.id, rng, 0).ok, true);
  assert.equal(room.phase, 'word', 'the game goes on: a computer player has their place and their turn');
  assert.equal(game.playerOf(room, room.chooserId).kind, 'bot');
  assert.equal(room.players.length, 4);
  playRound(made);
  game.nextRound(room, 1, rng);
  assert.equal(room.phase, 'finished');
});

test('after the game the host can start again, with fresh scores and turn counts', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 1);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  for (let i = 0; i < 3; i++) {
    playRound(made);
    game.nextRound(room, 1, rng);
  }
  assert.equal(room.phase, 'finished');
  assert.equal(game.playAgain(room, 2).error, 'hostOnlyEnd', 'only the host');
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.ok(room.players.every((p) => p.turns === 0));
  assert.equal(room.roundsEach, 1, 'the setting is remembered');
  assert.equal(room.recorded, false, 'the next game is recorded in its own right');
  assert.equal(game.playAgain(room, 1).error, 'alreadyInLobby');

  game.start(room, 1, rng);
  assert.ok(room.players.every((p) => p.score === 0 && p.turns === 0));
  assert.equal(room.completed, 0);
  assert.equal(room.phase, 'word');
});

test('saved games from before rounds existed still load, defaulting to two turns each', () => {
  const { game, room, rng } = setup(['Ann', 'Bob', 'Cat']);
  game.start(room, 1, rng);
  const saved = JSON.parse(JSON.stringify(room));
  delete saved.roundsEach;
  delete saved.completed;
  for (const p of saved.players) delete p.turns;
  const reloaded = createRules({ getCardIds: () => range(1, 200) }).migrate(saved);
  assert.equal(reloaded.roundsEach, 2);
  assert.equal(createRules({ getCardIds: () => range(1, 200) }).viewFor(reloaded, 1).totalRounds, 6);
});
