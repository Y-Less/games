import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVOURITE_POINTS } from './game.js';
import { makeRoom } from './harness.js';

const setup = (names = ['Ann', 'Bob', 'Cat', 'Dan']) => makeRoom(names, { cardCount: 200, seed: 5, judging: 'favourite', start: true });

function toVoting({ game, room, rng }) {
  const chooser = game.playerOf(room, room.chooserId);
  game.submitWord(room, chooser.id, 'borrowed light', rng);
  const cardPlayers = game.cardPlayers(room);
  for (const p of cardPlayers) game.playCard(room, p.id, p.hand[0], rng);
  assert.equal(room.phase, 'voting');
  return { chooser, cardPlayers };
}

test('favourite style: the word is shown to everyone and there is no imposter', () => {
  const { game, room, rng } = setup();
  game.submitWord(room, room.chooserId, 'borrowed light', rng);
  assert.equal(room.imposterId, null);
  for (const p of room.players) {
    const view = game.viewFor(room, p.id);
    assert.equal(view.word, 'borrowed light', `${p.name} can see the word while picking`);
    assert.equal(view.wordHidden, false);
    assert.equal(view.isImposter, false);
  }
});

test('favourite style: the chooser picks a card, the round ends at once and that player scores 2', () => {
  const made = setup();
  const { game, room } = made;
  const { chooser, cardPlayers } = toVoting(made);
  const winner = cardPlayers[1];

  game.vote(room, chooser.id, winner.id);
  assert.equal(room.phase, 'results', 'only the chooser needs to decide');
  const r = room.results;
  assert.equal(r.judging, 'favourite');
  assert.equal(r.winnerId, winner.id);
  assert.equal(r.imposterId, null);
  assert.equal(r.deltas[winner.id], FAVOURITE_POINTS);
  assert.equal(FAVOURITE_POINTS, 2);
  for (const p of room.players.filter((x) => x.id !== winner.id)) assert.equal(r.deltas[p.id], 0);
  assert.equal(game.playerOf(room, winner.id).score, 2);
  assert.equal(game.playerOf(room, chooser.id).score, 0, 'the chooser does not score');
});

test('favourite style: only the chooser can pick, and only from the cards on the table', () => {
  const made = setup();
  const { game, room } = made;
  const { chooser, cardPlayers } = toVoting(made);
  assert.equal(game.vote(room, cardPlayers[0].id, cardPlayers[1].id).error, 'chooserOnlyVotes');
  assert.equal(game.vote(room, chooser.id, chooser.id).error, 'voteSelf');
  assert.equal(game.viewFor(room, cardPlayers[0].id).voteTargets.length, 0);
  assert.equal(game.viewFor(room, chooser.id).voteTargets.length, 3);
  assert.equal(room.phase, 'voting', 'refused picks changed nothing');
});

test('favourite style: the first pick settles the round and cannot be changed afterwards', () => {
  const made = setup();
  const { game, room } = made;
  const { chooser, cardPlayers } = toVoting(made);
  game.vote(room, chooser.id, cardPlayers[0].id);
  assert.equal(room.phase, 'results', 'the first pick ends the round, so there is nothing to change after');
  assert.equal(game.vote(room, chooser.id, cardPlayers[1].id).error, 'notTimeToVote');
  assert.equal(room.results.winnerId, cardPlayers[0].id);
});

test('favourite style: no imposter is revealed anywhere in the results view', () => {
  const made = setup();
  const { game, room } = made;
  const { chooser, cardPlayers } = toVoting(made);
  game.vote(room, chooser.id, cardPlayers[0].id);
  const view = game.viewFor(room, 1);
  assert.equal(view.results.imposterId, null);
  assert.equal(view.results.groupCorrect, null);
  assert.equal(view.isImposter, false);
});

test('favourite style: works with rounds, so everyone is judged in turn and the game finishes', () => {
  const made = setup(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  const choosers = [];
  while (room.phase !== 'finished') {
    const { chooser, cardPlayers } = toVoting(made);
    choosers.push(chooser.id);
    game.vote(room, chooser.id, cardPlayers[0].id);
    game.nextTurn(room, 1, rng);
    assert.ok(choosers.length <= 6);
  }
  assert.equal(choosers.length, 6, 'three players, two turns each by default');
  const total = room.players.reduce((sum, p) => sum + p.score, 0);
  assert.equal(total, 6 * FAVOURITE_POINTS, 'exactly one 2-point award per round');
});

test('the play style can be switched between all three in the lobby', () => {
  const { game, room } = makeRoom(['Ann', 'Bob', 'Cat'], { cardCount: 100 });
  for (const mode of ['chooser', 'favourite', 'everyone']) {
    assert.equal(game.setSettings(room, 1, { judging: mode }).ok, true);
    assert.equal(game.viewFor(room, 2).judging, mode);
  }
  assert.equal(game.viewFor(room, 2).pointsFavourite, 2);
  assert.equal(game.setSettings(room, 1, { judging: 'tournament' }).error, 'unknownJudging');
});
