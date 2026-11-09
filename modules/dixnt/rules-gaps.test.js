// Branches of game.js that the other tests do not reach: saved games from older versions, the last person leaving,
// places changing hands, ties, deck reshuffles, chooser order, and the exact refusals of each action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRules, MAX_WORD_LENGTH, POINTS_PER_VOTE } from './game.js';
import { makeRoom } from './harness.js';
import { seeded } from '../../shared/testkit.js';

const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const HINTS = ['h1', 'h2', 'h3', 'h4', 'h5'];

const setup = (names, { cards = 100, handSize = 4, roundsEach = 5, judging = 'everyone', seed = 3, start = true } = {}) =>
  makeRoom(names, { cardCount: cards, hints: HINTS, handSize, roundsEach, judging, rng: seeded(seed), start });

function playRoundTo({ game, room, rng }, phase) {
  game.submitWord(room, room.chooserId, 'word', rng);
  if (phase === 'picking') return;
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  if (phase === 'voting') return;
  for (const v of game.voters(room)) {
    const targets = game.cardPlayers(room).filter((p) => p.id !== v.id);
    game.vote(room, v.id, targets[0].id);
  }
}

test('the last person leaving empties the room, so the server can drop it', () => {
  const { game, room, rng } = setup(['Ann', 'Bob', 'Cat'], { handSize: 6, roundsEach: 3, judging: 'chooser' });
  assert.equal(game.removeHuman(room, 2, rng, 0).empty, false, 'a computer player keeps the place');
  assert.equal(game.removeHuman(room, 3, rng, 0).empty, false);
  const last = game.removeHuman(room, 1, rng, 0);
  assert.equal(last.empty, true);
  assert.equal(room.players.every((p) => p.kind === 'bot'), true, 'only computer players are left, and they keep nothing alive');
});

test('the last person leaving the lobby empties it too', () => {
  const { game, room, rng } = setup(['Ann', 'Bob'], { start: false });
  assert.equal(game.removeHuman(room, 2, rng, 0).empty, false);
  assert.equal(room.players.length, 1, 'in the lobby a place is simply given up');
  assert.equal(game.removeHuman(room, 1, rng, 0).empty, true);
  assert.equal(room.players.length, 0);
});

test('a saved game from an older version is brought up to date', () => {
  const rules = () => createRules({ getCardIds: () => ids(50) });
  const { game, room } = setup(['A', 'B', 'C'], { cards: 50 });
  const saved = JSON.parse(JSON.stringify(room));
  delete saved.history;
  saved.phase = 'discussion';
  saved.players[0].score = 300;
  saved.players[1].score = 100;
  saved.judging = 'something retired';
  saved.categories = ['gone'];
  saved.ready = { x: true };
  delete saved.pointScale;
  const loaded = rules().migrate(saved);
  assert.equal(loaded.phase, 'voting', 'the old separate discussion step is folded into voting');
  assert.equal('ready' in loaded, false);
  assert.equal(loaded.judging, 'everyone');
  assert.deepEqual(loaded.categories, ['all']);
  assert.equal(loaded.history.length, 1);
  assert.deepEqual(loaded.history[0].label, { key: 'round.earlier' });
  assert.deepEqual(loaded.history[0].deltas, { s0: 3, s1: 1, s2: 0 }, 'the old hundreds are scaled down, under the slots the players were given');
  assert.deepEqual(game.viewFor(loaded, 1).scoreboard.rounds[0].deltas, { 1: 3, 2: 1, 3: 0 }, 'and the scoreboard still names the people');
  // Without scores there is nothing to explain, and in a lobby neither.
  const quiet = rules().migrate({ ...JSON.parse(JSON.stringify(saved)), history: undefined, players: saved.players.map((p) => ({ ...p, score: 0 })) });
  assert.deepEqual(quiet.history, []);
  assert.equal(game.viewFor(room, 1).phase, 'word', 'the room it was copied from is untouched');
});

test('the deck follows the cards on disk: missing cards vanish everywhere, new ones join the draw pile mid-game', () => {
  let available = ids(60);
  const game = createRules({ getCardIds: () => available });
  const rng = seeded(5);
  const room = game.createRoom({ code: 'deck-test-here', hostId: 1, hostName: 'A', now: 0 });
  game.addHuman(room, 2, 'B');
  game.addHuman(room, 3, 'C');
  game.setSettings(room, 1, { handSize: 5 });
  assert.equal(game.start(room, 1, rng).ok, true);
  const held = room.players[1].hand[0];
  available = [...available.filter((id) => id !== held && id !== room.draw[0]), ...ids(10, 500)];
  game.syncCards(room, rng);
  const all = [...room.draw, ...room.discard, ...room.players.flatMap((p) => p.hand)];
  assert.ok(!all.includes(held), 'a card whose picture has gone is taken out of a hand');
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 68, '60 - 2 removed + 10 new');
  assert.ok(ids(10, 500).every((id) => room.draw.includes(id)));
  // The same sync in the lobby adds nothing to the (empty) deck.
  const lobby = game.createRoom({ code: 'lobby-test-here', hostId: 1, hostName: 'A', now: 0 });
  game.syncCards(lobby, rng);
  assert.deepEqual(lobby.draw, []);
});

test('hands are topped up from the discard pile, reshuffled, when the draw pile runs dry', () => {
  const made = setup(['A', 'B', 'C'], { cards: 15, handSize: 4, roundsEach: 5 });
  const { game, room, rng } = made;
  assert.equal(room.draw.length, 3);
  for (let round = 0; round < 6; round++) {
    playRoundTo(made, 'results');
    game.nextRound(room, 1, rng);
    const all = [...room.draw, ...room.discard, ...room.players.flatMap((p) => p.hand)];
    assert.equal(new Set(all).size, 15, 'no card lost or doubled');
    assert.ok(room.players.every((p) => p.hand.length === 4), 'full hands every round');
    if (room.phase === 'finished') break;
  }
});

test('starting needs enough cards for everyone, and the host to be asking', () => {
  const { game, room, rng } = setup(['A', 'B', 'C', 'D'], { cards: 20, handSize: 6, start: false, seed: 1 });
  assert.equal(game.start(room, 1, rng).error, 'notEnoughCards');
  assert.equal(game.setSettings(room, 1, { handSize: 5 }).ok, true);
  assert.equal(game.start(room, 2, rng).error, 'hostOnlyStart');
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(game.start(room, 1, rng).error, 'alreadyStarted');
  const small = setup(['A', 'B'], { cards: 50, start: false });
  assert.equal(small.game.start(small.room, 1, small.rng).error, 'minPlayers');
});

test('names are made unique in the room, and the settings are lobby-only', () => {
  const { game, room, rng } = setup(['  Ann   Lee '], { cards: 50, start: false });
  assert.equal(room.players[0].name, '  Ann   Lee ', 'the account name is taken as the site gives it');
  assert.equal(game.addHuman(room, 2, 'Ann Lee').ok, true);
  assert.equal(game.addHuman(room, 3, 'Ann Lee').ok, true);
  assert.equal(new Set(room.players.map((p) => p.name.toLowerCase())).size, 3, 'no two people answer to the same name');
  assert.equal(game.start(room, 1, rng).ok, true);
  for (const settings of [{ handSize: 5 }, { roundsEach: 2 }, { judging: 'chooser' }, { categories: ['all'] }]) {
    assert.equal(game.setSettings(room, 1, settings).error, 'settingsBeforeStart');
  }
  assert.equal(game.playAgain(room, 'someone else').error, 'hostOnlyEnd');
});

test('settings accept numeric strings and fractions by rounding, and refuse anything outside the range', () => {
  const { game, room } = setup(['A'], { cards: 50, start: false });
  assert.equal(game.setSettings(room, 1, { handSize: '5' }).ok, true);
  assert.equal(room.handSize, 5);
  game.setSettings(room, 1, { handSize: 7.4 });
  assert.equal(room.handSize, 7);
  game.setSettings(room, 1, { roundsEach: '3' });
  assert.equal(room.roundsEach, 3);
  for (const bad of [NaN, 'abc', Infinity, -1, [], {}, 2.4, 12.6]) {
    const before = room.handSize;
    assert.equal(game.setSettings(room, 1, { handSize: bad }).error, 'handSizeRange', `${String(bad)} is refused`);
    assert.equal(room.handSize, before);
  }
  for (const bad of [0, 11, 'x', NaN, null]) assert.equal(game.setSettings(room, 1, { roundsEach: bad }).error, 'turnsEach');
  assert.equal(game.setSettings(room, 1, { judging: 'dice' }).error, 'unknownJudging');
  assert.equal(game.setSettings(room, 1, { categories: 'all' }).error, 'needCategory');
  assert.equal(game.setSettings(room, 1, { categories: ['all', 'all', 'nope'] }).error, 'unknownCategory');
  assert.equal(game.setSettings(room, 1, {}).ok, true, 'a message that asks for nothing is not a refusal');
});

test('words: tidied, limited, and only the chooser at the right moment', () => {
  const { game, room, rng } = setup(['A', 'B', 'C']);
  const chooser = room.chooserId;
  const other = room.players.find((p) => p.id !== chooser).id;
  assert.equal(game.submitWord(room, other, 'x', rng).error, 'chooserOnlyWord');
  assert.equal(game.submitWord(room, chooser, '   ', rng).error, 'typeWord');
  assert.equal(game.submitWord(room, chooser, undefined, rng).error, 'typeWord');
  assert.equal(game.submitWord(room, chooser, 'y'.repeat(MAX_WORD_LENGTH + 1), rng).error, 'wordTooLong');
  assert.equal(game.submitWord(room, chooser, '  two    words\n  here ', rng).ok, true);
  assert.equal(room.word, 'two words here');
  assert.equal(game.submitWord(room, chooser, 'again', rng).error, 'notTimeToChooseWord');
});

test('playing a card: the chooser cannot, strangers cannot, changing your pick is allowed until the last card', () => {
  const { game, room, rng } = setup(['A', 'B', 'C', 'D']);
  const chooser = room.chooserId;
  const [p1, p2, p3] = room.players.filter((p) => p.id !== chooser);
  game.submitWord(room, chooser, 'w', rng);
  assert.equal(game.playCard(room, chooser, game.playerOf(room, chooser).hand[0], rng).error, 'notPlayingThisRound');
  assert.equal(game.playCard(room, 'stranger', 1, rng).error, 'notInGame');
  assert.equal(game.playCard(room, p1.id, p2.hand[0], rng).error, 'notInHand');
  game.playCard(room, p1.id, p1.hand[0], rng);
  game.playCard(room, p1.id, p1.hand[1], rng);
  assert.equal(room.picks[p1.id], p1.hand[1], 'the second pick replaced the first');
  game.playCard(room, p2.id, p2.hand[0], rng);
  game.playCard(room, p3.id, p3.hand[0], rng);
  assert.equal(room.phase, 'voting');
  assert.equal(room.tableOrder.length, 3);
  assert.equal(game.playCard(room, p1.id, p1.hand[0], rng).error, 'notTimeToPlay');
});

test('"everyone" judging: an exact tie between the imposter and another player is not a catch', () => {
  const made = setup(['A', 'B', 'C', 'D']);
  const { game, room } = made;
  playRoundTo(made, 'voting');
  const imposter = room.imposterId;
  const [x, y] = game.cardPlayers(room).map((p) => p.id).filter((id) => id !== imposter);
  const chooser = room.chooserId;
  game.vote(room, imposter, x);
  game.vote(room, x, imposter);
  game.vote(room, y, x);
  game.vote(room, chooser, y);
  assert.equal(room.phase, 'results');
  assert.equal(room.results.tally[imposter], 1);
  assert.equal(room.results.tally[x], 2);
  assert.equal(room.results.groupCorrect, false);
  assert.equal(room.results.deltas[imposter], 2 * POINTS_PER_VOTE, 'the two who did not name the imposter are fooled');
});

test('"chooser" and "favourite" judging allow only the chooser to vote and score as documented', () => {
  for (const judging of ['chooser', 'favourite']) {
    const made = setup(['A', 'B', 'C'], { judging });
    const { game, room } = made;
    playRoundTo(made, 'voting');
    const other = room.players.find((p) => p.id !== room.chooserId);
    assert.equal(game.vote(room, other.id, room.chooserId).error, 'chooserOnlyVotes');
    const [first] = game.cardPlayers(room);
    game.vote(room, room.chooserId, first.id);
    assert.equal(room.phase, 'results');
    assert.equal(room.results.judging, judging);
    if (judging === 'favourite') {
      assert.equal(room.imposterId, null);
      assert.equal(room.results.deltas[first.id], 2);
      assert.equal(room.results.groupCorrect, null);
    } else {
      assert.equal(room.results.deltas[first.id === room.imposterId ? room.chooserId : room.imposterId], first.id === room.imposterId ? 1 : 5);
    }
  }
});

test('voting rules: not before the cards are in, never for yourself or a non-card-player, and not after the end', () => {
  const made = setup(['A', 'B', 'C']);
  const { game, room, rng } = made;
  const chooser = room.chooserId;
  assert.equal(game.vote(room, chooser, 1).error, 'notTimeToVote');
  playRoundTo(made, 'voting');
  const [p1, p2] = game.cardPlayers(room);
  assert.equal(game.vote(room, p1.id, p1.id).error, 'voteSelf');
  assert.equal(game.vote(room, p1.id, chooser).error, 'voteCardPlayer');
  assert.equal(game.vote(room, p1.id, 'nobody').error, 'voteCardPlayer');
  assert.equal(game.vote(room, 'stranger', p1.id).error, 'notInGame');
  game.vote(room, p1.id, p2.id);
  game.vote(room, p2.id, p1.id);
  game.vote(room, chooser, p1.id);
  assert.equal(room.phase, 'results');
  assert.equal(game.vote(room, p1.id, p2.id).error, 'notTimeToVote');
  assert.equal(game.abortRound(room, room.hostId, rng).error, 'noRoundToSkip');
});

test('skipping a round gives nobody a turn, a score or a history row, and the next chooser follows', () => {
  const made = setup(['A', 'B', 'C'], { roundsEach: 1 });
  const { game, room, rng } = made;
  const first = room.chooserId;
  assert.equal(game.abortRound(room, 2, rng).error, 'hostOnlySkip');
  assert.equal(game.abortRound(room, 1, rng).ok, true);
  assert.notEqual(room.chooserId, first);
  assert.equal(room.round, 2);
  assert.equal(room.completed, 0);
  assert.deepEqual(room.history, []);
  assert.ok(room.players.every((p) => p.turns === 0 && p.score === 0));
  // Every player still gets their turn: three rounds complete the game.
  const chosen = [];
  for (let i = 0; i < 3; i++) {
    chosen.push(room.chooserId);
    playRoundTo(made, 'results');
    game.nextRound(room, 1, rng);
  }
  assert.equal(new Set(chosen).size, 3);
  assert.equal(room.phase, 'finished');
});

test('a place that changes hands keeps its column and its cards, and chooser order stays fair', () => {
  const made = setup(['A', 'B', 'C', 'D', 'E'], { roundsEach: 2 });
  const { game, room, rng } = made;
  playRoundTo(made, 'results');
  game.nextRound(room, 1, rng);
  playRoundTo(made, 'results');
  game.nextRound(room, 1, rng);
  const leaver = room.players[1];
  const heldCards = [...leaver.hand];
  const score = leaver.score;
  const discardBefore = room.discard.length;
  assert.equal(game.kick(room, 1, leaver.slot, rng, 0).ok, true);
  const stand = room.players[1];
  assert.equal(stand.kind, 'bot');
  assert.deepEqual(stand.hand, heldCards, 'the cards stay with the place');
  assert.equal(room.discard.length, discardBefore, 'so nothing is thrown away');
  // The history never named the person in the first place: it names the slot, which the computer player now holds, so
  // the column belongs to whoever is in the place rather than to whoever was.
  assert.equal(stand.slot, leaver.slot, 'the slot stayed with the place');
  const rounds = game.viewFor(room, 1).scoreboard.rounds;
  assert.ok(rounds.every((r) => !(leaver.id in r.deltas) && !(leaver.id in r.notes)));
  assert.equal(stand.score, score);
  for (const p of room.players) assert.equal(room.history.reduce((n, r) => n + (r.deltas[p.slot] ?? 0), 0), p.score);
  assert.equal(game.kick(room, 3, game.playerOf(room, 4).slot, rng, 0).error, 'hostOnlyRemove');
  assert.equal(game.kick(room, 1, 'nobody', rng, 0).error, 'playerNotInGame');
  // The turn counts: nobody who still owes a turn is skipped.
  const owing = room.players.filter((p) => p.turns < room.roundsEach).map((p) => p.id);
  if (owing.length) assert.ok(owing.includes(room.chooserId));
});

test('hosting passes to the first remaining person, and starting again clears the round', () => {
  const made = setup(['A', 'B', 'C', 'D']);
  const { game, room, rng } = made;
  playRoundTo(made, 'results');
  assert.equal(game.removeHuman(room, 1, rng, 0).ok, true);
  assert.equal(room.hostId, 2);
  assert.equal(game.playAgain(room, room.hostId).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.ok(room.players.every((p) => p.score === 0 && p.hand.length === 0));
  assert.deepEqual([room.picks, room.votes, room.results, room.word], [{}, {}, null, null]);
  assert.equal(game.start(room, room.hostId, rng).ok, true);
  assert.equal(room.phase, 'word');
  assert.equal(room.round, 1, 'a new game starts from round one');
});

test('hints cycle without repeats until the pool runs out, then reshuffle', () => {
  const game = createRules({ getCardIds: () => ids(10), hints: ['a', 'b', 'c', 'd', 'e', 'f'] });
  const rng = seeded(2);
  const room = game.createRoom({ code: 'hint-test-here', hostId: 1, hostName: 'A', now: 0 });
  const first = [...game.nextHints(room, 3, rng), ...game.nextHints(room, 3, rng)];
  assert.equal(new Set(first).size, 6, 'two draws of three use the six hints once each');
  assert.equal(game.nextHints(room, 3, rng).length, 3, 'then the pool is refilled');
  const none = createRules({ getCardIds: () => ids(10), hints: [] });
  assert.deepEqual(none.nextHints(none.createRoom({ code: 'no-hints-here', hostId: 1, hostName: 'A', now: 0 }), 3, rng), []);
});

test('viewFor: results and the imposter appear only at the end; the table order hides who played what', () => {
  const made = setup(['A', 'B', 'C', 'D']);
  const { game, room } = made;
  playRoundTo(made, 'voting');
  for (const p of room.players) {
    const view = game.viewFor(room, p.id, { online: (id) => id === p.id });
    assert.equal(view.results, null);
    assert.equal(view.me.isImposter, false);
    assert.equal(view.word, 'word');
    assert.equal(view.players.find((x) => x.id === p.id).connected, true);
    assert.equal(view.players.filter((x) => x.connected).length, 1);
    assert.equal(view.voteTargets.includes(p.id), false, 'never vote for yourself');
  }
  for (const v of game.voters(room)) game.vote(room, v.id, game.cardPlayers(room).find((p) => p.id !== v.id).id);
  for (const p of room.players) {
    const view = game.viewFor(room, p.id);
    assert.ok(view.results);
    assert.equal(view.me.isImposter, p.id === room.imposterId);
    assert.equal(view.winners.length, 0, 'not finished');
  }
});
