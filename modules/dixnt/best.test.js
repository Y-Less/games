// The "everyone votes for the best card" style: no imposter, and the whole table voting rather than one player
// deciding.  What is checked here is what the rules promise about it (the header of game.js and "Play styles" in
// rules.md): that nobody is kept from the word, that every vote a card is given is a point to whoever played it,
// what the turn names as the table's favourite, and what it does and does not count towards anybody's statistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { POINTS_PER_BEST } from './game.js';
import { makeRoom } from './harness.js';

/** A started game of the best-card style, with the cards down and the voting open. */
function toVoting(names = ['Ann', 'Bob', 'Cat', 'Dan'], options = {}) {
  const made = makeRoom(names, { judging: 'best', handSize: 4, cardCount: 120, seed: 4, start: true, ...options });
  const { game, room, rng } = made;
  assert.equal(game.submitWord(room, room.chooserId, 'borrowed light', rng).ok, true);
  for (const p of game.cardPlayers(room)) assert.equal(game.playCard(room, p.id, p.hand[0], rng).ok, true);
  assert.equal(room.phase, 'voting');
  return made;
}

test('the best-card style keeps nobody in the dark: everybody sees the word while the cards go down', () => {
  const made = makeRoom(['Ann', 'Bob', 'Cat'], { judging: 'best', handSize: 4, cardCount: 60, seed: 4, start: true });
  const { game, room, rng } = made;
  assert.equal(game.submitWord(room, room.chooserId, 'lighthouse', rng).ok, true);
  assert.equal(room.phase, 'picking');
  assert.equal(room.imposterId, null, 'nobody has to bluff');
  for (const p of room.players) {
    const view = game.viewFor(room, p.id);
    assert.equal(view.word, 'lighthouse', `${p.name} sees the word`);
    assert.equal(view.wordHidden, false);
  }
});

test('the whole table votes in the best-card style, and may change its mind until the last vote is in', () => {
  const made = toVoting();
  const { game, room } = made;
  assert.deepEqual(game.voters(room).map((p) => p.id).sort(), room.players.map((p) => p.id).sort(), 'everybody votes');
  const [first, second] = game.cardPlayers(room).filter((p) => p.id !== room.chooserId);
  assert.equal(game.vote(room, room.chooserId, first.id).ok, true);
  assert.equal(game.vote(room, room.chooserId, second.id).ok, true, 'a vote can be changed');
  assert.equal(room.votes[room.chooserId], second.id);
  assert.equal(room.phase, 'voting', 'and the turn is still waiting on the rest');
});

test('every vote a card is given is a point to whoever played it', () => {
  const made = toVoting();
  const { game, room } = made;
  const [a, b, c] = game.cardPlayers(room).map((p) => p.id);
  const chooser = room.chooserId;
  // Two for A, one each for B and C: four voters, four points shared out, no tie to break.
  game.vote(room, chooser, a);
  game.vote(room, b, a);
  game.vote(room, a, b);
  game.vote(room, c, b);
  assert.equal(room.phase, 'results');
  assert.deepEqual([room.results.tally[a], room.results.tally[b], room.results.tally[c]], [2, 2, 0]);
  assert.equal(room.results.deltas[a], 2 * POINTS_PER_BEST);
  assert.equal(room.results.deltas[b], 2 * POINTS_PER_BEST);
  assert.equal(room.results.deltas[c], 0);
  assert.equal(room.results.deltas[chooser], 0, 'the chooser played no card, so there was nothing to vote for');
  for (const p of room.players) assert.equal(p.score, room.results.deltas[p.id], 'the scores are what the turn gave out');
});

test('the best-card turn names the card the table settled on, and nobody when two drew', () => {
  const tied = toVoting();
  const [a, b] = tied.game.cardPlayers(tied.room).map((p) => p.id);
  const rest = tied.room.players.filter((p) => p.id !== a && p.id !== b).map((p) => p.id);
  tied.game.vote(tied.room, rest[0], a);
  tied.game.vote(tied.room, rest[1], b);
  tied.game.vote(tied.room, a, b);
  tied.game.vote(tied.room, b, a);
  assert.equal(tied.room.results.winnerId, null, 'two cards drew, so no card stood out');
  assert.equal(Object.values(tied.room.history[0].notes).some((n) => n?.key === 'notes.mostVotes'), false);

  const clear = toVoting();
  const [x, y] = clear.game.cardPlayers(clear.room).map((p) => p.id);
  for (const voter of clear.room.players.filter((p) => p.id !== x)) clear.game.vote(clear.room, voter.id, x);
  clear.game.vote(clear.room, x, y); // nobody may vote for their own card, so the winner votes elsewhere
  assert.equal(clear.room.results.winnerId, x);
  const slot = clear.game.playerOf(clear.room, x).slot;
  assert.equal(clear.room.history[0].notes[slot].key, 'notes.mostVotes');
});

test('nothing in a best-card turn is right or wrong, so no imposter counter is touched by it', () => {
  const made = toVoting();
  const { game, room } = made;
  const [a, other] = game.cardPlayers(room).map((p) => p.id);
  for (const voter of room.players.filter((p) => p.id !== a)) game.vote(room, voter.id, a);
  game.vote(room, a, other); // nobody may vote for their own card, so the winner votes elsewhere
  assert.equal(room.results.groupCorrect, null, 'there was nothing to be right about');
  assert.equal(room.results.imposterId, null);
  const winner = game.playerOf(room, a);
  // Having the table settle on your card counts the same as the chooser picking it.
  assert.equal(winner.favouritePicks, 1);
  for (const p of room.players) {
    assert.equal(p.roundsAsImposter, 0, `${p.name} was never the imposter`);
    assert.equal(p.correctGuesses, 0, `${p.name} guessed nothing`);
    assert.equal(p.votesAgainst, 0, 'a vote here is praise, not an accusation');
    assert.equal(p.loneDissent, 0, 'and voting differently is taste, not dissent');
  }
  assert.equal(game.playerOf(room, room.chooserId).cardsPlayed, 0, 'the chooser played no card');
});

test('the best-card style can be played with nobody choosing the word, and then everybody has a card to vote for', () => {
  const made = makeRoom(['Ann', 'Bob', 'Cat'], { judging: 'best', noChooser: true, hints: ['lighthouse'], handSize: 4, cardCount: 60, seed: 4, start: true });
  const { game, room, rng } = made;
  assert.equal(room.phase, 'picking', 'no word is waited for');
  assert.equal(room.imposterId, null);
  assert.equal(game.cardPlayers(room).length, 3, 'and everybody plays');
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  const [a, b, c] = room.players.map((p) => p.id);
  game.vote(room, a, b);
  game.vote(room, b, c);
  game.vote(room, c, b);
  assert.equal(room.phase, 'results');
  assert.equal(room.results.winnerId, b);
  assert.deepEqual([room.results.deltas[a], room.results.deltas[b], room.results.deltas[c]], [0, 2 * POINTS_PER_BEST, POINTS_PER_BEST]);
});

test('the best-card style is offered beside the others and survives a save', () => {
  const { game, room } = makeRoom(['Ann', 'Bob', 'Cat']);
  assert.equal(game.setSettings(room, 1, { judging: 'best' }).ok, true);
  assert.equal(game.viewFor(room, 1).judging, 'best');
  assert.deepEqual([game.viewFor(room, 1).groupVotes, game.viewFor(room, 1).hasImposter], [true, false]);
  game.migrate(room);
  assert.equal(room.judging, 'best', 'a saved room keeps it');
});
