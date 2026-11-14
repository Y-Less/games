import test from 'node:test';
import assert from 'node:assert/strict';
import { createRules } from './game.js';
import { makeRoom, range } from './harness.js';
import { totalsFromRounds } from '../../shared/scores.js';

const rules = () => createRules({ getCardIds: () => range(1, 200) });
const setup = (names, judging = 'everyone') => makeRoom(names, { cardCount: 200, seed: 7, judging });

/** Plays a round to its results. `right` says whether everyone who votes names the imposter. */
function playRound({ game, room, rng }, { right = true } = {}) {
  game.submitWord(room, room.chooserId, 'a word', rng);
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  for (const voter of game.voters(room)) {
    const targets = game.cardPlayers(room).filter((p) => p.id !== voter.id);
    const target = right ? targets.find((p) => p.id === room.imposterId) : targets.find((p) => p.id !== room.imposterId);
    game.vote(room, voter.id, (target ?? targets[0]).id);
  }
  assert.equal(room.phase, 'results');
}

const everyView = ({ game, room }, online) => room.players.map((p) => game.viewFor(room, p.id, online ? { online } : {}));

function assertAddsUp(made) {
  for (const view of everyView(made)) {
    const { players, rounds, lowIsBetter } = view.scoreboard;
    assert.equal(lowIsBetter, false);
    assert.equal('target' in view.scoreboard, false, 'Dixnt has no target score');
    const totals = totalsFromRounds(rounds, players.map((p) => p.id));
    for (const p of players) assert.equal(totals[p.id], p.score, `${p.name}: table total equals score`);
  }
}

test('every completed round is added to the history, with notes, and the totals equal the scores', () => {
  const made = setup(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  assert.deepEqual(game.viewFor(room, 1).scoreboard.rounds, []);
  for (let i = 1; i <= 3; i++) {
    const chooserId = room.chooserId;
    playRound(made, { right: i % 2 === 1 });
    const rounds = game.viewFor(room, 1).scoreboard.rounds;
    assert.equal(rounds.length, i);
    const last = rounds.at(-1);
    assert.deepEqual(last.label, { key: 'turn.label', params: { n: i } });
    assert.deepEqual(last.deltas, room.results.deltas);
    assert.deepEqual(last.notes[chooserId], { key: 'notes.chooser' });
    assert.ok(['notes.imposterCaught', 'notes.imposterFooledAll'].includes(last.notes[room.imposterId].key));
    assertAddsUp(made);
    game.nextTurn(room, 1, rng);
  }
});

test('the scoreboard shape is the same for everybody, with isMe and away set per viewer', () => {
  const made = setup(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  playRound(made);
  const views = everyView(made, (id) => id === 1 || id === 2);
  assert.deepEqual(views[0].scoreboard.rounds, views[2].scoreboard.rounds);
  assert.deepEqual(views[0].scoreboard.players.map((p) => p.isMe), [true, false, false]);
  assert.deepEqual(views[1].scoreboard.players.map((p) => p.isMe), [false, true, false]);
  assert.deepEqual(views[0].scoreboard.players.map((p) => p.away), [false, false, true]);
  assert.deepEqual(Object.keys(views[0].scoreboard.players[0]).sort(), ['away', 'bot', 'current', 'id', 'isMe', 'name', 'score', 'slot', 'userId']);
});

test('the scoreboard names each person by their account, which is what the site needs for name styles and avatars', () => {
  const { game, room } = makeRoom(['Ann'], { cardCount: 200 });
  assert.equal(game.addHuman(room, 12, 'Bob').ok, true);
  assert.equal(game.addHuman(room, 3, 'Cat').ok, true);
  assert.equal(game.addBot(room, 1).ok, true);
  const { players } = game.viewFor(room, 1).scoreboard;
  assert.deepEqual(players.map((p) => p.userId), [1, 12, 3, undefined], 'accounts, and nothing for a computer player');
  assert.deepEqual(players.map((p) => p.id), [1, 12, 3, 'bot:1'], 'a person is their account; a computer player is not one');
});

test('nothing is revealed early: the history only grows when the round is over', () => {
  const made = setup(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  playRound(made);
  game.nextTurn(room, 1, rng);
  // `current` marks who must act, so it moves as the round goes on; the scores and rounds must not.
  const board = () => game.viewFor(room, 1).scoreboard;
  const scores = () => JSON.stringify({ ...board(), players: board().players.map(({ current, ...p }) => p) });
  const before = scores();
  assert.deepEqual(board().players.map((p) => p.current), room.players.map((p) => p.id === room.chooserId), 'the chooser is to act');
  game.submitWord(room, room.chooserId, 'word', rng);
  assert.equal(scores(), before, 'choosing the word changes nothing');
  assert.deepEqual(board().players.map((p) => p.current), room.players.map((p) => p.id !== room.chooserId), 'now everybody else is to play a card');
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  assert.equal(scores(), before, 'neither does voting time');
});

test('abandoned rounds are not recorded, and labels count completed rounds only', () => {
  const made = setup(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  playRound(made);
  game.nextTurn(room, 1, rng);
  game.submitWord(room, room.chooserId, 'word', rng);
  game.abortTurn(room, 1, rng);
  game.abortTurn(room, 1, rng);
  assert.equal(room.history.length, 1);
  playRound(made);
  assert.deepEqual(room.history.map((r) => r.label), [{ key: 'turn.label', params: { n: 1 } }, { key: 'turn.label', params: { n: 2 } }]);
  assertAddsUp(made);
});

test('every judging style records its own notes and still adds up', () => {
  for (const judging of ['chooser', 'favourite']) {
    const made = setup(['Ann', 'Bob', 'Cat'], judging);
    const { game, room, rng } = made;
    game.start(room, 1, rng);
    const chooserId = room.chooserId;
    playRound(made, { right: false });
    // The stored round names slots; the scoreboard names people.
    const { notes, deltas } = game.viewFor(room, 1).scoreboard.rounds[0];
    assert.equal(Object.values(deltas).reduce((a, b) => a + b, 0) > 0, true);
    if (judging === 'chooser') assert.deepEqual(notes[chooserId], { key: 'notes.chooserFooled' });
    else assert.ok(Object.values(notes).some((note) => note.key === 'notes.cardPicked'));
    assertAddsUp(made);
  }
});

test('a place that changes hands keeps its column, so the table still adds up', () => {
  const made = setup(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  playRound(made);
  game.nextTurn(room, 1, rng);
  playRound(made);
  game.nextTurn(room, 1, rng);
  assertAddsUp(made);

  const dan = game.playerOf(room, 4);
  const score = dan.score;
  assert.equal(game.kick(room, 1, game.playerOf(room, 4).slot, rng, 0).ok, true);
  const stand = room.players[3];
  assert.equal(stand.kind, 'bot');
  assert.equal(stand.score, score, 'the computer player inherits the score');
  assert.equal(room.history.every((round) => !(4 in round.deltas)), true, 'and the column with it');
  assert.equal(room.history.length >= 2, true);
  assertAddsUp(made);
});

test('the history survives saving, and starting again clears it', () => {
  const made = setup(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  playRound(made);
  const copy = rules().migrate(JSON.parse(JSON.stringify(room)));
  assert.deepEqual(copy.history, room.history);
  assertAddsUp({ game: rules(), room: copy });
  room.phase = 'finished'; // the game is over: what is asked here is what the next one inherits
  assert.equal(game.playAgain(room, 1).ok, true);
  assert.deepEqual(game.viewFor(room, 1).scoreboard.rounds, []);
  assert.ok(game.viewFor(room, 1).scoreboard.players.every((p) => p.score === 0));
});

test('older saves without a history still load: existing scores become one "Earlier rounds" row', () => {
  const made = setup(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  playRound(made);
  game.nextTurn(room, 1, rng);
  const old = JSON.parse(JSON.stringify(room));
  delete old.history;
  const game2 = rules();
  const loaded = game2.migrate(old);
  const { rounds } = game2.viewFor(loaded, 1).scoreboard;
  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds[0].label, { key: 'turn.earlier' });
  assertAddsUp({ game: game2, room: loaded });
  playRound({ game: game2, room: loaded, rng });
  assert.deepEqual(loaded.history.map((r) => r.label), [{ key: 'turn.earlier' }, { key: 'turn.label', params: { n: 2 } }]);
  assertAddsUp({ game: game2, room: loaded });

  const empty = rules().migrate({ phase: 'lobby', players: [] });
  assert.deepEqual(empty.history, []);
});

test('a save from when a vote was worth a hundred points is scaled down, once', () => {
  const made = setup(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  game.start(room, 1, rng);
  playRound(made);
  const old = JSON.parse(JSON.stringify(room));
  delete old.pointScale;
  for (const p of old.players) p.score *= 100;
  for (const round of old.history) for (const id of Object.keys(round.deltas)) round.deltas[id] *= 100;
  const game2 = rules();
  const loaded = game2.migrate(old);
  assert.deepEqual(loaded.players.map((p) => p.score), room.players.map((p) => p.score));
  game2.migrate(loaded);
  assert.deepEqual(loaded.players.map((p) => p.score), room.players.map((p) => p.score), 'loading it again does not scale it twice');
  assertAddsUp({ game: game2, room: loaded });
});
