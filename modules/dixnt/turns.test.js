import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUNDS } from './game.js';
import { makeRoom, range, rulesWith } from './harness.js';

/** A lobby of the named people, judged by the chooser alone so that a turn takes few calls. */
const setup = (names, rounds) => makeRoom(names, { cardCount: 200, seed: 3, judging: 'chooser', rounds });

/** Plays one complete turn (word, cards, the chooser's verdict).  Returns the chooser's id. */
function playTurn({ game, room, rng }, { guessRight = true } = {}) {
  const chooserId = room.chooserId;
  game.submitWord(room, chooserId, 'a word', rng);
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  const targets = game.cardPlayers(room);
  const target = guessRight ? targets.find((p) => p.id === room.imposterId) : targets.find((p) => p.id !== room.imposterId);
  game.vote(room, chooserId, target.id);
  assert.equal(room.phase, 'results');
  return chooserId;
}

test('each player chooses twice by default, so four players play two rounds of four turns', () => {
  assert.equal(ROUNDS.default, 2);
  const made = setup(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room, rng } = made;
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(room.rounds, 2);
  assert.equal(game.viewFor(room, 1).totalTurns, 8);

  const choosers = [];
  while (room.phase !== 'finished') {
    choosers.push(playTurn(made));
    game.nextTurn(room, 1, rng);
    assert.ok(choosers.length <= 8, 'the game must stop by itself');
  }
  assert.equal(choosers.length, 8);
  for (const p of room.players) assert.equal(choosers.filter((id) => id === p.id).length, 2, `${p.name} chose twice`);
  assert.deepEqual(choosers.slice(0, 4), choosers.slice(4), 'the rotation repeats in the same order');
  assert.equal(room.completedTurns, 8);
});

test('the number of rounds is configurable by the host, in the lobby, within limits', () => {
  const { game, room, rng } = setup(['Ann', 'Bob', 'Cat']);
  assert.equal(game.setSettings(room, 2, { rounds: 3 }).error, 'hostOnly');
  assert.equal(game.setSettings(room, 1, { rounds: 0 }).error, 'rounds');
  assert.equal(game.setSettings(room, 1, { rounds: 11 }).error, 'rounds');
  assert.equal(game.setSettings(room, 1, { rounds: 'lots' }).error, 'rounds');
  assert.equal(game.setSettings(room, 1, { rounds: 1 }).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(game.viewFor(room, 1).rounds, 1);
  assert.equal(game.viewFor(room, 1).totalTurns, 3);
  assert.equal(game.setSettings(room, 1, { rounds: 3 }).error, 'settingsBeforeStart', 'not once the game has started');
});

test('with one turn each the game ends after the last player has chosen, and shows the winners', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 1);
  const { game, room, rng } = made;
  assert.equal(game.start(room, 1, rng).ok, true);
  for (let turn = 1; turn <= 3; turn++) {
    assert.equal(room.phase, 'word');
    assert.equal(game.viewFor(room, 1).completedTurns, turn - 1);
    playTurn(made);
    game.nextTurn(room, 1, rng);
  }
  assert.equal(room.phase, 'finished');
  const view = game.viewFor(room, 1);
  assert.equal(view.phase, 'finished');
  assert.equal(view.hand.length, 0);
  assert.equal(view.results, null);
  const best = Math.max(...view.players.map((p) => p.score));
  assert.deepEqual(view.players.filter((p) => p.winner).map((p) => p.id), view.players.filter((p) => p.score === best).map((p) => p.id), 'whoever has the most points has won');
  assert.ok(view.players.every((p) => p.winner === (p.placement === 1)), 'and the winners are the ones in first place');
  assert.equal(game.nextTurn(room, 1, rng).error, 'turnNotOver', 'nothing more to play');
});

test('shared top scores produce several winners', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 1);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  for (let i = 0; i < 3; i++) {
    playTurn(made, { guessRight: true }); // the chooser scores a point each time
    game.nextTurn(room, 1, rng);
  }
  assert.equal(game.viewFor(room, 1).players.filter((p) => p.winner).length, 3, 'everyone scored once');
});

test('a skipped turn does not count as anyone\'s turn', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 1);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  const skipped = room.chooserId;
  assert.equal(game.abortTurn(room, 1, rng).ok, true);
  assert.equal(game.playerOf(room, skipped).turns, 0);
  assert.equal(room.completedTurns, 0);

  const choosers = [];
  while (room.phase !== 'finished') {
    choosers.push(playTurn(made));
    game.nextTurn(room, 1, rng);
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
  assert.equal(game.viewFor(room, 1).totalTurns, 3);
  assert.equal(game.addHuman(room, 9, 'Late').ok, true);
  assert.equal(game.viewFor(room, 1).totalTurns, 3, 'they took a place rather than making one');

  const choosers = [];
  while (room.phase !== 'finished') {
    choosers.push(playTurn(made));
    game.nextTurn(room, 1, rng);
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
    playTurn(made);
    game.nextTurn(room, 1, rng);
  }
  assert.equal(room.phase, 'word');
  const lastToChoose = game.playerOf(room, room.chooserId);
  assert.equal(lastToChoose.turns, 0);
  assert.equal(game.kick(room, 1, lastToChoose.slot, rng, 0).ok, true);
  assert.equal(room.phase, 'word', 'the game goes on: a computer player has their place and their turn');
  assert.equal(game.playerOf(room, room.chooserId).kind, 'bot');
  assert.equal(room.players.length, 4);
  playTurn(made);
  game.nextTurn(room, 1, rng);
  assert.equal(room.phase, 'finished');
});

test('after the game the host can start again, with fresh scores and turn counts', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 1);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  for (let i = 0; i < 3; i++) {
    playTurn(made);
    game.nextTurn(room, 1, rng);
  }
  assert.equal(room.phase, 'finished');
  assert.equal(game.playAgain(room, 2).error, 'hostOnly', 'only the host');
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.ok(room.players.every((p) => p.turns === 0));
  assert.equal(room.rounds, 1, 'the setting is remembered');
  assert.equal(room.recorded, false, 'the next game is recorded in its own right');
  assert.equal(room.gameSeq, 1, 'and it is the second game in this room, so the first keeps its saved scoreboard');
  assert.equal(game.playAgain(room, 1).error, 'notOver', 'already back in the lobby');

  game.start(room, 1, rng);
  assert.ok(room.players.every((p) => p.score === 0 && p.turns === 0));
  assert.equal(room.completedTurns, 0);
  assert.equal(room.phase, 'word');
});

test('a round closes when the last player to have a go has had one, and says so on the results', () => {
  const made = setup(['Ann', 'Bob', 'Cat'], 2);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  const closes = [];
  while (room.phase !== 'finished') {
    playTurn(made);
    closes.push(room.results.roundOver);
    assert.equal(game.viewFor(room, 1).completedRounds, closes.filter(Boolean).length);
    game.nextTurn(room, 1, rng);
  }
  // Six turns, two rounds: the only results worth stopping on are the third and the sixth.
  assert.deepEqual(closes, [false, false, true, false, false, true]);
});

test('a skipped turn moves the end of the round, rather than closing one early', () => {
  const made = setup(['Ann', 'Bob', 'Cat', 'Dan'], 1);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  playTurn(made); // Ann
  assert.equal(room.results.roundOver, false);
  game.nextTurn(room, 1, rng);
  assert.equal(game.abortTurn(room, 1, rng).ok, true); // Bob's go is abandoned and comes back round later
  const closes = [];
  while (room.phase !== 'finished') {
    playTurn(made);
    closes.push(room.results.roundOver);
    game.nextTurn(room, 1, rng);
  }
  // Cat, Dan, then Bob last of all: the round closes on Bob, the player who had been skipped.
  assert.deepEqual(closes, [false, false, true]);
  assert.equal(game.viewFor(room, 1).completedRounds, 1);
});

test('saved games from before rounds existed still load, defaulting to two turns each', () => {
  const { game, room, rng } = setup(['Ann', 'Bob', 'Cat']);
  game.start(room, 1, rng);
  const saved = JSON.parse(JSON.stringify(room));
  delete saved.rounds;
  delete saved.completedTurns;
  for (const p of saved.players) delete p.turns;
  const reloaded = rulesWith({ getCardIds: () => range(1, 200) }).migrate(saved);
  assert.equal(reloaded.rounds, 2);
  assert.equal(rulesWith({ getCardIds: () => range(1, 200) }).viewFor(reloaded, 1).totalTurns, 6);
});

test('a room saved under the old words is renamed on the way in, history labels and all, however often it is loaded', () => {
  const { game, room, rng } = setup(['Ann', 'Bob', 'Cat'], 1);
  game.start(room, 1, rng);
  playTurn({ game, room, rng });
  const saved = JSON.parse(JSON.stringify(room));
  // Put it back the way a room saved before this rename holds it.
  saved.round = saved.turn;
  saved.completed = saved.completedTurns;
  saved.roundsEach = saved.rounds;
  saved.collectedRound = saved.collectedTurn;
  saved.history = [{ label: { key: 'round.label', params: { n: 1 } }, deltas: {}, notes: {} }, { label: { key: 'round.earlier' }, deltas: {}, notes: {} }];
  for (const was of ['turn', 'completedTurns', 'rounds', 'collectedTurn']) delete saved[was];

  const rules = rulesWith({ getCardIds: () => range(1, 200) });
  const once = rules.migrate(saved);
  const twice = rules.migrate(JSON.parse(JSON.stringify(once)));
  for (const reloaded of [once, twice]) {
    assert.equal(reloaded.turn, room.turn);
    assert.equal(reloaded.completedTurns, 1);
    assert.equal(reloaded.rounds, 1);
    assert.equal(reloaded.collectedTurn, room.collectedTurn);
    assert.deepEqual(reloaded.history.map((row) => row.label.key), ['turn.label', 'turn.earlier']);
    assert.ok(!('round' in reloaded) && !('completed' in reloaded) && !('roundsEach' in reloaded) && !('collectedRound' in reloaded));
  }
});
