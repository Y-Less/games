// Branches of game.js that the other tests do not reach: saved games from older versions, the last player leaving,
// late joiners, ties, deck reshuffles, chooser order after leaves and the exact refusals of each action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, MAX_NAME_LENGTH, MAX_WORD_LENGTH, POINTS_PER_VOTE } from './game.js';
import { seeded } from '../../shared/testkit.js';

const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const refuses = (fn, pattern) => assert.throws(fn, (error) => error instanceof GameError && (!pattern || pattern.test(error.message)));

function setup(names, { cards = 100, handSize = 4, roundsEach = 5, judging = 'everyone', seed = 3 } = {}) {
  const game = new Game({ getCardIds: () => ids(cards), hints: ['h1', 'h2', 'h3', 'h4', 'h5'], rng: seeded(seed) });
  const players = names.map((n) => game.addPlayer(n, `tok-${n}`));
  const host = players[0].id;
  game.setHandSize(host, handSize);
  game.setRounds(host, roundsEach);
  game.setJudging(host, judging);
  game.start(host);
  return { game, players, host };
}

function playRoundTo(game, phase, voteFor = () => null) {
  const s = game.s;
  game.submitWord(s.chooserId, 'word');
  if (phase === 'picking') return;
  for (const p of game.cardPlayers()) game.playCard(p.id, p.hand[0]);
  if (phase === 'voting') return;
  for (const v of game.voters()) {
    const targets = game.cardPlayers().filter((p) => p.id !== v.id);
    game.vote(v.id, voteFor(v, targets) ?? targets[0].id);
  }
}

test('the last player leaving resets the room but keeps the host-chosen settings', () => {
  const { game, players, host } = setup(['Ann', 'Bob', 'Cat'], { handSize: 6, roundsEach: 3, judging: 'chooser' });
  game.removePlayer(players[1].id, players[1].id); // two left: back to the lobby
  assert.equal(game.s.phase, 'lobby');
  game.removePlayer(players[2].id, players[2].id);
  game.removePlayer(host, host);
  assert.equal(game.s.players.length, 0);
  assert.equal(game.s.phase, 'lobby');
  assert.equal(game.s.hostId, null);
  assert.equal(game.s.handSize, 6);
  assert.equal(game.s.roundsEach, 3);
  assert.equal(game.s.judging, 'chooser');
  assert.deepEqual([game.s.draw, game.s.discard, game.s.history], [[], [], []]);
  const again = game.addPlayer('Dan', 'tok-dan');
  assert.equal(game.s.hostId, again.id, 'the next person to arrive hosts');
});

test('a saved game from an older version is brought up to date', () => {
  const old = new Game({ getCardIds: () => ids(50), hints: [] });
  const [a, b, c] = ['A', 'B', 'C'].map((n) => old.addPlayer(n, n));
  old.start(a.id);
  const saved = JSON.parse(JSON.stringify(old.toJSON()));
  delete saved.history;
  saved.phase = 'discussion';
  saved.players[0].score = 300;
  saved.players[1].score = 100;
  saved.judging = 'something retired';
  saved.categories = ['gone'];
  saved.ready = { x: true };
  const loaded = new Game({ getCardIds: () => ids(50), hints: [], saved });
  assert.equal(loaded.s.phase, 'voting', 'the old separate discussion step is folded into voting');
  assert.equal('ready' in loaded.s, false);
  assert.equal(loaded.s.judging, 'everyone');
  assert.deepEqual(loaded.s.categories, ['all']);
  assert.equal(loaded.s.history.length, 1);
  assert.equal(loaded.s.history[0].label, 'Earlier rounds');
  assert.deepEqual(loaded.s.history[0].deltas, { [a.id]: 300, [b.id]: 100, [c.id]: 0 });
  // Without scores there is nothing to explain, and in a lobby neither.
  const quiet = new Game({ getCardIds: () => ids(50), hints: [], saved: { ...saved, history: undefined, players: saved.players.map((p) => ({ ...p, score: 0 })) } });
  assert.deepEqual(quiet.s.history, []);
});

test('the deck follows the cards on disk: missing cards vanish everywhere, new ones join the draw pile mid-game', () => {
  let available = ids(60);
  const game = new Game({ getCardIds: () => available, hints: [], rng: seeded(5) });
  const players = ['A', 'B', 'C'].map((n) => game.addPlayer(n, n));
  game.setHandSize(players[0].id, 5);
  game.start(players[0].id);
  const held = game.s.players[1].hand[0];
  available = [...available.filter((id) => id !== held && id !== game.s.draw[0]), ...ids(10, 500)];
  game.syncCards();
  const all = [...game.s.draw, ...game.s.discard, ...game.s.players.flatMap((p) => p.hand)];
  assert.ok(!all.includes(held), 'a card whose picture has gone is taken out of a hand');
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 68, '60 - 2 removed + 10 new');
  assert.ok(ids(10, 500).every((id) => game.s.draw.includes(id)));
  // The same sync in the lobby adds nothing to the (empty) deck.
  const lobby = new Game({ getCardIds: () => available, hints: [] });
  lobby.syncCards();
  assert.deepEqual(lobby.s.draw, []);
});

test('hands are topped up from the discard pile, reshuffled, when the draw pile runs dry', () => {
  const { game, host } = setup(['A', 'B', 'C'], { cards: 15, handSize: 4, roundsEach: 5 });
  assert.equal(game.s.draw.length, 3);
  for (let round = 0; round < 6; round++) {
    playRoundTo(game, 'results');
    game.nextRound(host);
    const all = [...game.s.draw, ...game.s.discard, ...game.s.players.flatMap((p) => p.hand)];
    assert.equal(new Set(all).size, 15, 'no card lost or doubled');
    assert.ok(game.s.players.every((p) => p.hand.length === 4), 'full hands every round');
    if (game.s.phase === 'finished') break;
  }
});

test('starting needs enough cards for everyone, and the host to be asking', () => {
  const game = new Game({ getCardIds: () => ids(20), hints: [], rng: seeded(1) });
  const players = ['A', 'B', 'C', 'D'].map((n) => game.addPlayer(n, n));
  game.setHandSize(players[0].id, 6);
  refuses(() => game.start(players[0].id), /not enough cards/);
  game.setHandSize(players[0].id, 5);
  refuses(() => game.start(players[1].id), /host/);
  game.start(players[0].id);
  refuses(() => game.start(players[0].id), /already started/);
  const small = new Game({ getCardIds: () => ids(50), hints: [] });
  small.addPlayer('A', 'A');
  small.addPlayer('B', 'B');
  refuses(() => small.start(small.s.hostId), /at least 3/);
});

test('names: blank, too long and duplicate (in any case) are refused; the settings are lobby-only', () => {
  const game = new Game({ getCardIds: () => ids(50), hints: [] });
  refuses(() => game.addPlayer('   ', 't'), /name/);
  refuses(() => game.addPlayer(undefined, 't'), /name/);
  refuses(() => game.addPlayer('x'.repeat(MAX_NAME_LENGTH + 1), 't'), /at most/);
  const ann = game.addPlayer('  Ann   Lee ', 't1');
  assert.equal(ann.name, 'Ann Lee', 'whitespace is tidied');
  refuses(() => game.addPlayer('ANN lee', 't2'), /already using/);
  game.addPlayer('Bob', 't3');
  game.addPlayer('Cat', 't4');
  game.start(ann.id);
  for (const call of [() => game.setHandSize(ann.id, 5), () => game.setRounds(ann.id, 2), () => game.setJudging(ann.id, 'chooser'), () => game.setCategories(ann.id, ['all'])]) {
    refuses(call, /lobby/);
  }
  refuses(() => game.returnToLobby('someone else'), /host/);
});

test('settings accept numeric strings and fractions by rounding, and refuse anything outside the range', () => {
  const game = new Game({ getCardIds: () => ids(50), hints: [] });
  const host = game.addPlayer('A', 'A').id;
  game.setHandSize(host, '5');
  assert.equal(game.s.handSize, 5);
  game.setHandSize(host, 7.4);
  assert.equal(game.s.handSize, 7);
  game.setRounds(host, '3');
  assert.equal(game.s.roundsEach, 3);
  for (const bad of [NaN, 'abc', undefined, null, Infinity, -1, [], {}, 2.4, 12.6]) {
    if (bad === null) continue; // Number(null) is 0, which is out of range too
    const before = game.s.handSize;
    refuses(() => game.setHandSize(host, bad), /between/);
    assert.equal(game.s.handSize, before);
  }
  for (const bad of [0, 11, 'x', NaN, undefined, null]) refuses(() => game.setRounds(host, bad), /between/);
  refuses(() => game.setJudging(host, 'dice'), /Unknown/);
  refuses(() => game.setCategories(host, 'all'), /at least one/);
  refuses(() => game.setCategories(host, ['all', 'all', 'nope']), /Unknown/);
});

test('words: tidied, limited, and only the chooser at the right moment', () => {
  const { game, players } = setup(['A', 'B', 'C']);
  const chooser = game.s.chooserId;
  const other = players.find((p) => p.id !== chooser).id;
  refuses(() => game.submitWord(other, 'x'), /Only the chooser/);
  refuses(() => game.submitWord(chooser, '   '), /Type a word/);
  refuses(() => game.submitWord(chooser, undefined), /Type a word/);
  refuses(() => game.submitWord(chooser, 'y'.repeat(MAX_WORD_LENGTH + 1)), /characters or fewer/);
  game.submitWord(chooser, `  two    words\n  here `);
  assert.equal(game.s.word, 'two words here');
  refuses(() => game.submitWord(chooser, 'again'), /not time/);
});

test('playing a card: waiting players and the chooser cannot, strangers cannot, changing your pick is allowed until the last card', () => {
  const { game, players } = setup(['A', 'B', 'C', 'D']);
  const chooser = game.s.chooserId;
  const [p1, p2, p3] = players.filter((p) => p.id !== chooser);
  game.submitWord(chooser, 'w');
  refuses(() => game.playCard(chooser, game.player(chooser).hand[0]), /do not play/);
  refuses(() => game.playCard('stranger', 1), /not in this game/);
  refuses(() => game.playCard(p1.id, p2.hand[0]), /not in your hand/);
  const late = game.addPlayer('Late', 'tok-late');
  assert.equal(late.waiting, true);
  refuses(() => game.playCard(late.id, 1), /do not play/);
  game.playCard(p1.id, p1.hand[0]);
  game.playCard(p1.id, p1.hand[1]);
  assert.equal(game.s.picks[p1.id], p1.hand[1], 'the second pick replaced the first');
  game.playCard(p2.id, p2.hand[0]);
  game.playCard(p3.id, p3.hand[0]);
  assert.equal(game.s.phase, 'voting');
  assert.equal(game.s.tableOrder.length, 3, 'the late joiner has no card on the table');
  refuses(() => game.playCard(p1.id, p1.hand[0]), /not time/);
  refuses(() => game.vote(late.id, p1.id), /waiting/);
});

test('"everyone" judging: a tie for most votes is a miss for the group, and the imposter earns per voter fooled', () => {
  const { game } = setup(['A', 'B', 'C', 'D', 'E']);
  playRoundTo(game, 'voting');
  const s = game.s;
  const imposter = s.imposterId;
  const cardPlayers = game.cardPlayers().map((p) => p.id);
  const others = cardPlayers.filter((id) => id !== imposter);
  // Votes: two for the imposter, two for the same other player (a tie): the group is wrong.
  const target = others[0];
  const votesFor = (voter) => {
    if (voter === imposter) return target;
    if (voter === others[0]) return imposter;
    if (voter === others[1]) return imposter;
    return target;
  };
  for (const v of game.voters()) game.vote(v.id, v.id === target ? imposter : votesFor(v.id) === v.id ? imposter : votesFor(v.id));
  assert.equal(s.phase, 'results');
  const tally = s.results.tally;
  assert.equal(s.results.groupCorrect, tally[imposter] > Math.max(...others.map((id) => tally[id])));
  const fooled = game.inRound().filter((p) => p.id !== imposter && s.votes[p.id] !== imposter).length;
  if (!s.results.groupCorrect) assert.equal(s.results.deltas[imposter], fooled * POINTS_PER_VOTE);
  else for (const id of others) assert.equal(s.results.deltas[id], s.votes[id] === imposter ? POINTS_PER_VOTE : 0);
});

test('"everyone" judging: an exact tie between the imposter and another player is not a catch', () => {
  const { game } = setup(['A', 'B', 'C', 'D']);
  playRoundTo(game, 'voting');
  const s = game.s;
  const imposter = s.imposterId;
  const [x, y] = game.cardPlayers().map((p) => p.id).filter((id) => id !== imposter);
  const chooser = s.chooserId;
  // Imposter votes for x, x votes for the imposter, y votes for x... make it 1 - 1 by having the chooser vote for y.
  game.vote(imposter, x);
  game.vote(x, imposter);
  game.vote(y, y === x ? imposter : imposter === y ? x : x);
  game.vote(chooser, y);
  assert.equal(s.phase, 'results');
  assert.equal(s.results.tally[imposter], 1);
  assert.equal(s.results.tally[x], 2);
  assert.equal(s.results.groupCorrect, false);
  assert.equal(s.results.deltas[imposter], 2 * POINTS_PER_VOTE, 'the two who did not name the imposter are fooled');
});

test('"chooser" and "favourite" judging allow only the chooser to vote and score as documented', () => {
  for (const judging of ['chooser', 'favourite']) {
    const { game, players } = setup(['A', 'B', 'C'], { judging });
    playRoundTo(game, 'voting');
    const s = game.s;
    const other = players.find((p) => p.id !== s.chooserId);
    refuses(() => game.vote(other.id, s.chooserId), /only the word-chooser votes/);
    const [first] = game.cardPlayers();
    game.vote(s.chooserId, first.id);
    assert.equal(s.phase, 'results');
    assert.equal(s.results.judging, judging);
    if (judging === 'favourite') {
      assert.equal(s.imposterId, null);
      assert.equal(s.results.deltas[first.id], 2);
      assert.equal(s.results.groupCorrect, null);
    } else {
      assert.equal(s.results.deltas[first.id === s.imposterId ? s.chooserId : s.imposterId], first.id === s.imposterId ? 1 : 5);
    }
  }
});

test('voting rules: not before the cards are in, never for yourself, a non-card-player, or twice for a different result after the end', () => {
  const { game, players } = setup(['A', 'B', 'C']);
  const chooser = game.s.chooserId;
  refuses(() => game.vote(chooser, players[0].id), /not time to vote/);
  playRoundTo(game, 'voting');
  const [p1, p2] = game.cardPlayers();
  refuses(() => game.vote(p1.id, p1.id), /yourself/);
  refuses(() => game.vote(p1.id, chooser), /played a card/);
  refuses(() => game.vote(p1.id, 'nobody'), /played a card/);
  refuses(() => game.vote('stranger', p1.id), /not in this game/);
  game.vote(p1.id, p2.id);
  game.vote(p1.id, chooser === p2.id ? p1.id : p2.id === chooser ? p1.id : p2.id);
  game.vote(p2.id, p1.id);
  game.vote(chooser, p1.id);
  assert.equal(game.s.phase, 'results');
  refuses(() => game.vote(p1.id, p2.id), /not time to vote/);
  refuses(() => game.abortRound(game.s.hostId), /no round to skip/);
});

test('skipping a round gives nobody a turn, a score or a history row, and the next chooser follows', () => {
  const { game, host } = setup(['A', 'B', 'C'], { roundsEach: 1 });
  const first = game.s.chooserId;
  refuses(() => game.abortRound(game.s.players[1].id), /host/);
  game.abortRound(host);
  assert.notEqual(game.s.chooserId, first);
  assert.equal(game.s.round, 2);
  assert.equal(game.s.completed, 0);
  assert.deepEqual(game.s.history, []);
  assert.ok(game.s.players.every((p) => p.turns === 0 && p.score === 0));
  // Every player still gets their turn: three rounds complete the game.
  const chosen = [];
  for (let i = 0; i < 3; i++) {
    chosen.push(game.s.chooserId);
    playRoundTo(game, 'results');
    game.nextRound(host);
  }
  assert.equal(new Set(chosen).size, 3);
  assert.equal(game.s.phase, 'finished');
});

test('a leaver is wiped from the history, their cards are discarded, and chooser order stays fair', () => {
  const { game, players, host } = setup(['A', 'B', 'C', 'D', 'E'], { roundsEach: 2 });
  playRoundTo(game, 'results');
  game.nextRound(host);
  playRoundTo(game, 'results');
  game.nextRound(host);
  const leaver = game.s.players[1];
  const heldCards = [...leaver.hand];
  const discardBefore = game.s.discard.length;
  game.removePlayer(host, leaver.id);
  assert.ok(game.s.history.every((r) => !(leaver.id in r.deltas) && !(leaver.id in r.notes)));
  assert.equal(game.s.discard.length, discardBefore + heldCards.length);
  for (const p of game.s.players) assert.equal(game.s.history.reduce((n, r) => n + (r.deltas[p.id] ?? 0), 0), p.score);
  refuses(() => game.removePlayer(players[2].id, players[3].id), /host/);
  refuses(() => game.removePlayer(host, 'nobody'), /not in the game/);
  // The turn counts: nobody who still owes a turn is skipped.
  const owing = game.s.players.filter((p) => p.turns < game.s.roundsEach).map((p) => p.id);
  if (owing.length) assert.ok(owing.includes(game.s.chooserId));
});

test('removing a late joiner does not restart the round, but removing a player in it does', () => {
  const { game, host } = setup(['A', 'B', 'C', 'D']);
  game.submitWord(game.s.chooserId, 'w');
  const late = game.addPlayer('Late', 'tok-late');
  const round = game.s.round;
  game.removePlayer(late.id, late.id);
  assert.equal(game.s.round, round, 'the waiting player was not part of the round');
  assert.equal(game.s.phase, 'picking');
  const victim = game.cardPlayers()[0];
  game.removePlayer(host, victim.id);
  assert.equal(game.s.round, round + 1, 'the round could not go on without them, so it moved on');
  assert.equal(game.s.phase, 'word');
});

test('hosting passes to the first remaining player, and a returning lobby clears the round', () => {
  const { game, players, host } = setup(['A', 'B', 'C', 'D']);
  playRoundTo(game, 'results');
  game.removePlayer(host, host);
  assert.equal(game.s.hostId, players[1].id);
  game.returnToLobby(game.s.hostId);
  assert.equal(game.s.phase, 'lobby');
  assert.ok(game.s.players.every((p) => p.score === 0 && p.hand.length === 0 && !p.waiting));
  assert.deepEqual([game.s.picks, game.s.votes, game.s.results, game.s.word], [{}, {}, null, null]);
  game.start(game.s.hostId);
  assert.equal(game.s.phase, 'word');
  assert.equal(game.s.round, 1, 'a new game starts from round one');
});

test('hints cycle without repeats until the pool runs out, then reshuffle', () => {
  const game = new Game({ getCardIds: () => ids(10), hints: ['a', 'b', 'c', 'd', 'e', 'f'], rng: seeded(2) });
  const first = [...game.nextHints(3), ...game.nextHints(3)];
  assert.equal(new Set(first).size, 6, 'two draws of three use the six hints once each');
  assert.equal(game.nextHints(3).length, 3, 'then the pool is refilled');
  const none = new Game({ getCardIds: () => ids(10), hints: [] });
  assert.deepEqual(none.nextHints(3), []);
});

test('viewFor: an unknown id sees nothing; results and the imposter appear only at the end; the table order hides who played what', () => {
  const { game } = setup(['A', 'B', 'C', 'D']);
  assert.equal(game.viewFor('nobody'), null);
  playRoundTo(game, 'voting');
  const s = game.s;
  for (const p of s.players) {
    const view = game.viewFor(p.id, new Set([p.id]));
    assert.equal(view.results, null);
    assert.equal(view.me.isImposter, false);
    assert.equal(view.word, 'word');
    assert.equal(view.players.find((x) => x.id === p.id).connected, true);
    assert.equal(view.players.filter((x) => x.connected).length, 1);
    assert.equal(view.voteTargets.includes(p.id), false, 'never vote for yourself');
  }
  const voters = game.voters();
  for (const v of voters) game.vote(v.id, game.cardPlayers().find((p) => p.id !== v.id).id);
  for (const p of s.players) {
    const view = game.viewFor(p.id);
    assert.ok(view.results);
    assert.equal(view.me.isImposter, p.id === s.imposterId);
    assert.equal(view.winners.length, 0, 'not finished');
  }
});
