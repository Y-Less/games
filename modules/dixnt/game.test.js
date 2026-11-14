import test from 'node:test';
import assert from 'node:assert/strict';
import { POINTS_PER_VOTE } from './game.js';
import { cards, makeRoom, rulesWith, seededRng } from './harness.js';

/** A started game of the named people (accounts 1, 2, 3 ... in order), with plenty of rounds left to play. */
const makeGame = (names, options = {}) => makeRoom(names, { handSize: 8, rounds: 10, seed: 7, start: true, ...options });

/** Plays a round up to the voting phase and returns who is who. */
function toVoting({ game, room, rng }) {
  assert.equal(game.submitWord(room, room.chooserId, 'lighthouse', rng).ok, true);
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  assert.equal(room.phase, 'voting', 'voting opens as soon as the last card is played');
  const imposter = game.playerOf(room, room.imposterId);
  const others = game.cardPlayers(room).filter((p) => p.id !== imposter.id);
  const chooser = game.playerOf(room, room.chooserId);
  return { imposter, others, chooser };
}

test('start deals a full hand to everyone and picks the first chooser', () => {
  const { game, room } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  assert.equal(room.phase, 'word');
  assert.equal(room.chooserId, 1);
  for (const p of room.players) assert.equal(p.hand.length, 8);
  assert.equal(room.draw.length, 100 - 4 * 8);
  assert.deepEqual(room.players.map((p) => p.id), [1, 2, 3, 4], 'a person is known by their account');
});

test('the imposter sees ??? and nobody else is told who they are', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room, rng } = made;
  game.submitWord(room, room.chooserId, 'lighthouse', rng);
  for (const p of room.players) {
    const view = game.viewFor(room, p.id);
    if (p.id === room.imposterId) {
      assert.equal(view.word, null);
      assert.equal(view.wordHidden, true);
    } else {
      assert.equal(view.word, 'lighthouse');
      assert.equal(view.wordHidden, false);
    }
    // Nothing in the view may reveal who the imposter is before the results.
    assert.equal(view.results, null);
    assert.equal(view.me.isImposter, false);
    assert.ok(!JSON.stringify(view).includes('imposter'.concat('Id')), 'no imposterId field in any view');
  }
  assert.notEqual(room.imposterId, room.chooserId);
});

test("players cannot see each other's hands", () => {
  const { game, room } = makeGame(['Ann', 'Bob', 'Cat']);
  const view = game.viewFor(room, 2);
  assert.deepEqual(view.me.hand, game.playerOf(room, 2).hand);
  assert.ok(!view.players.some((p) => 'hand' in p), 'no hand is listed beside anybody else');
  assert.ok(!JSON.stringify(view.players).includes('"hand"'));
});

test('the chooser cannot play a card and only the chooser can set the word', () => {
  const { game, room, rng } = makeGame(['Ann', 'Bob', 'Cat']);
  assert.equal(game.submitWord(room, 2, 'x', rng).error, 'chooserOnlyWord');
  assert.equal(game.submitWord(room, 1, 'x', rng).ok, true);
  assert.equal(game.playCard(room, 1, game.playerOf(room, 1).hand[0], rng).error, 'notPlayingThisTurn');
  assert.equal(game.playCard(room, 2, 9999, rng).error, 'notInHand');
});

test('cards are revealed only once everyone has played', () => {
  const { game, room, rng } = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  game.submitWord(room, 1, 'x', rng);
  game.playCard(room, 2, game.playerOf(room, 2).hand[0], rng);
  game.playCard(room, 3, game.playerOf(room, 3).hand[0], rng);
  assert.equal(game.viewFor(room, 2).table.length, 0);
  game.playCard(room, 4, game.playerOf(room, 4).hand[0], rng);
  const view = game.viewFor(room, 2);
  assert.equal(room.phase, 'voting');
  assert.equal(view.table.length, 3);
  assert.equal(view.word, 'x', 'the word is revealed to everyone, including the imposter');
  assert.equal(game.viewFor(room, room.imposterId).word, 'x');
});

test('the round only ends once everyone has voted, and votes can be changed until then', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room } = made;
  const { imposter, others, chooser } = toVoting(made);
  game.vote(room, chooser.id, others[0].id);
  game.vote(room, others[0].id, imposter.id);
  game.vote(room, others[0].id, others[1].id); // changed their mind
  game.vote(room, others[1].id, imposter.id);
  assert.equal(room.phase, 'voting', 'one vote still missing');
  assert.equal(game.viewFor(room, chooser.id).players.filter((p) => p.hasVoted).length, 3);
  game.vote(room, imposter.id, others[0].id);
  assert.equal(room.phase, 'results');
  assert.equal(room.results.votes[others[0].id], others[1].id, 'the changed vote is the one that counted');
});

test('cannot vote for yourself, the chooser, or when it is not voting time', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room } = made;
  assert.equal(game.vote(room, 2, 3).error, 'notTimeToVote');
  const { chooser, others } = toVoting(made);
  assert.equal(game.vote(room, others[0].id, others[0].id).error, 'voteSelf');
  assert.equal(game.vote(room, others[0].id, chooser.id).error, 'voteCardPlayer');
});

test('group correct: only those who found the imposter score a point', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
  const { game, room } = made;
  const { imposter, others, chooser } = toVoting(made);
  game.vote(room, chooser.id, imposter.id);
  game.vote(room, others[0].id, imposter.id);
  game.vote(room, others[1].id, others[2].id); // wrong guess
  game.vote(room, others[2].id, others[1].id); // wrong guess
  game.vote(room, imposter.id, others[0].id);
  const r = room.results;
  assert.equal(r.groupCorrect, true);
  assert.equal(r.deltas[chooser.id], POINTS_PER_VOTE);
  assert.equal(r.deltas[others[0].id], POINTS_PER_VOTE);
  assert.equal(r.deltas[others[1].id], 0);
  assert.equal(r.deltas[others[2].id], 0);
  assert.equal(r.deltas[imposter.id], 0);
  assert.equal(room.phase, 'results');
  assert.equal(game.viewFor(room, imposter.id).results.imposterId, imposter.id);
});

test('group wrong: the imposter scores a point per voter who missed them', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
  const { game, room } = made;
  const { imposter, others, chooser } = toVoting(made);
  game.vote(room, chooser.id, others[0].id);
  game.vote(room, others[0].id, others[1].id);
  game.vote(room, others[1].id, others[0].id);
  game.vote(room, others[2].id, others[0].id);
  game.vote(room, imposter.id, others[0].id);
  const r = room.results;
  assert.equal(r.groupCorrect, false);
  // 4 non-imposter voters, none chose the imposter
  assert.equal(r.deltas[imposter.id], 4 * POINTS_PER_VOTE);
  assert.equal(game.playerOf(room, imposter.id).score, 4);
});

test('a tie for most votes counts as the group being wrong', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan', 'Eve']);
  const { game, room } = made;
  const { imposter, others, chooser } = toVoting(made);
  // imposter 2 (chooser, o0), o1 2 (o2, imposter), o0 1 (o1): the imposter ties for most votes
  game.vote(room, chooser.id, imposter.id);
  game.vote(room, others[0].id, imposter.id);
  game.vote(room, others[1].id, others[0].id);
  game.vote(room, others[2].id, others[1].id);
  game.vote(room, imposter.id, others[1].id);
  const r = room.results;
  assert.deepEqual([r.tally[imposter.id], r.tally[others[1].id]], [2, 2]);
  assert.equal(r.groupCorrect, false, 'the chooser has no casting vote');
  // 4 non-imposter voters; two found the imposter, two were fooled
  assert.equal(r.deltas[imposter.id], 2 * POINTS_PER_VOTE);
  assert.equal(r.deltas[chooser.id], 0, 'finding the imposter earns nothing when the group is wrong');
});

test('the imposter with strictly the most votes means the group is correct', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room } = made;
  const { imposter, others, chooser } = toVoting(made);
  // imposter 2 (chooser, o1), o1 1 (o0), o0 1 (imposter)
  game.vote(room, chooser.id, imposter.id);
  game.vote(room, others[0].id, others[1].id);
  game.vote(room, others[1].id, imposter.id);
  game.vote(room, imposter.id, others[0].id);
  const r = room.results;
  assert.equal(r.groupCorrect, true);
  assert.equal(r.deltas[chooser.id], POINTS_PER_VOTE);
  assert.equal(r.deltas[others[1].id], POINTS_PER_VOTE);
  assert.equal(r.deltas[others[0].id], 0);
});

test('next round: next player chooses, played cards are discarded, everyone draws back up', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room, rng } = made;
  const { imposter, others, chooser } = toVoting(made);
  const played = Object.values(room.picks);
  for (const p of [chooser, ...others]) game.vote(room, p.id, imposter.id);
  game.vote(room, imposter.id, others[0].id);
  assert.equal(room.phase, 'results');
  game.nextTurn(room, 4, rng);
  assert.equal(room.phase, 'word');
  assert.equal(room.turn, 2);
  assert.equal(room.chooserId, 2, 'chooser rotates in order');
  for (const p of room.players) assert.equal(p.hand.length, 8);
  for (const c of played) {
    assert.ok(room.discard.includes(c));
    assert.ok(room.players.every((p) => !p.hand.includes(c)));
  }
  assert.equal(room.discard.length, 3);
});

test('chooser wraps around after the last player', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  const chosen = [];
  for (let round = 0; round < 4; round++) {
    chosen.push(room.chooserId);
    const { imposter, others, chooser } = toVoting(made);
    for (const v of [chooser, ...others]) game.vote(room, v.id, imposter.id);
    game.vote(room, imposter.id, others[0].id);
    game.nextTurn(room, 1, rng);
  }
  assert.deepEqual(chosen, [1, 2, 3, 1]);
});

test('discard pile is reshuffled when the draw pile runs out and no card is duplicated or lost', () => {
  // 3 players x 8 = 24 cards in hand; only 30 cards, so the draw pile empties quickly.
  const made = makeGame(['Ann', 'Bob', 'Cat'], { cardCount: 30 });
  const { game, room, rng } = made;
  for (let round = 0; round < 12; round++) {
    const { imposter, others, chooser } = toVoting(made);
    for (const v of [chooser, ...others]) game.vote(room, v.id, imposter.id);
    game.vote(room, imposter.id, others[0].id);
    game.nextTurn(room, 1, rng);
    const all = [...room.draw, ...room.discard, ...room.players.flatMap((p) => p.hand)];
    assert.equal(all.length, 30);
    assert.equal(new Set(all).size, 30);
    for (const p of room.players) assert.equal(p.hand.length, 8);
  }
});

test('somebody arriving at a game under way takes a computer player\'s place, cards and all', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat'], { bots: 1 });
  const { game, room, rng } = made;
  const bot = room.players.find((p) => p.kind === 'bot');
  const hand = [...bot.hand];
  game.submitWord(room, room.chooserId, 'lighthouse', rng);

  assert.equal(game.addHuman(room, 9, 'Late').ok, true);
  assert.equal(room.players.length, 4, 'no new place is made: they take the computer player\'s');
  const late = game.playerOf(room, 9);
  assert.equal(late.kind, 'human');
  assert.equal(late.name, 'Late');
  assert.deepEqual(late.hand, hand, 'the hand comes with the place');
  assert.equal(late.ai, undefined, 'the computer player stops playing it');
  assert.equal(game.viewFor(room, 9).me.hand.length, 8);
});

test('a game of nothing but people is full, and the person coming back gets their own place', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat']);
  const { game, room, rng } = made;
  game.submitWord(room, room.chooserId, 'lighthouse', rng);
  assert.equal(game.addHuman(room, 9, 'Late').error, 'gameFull');

  const left = game.removeHuman(room, 3, rng, 0);
  assert.equal(left.replaced, true, 'a computer player keeps their place warm');
  const stand = room.players[2];
  assert.equal(stand.kind, 'bot');
  assert.equal(stand.stoodInFor, 3);
  assert.equal(game.addHuman(room, 3, 'Cat').ok, true);
  assert.equal(room.players[2].id, 3, 'Cat is back where she was');
  assert.equal(room.players[2].kind, 'human');
});

test('a person who leaves mid-round keeps their card and vote in the computer player\'s hands', () => {
  const made = makeGame(['Ann', 'Bob', 'Cat', 'Dan']);
  const { game, room, rng } = made;
  const { imposter, others, chooser } = toVoting(made);
  const leaver = others.find((p) => p.id !== chooser.id);
  const card = room.picks[leaver.id];
  game.vote(room, leaver.id, imposter.id);

  const left = game.removeHuman(room, leaver.id, rng, 0);
  assert.equal(left.ok, true);
  const bot = room.players.find((p) => p.stoodInFor === leaver.id);
  assert.equal(bot.kind, 'bot');
  assert.ok(bot.ai, 'it is given an AI so it can carry on');
  assert.equal(room.picks[bot.id], card, 'their card is still on the table');
  assert.equal(room.votes[bot.id], imposter.id, 'and their vote still counts');
  assert.ok(!(leaver.id in room.picks) && !(leaver.id in room.votes));
  assert.ok(room.tableOrder.includes(bot.id) && !room.tableOrder.includes(leaver.id));
});

test('only the host can remove others, start and change settings', () => {
  const { game, room, rng } = makeRoom(['A', 'B', 'C'], { cardCount: 50 });
  assert.equal(game.start(room, 2, rng).error, 'hostOnlyStart');
  assert.equal(game.setSettings(room, 2, { handSize: 5 }).error, 'hostOnly');
  assert.equal(game.kick(room, 2, game.playerOf(room, 1).slot, rng, 0).error, 'hostOnlyRemove');
  assert.equal(game.setSettings(room, 1, { handSize: 5 }).ok, true);
  assert.equal(room.handSize, 5);
  assert.equal(game.setSettings(room, 1, { handSize: 1 }).error, 'handSizeRange');
  assert.equal(room.handSize, 5, 'a refused setting leaves the room as it was');
});

test('a name somebody else is using is made unique instead of being refused', () => {
  const { game, room } = makeRoom(['Alex']);
  assert.equal(game.addHuman(room, 2, 'alex').ok, true);
  assert.deepEqual(room.players.map((p) => p.name), ['Alex', 'alex (2)']);
});

test('hints give three different suggestions and cycle through the whole list', () => {
  const { game, room } = makeRoom(['Ann'], { cardCount: 10, hints: cards(9).map(String) });
  const rng = seededRng(2);
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const three = game.nextHints(room, 3, rng);
    assert.equal(new Set(three).size, 3);
    three.forEach((h) => seen.add(h));
  }
  assert.equal(seen.size, 9);
});

test('a room survives a save and reload, and newly created cards join the deck', () => {
  const { game, room, rng } = makeGame(['Ann', 'Bob', 'Cat'], { cardCount: 60 });
  game.submitWord(room, 1, 'x', rng);
  const saved = JSON.parse(JSON.stringify(room));
  const later = rulesWith({ getCardIds: () => cards(70), hints: [] });
  const reloaded = later.migrate(saved, undefined, rng);
  assert.equal(reloaded.phase, 'picking');
  assert.equal(reloaded.draw.length, room.draw.length + 10);
  assert.equal(reloaded.word, 'x');
  assert.deepEqual(reloaded.players.map((p) => p.id), [1, 2, 3]);
});
