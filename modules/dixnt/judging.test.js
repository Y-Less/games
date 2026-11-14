import test from 'node:test';
import assert from 'node:assert/strict';
import { CHOOSER_CORRECT_POINTS, CHOOSER_FOOLED_POINTS } from './game.js';
import { makeRoom, range, rulesWith } from './harness.js';

const CATEGORIES = [
  { key: 'fantasy', label: 'Fantasy', description: 'Dragons', ids: range(10001, 40) },
  { key: 'food', label: 'Food', description: 'Feasts', ids: range(80001, 40) },
  { key: 'games', label: 'Games', description: 'Dice', ids: range(70001, 10) },
];

const lobby = (names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'], options = {}) => makeRoom(names, { categories: CATEGORIES, seed: 11, ...options });

/** Starts the game and plays every card, leaving it in the voting phase. */
function toVoting({ game, room, rng }) {
  assert.equal(game.start(room, 1, rng).ok, true);
  game.submitWord(room, room.chooserId, 'borrowed light', rng);
  for (const p of game.cardPlayers(room)) game.playCard(room, p.id, p.hand[0], rng);
  assert.equal(room.phase, 'voting');
  const imposter = game.playerOf(room, room.imposterId);
  const chooser = game.playerOf(room, room.chooserId);
  const others = game.cardPlayers(room).filter((p) => p.id !== imposter.id);
  return { imposter, chooser, others };
}

test('chooser-only judging: spotting the imposter scores the chooser a point and nobody else', () => {
  const made = lobby(undefined, { judging: 'chooser' });
  const { game, room } = made;
  const { imposter, chooser, others } = toVoting(made);

  game.vote(room, chooser.id, imposter.id);
  assert.equal(room.phase, 'results', 'the round ends as soon as the chooser has voted');
  const r = room.results;
  assert.equal(r.judging, 'chooser');
  assert.equal(r.groupCorrect, true);
  assert.equal(r.deltas[chooser.id], CHOOSER_CORRECT_POINTS);
  assert.equal(CHOOSER_CORRECT_POINTS, 1);
  assert.equal(r.deltas[imposter.id], 0);
  for (const p of others) assert.equal(r.deltas[p.id], 0);
});

test('chooser-only judging: fooling the chooser scores the imposter 5', () => {
  const made = lobby(undefined, { judging: 'chooser' });
  const { game, room } = made;
  const { imposter, chooser, others } = toVoting(made);

  game.vote(room, chooser.id, others[0].id);
  const r = room.results;
  assert.equal(r.groupCorrect, false);
  assert.equal(r.deltas[imposter.id], CHOOSER_FOOLED_POINTS);
  assert.equal(CHOOSER_FOOLED_POINTS, 5);
  assert.equal(game.playerOf(room, imposter.id).score, 5);
  assert.equal(game.playerOf(room, chooser.id).score, 0);
});

test('chooser-only judging: nobody else can vote and they are not offered vote targets', () => {
  const made = lobby(undefined, { judging: 'chooser' });
  const { game, room } = made;
  const { imposter, chooser, others } = toVoting(made);

  assert.equal(game.vote(room, others[0].id, imposter.id).error, 'chooserOnlyVotes');
  assert.equal(game.vote(room, imposter.id, others[0].id).error, 'chooserOnlyVotes');
  assert.equal(game.viewFor(room, others[0].id).voteTargets.length, 0);
  assert.equal(game.viewFor(room, chooser.id).voteTargets.length, 4, 'the chooser can pick any of the four card players');
  assert.equal(room.phase, 'voting', 'failed votes changed nothing');
});

test('chooser-only judging: the verdict is the chooser\'s and ends the round', () => {
  const made = lobby(undefined, { judging: 'chooser' });
  const { game, room } = made;
  const { imposter, chooser } = toVoting(made);
  game.vote(room, chooser.id, imposter.id);
  assert.equal(room.phase, 'results');
  assert.equal(game.vote(room, chooser.id, imposter.id).error, 'notTimeToVote', 'no voting once the round is over');
});

test('everyone judging is still the default and works as before', () => {
  const made = lobby();
  const { game, room } = made;
  assert.equal(room.judging, 'everyone');
  const { imposter, chooser, others } = toVoting(made);
  game.vote(room, chooser.id, imposter.id);
  assert.equal(room.phase, 'voting', 'still waiting for the other players');
  game.vote(room, others[0].id, imposter.id);
  game.vote(room, others[1].id, imposter.id);
  game.vote(room, others[2].id, others[0].id);
  game.vote(room, imposter.id, others[0].id);
  assert.equal(room.results.judging, 'everyone');
  assert.equal(room.results.groupCorrect, true);
});

test('only the host can change the judging method, and only in the lobby', () => {
  const { game, room, rng } = lobby();
  assert.equal(game.setSettings(room, 2, { judging: 'chooser' }).error, 'hostOnly');
  assert.equal(game.setSettings(room, 1, { judging: 'telepathy' }).error, 'unknownJudging');
  assert.equal(game.setSettings(room, 1, { judging: 'chooser' }).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(game.setSettings(room, 1, { judging: 'everyone' }).error, 'settingsBeforeStart');
  assert.equal(game.viewFor(room, 1).judging, 'chooser');
});

test('categories: only cards from the selected categories are ever dealt', () => {
  const { game, room, rng } = lobby();
  assert.equal(game.setSettings(room, 1, { categories: ['food'] }).ok, true);
  assert.equal(game.start(room, 1, rng).ok, true);
  const everything = [...room.draw, ...room.discard, ...room.players.flatMap((p) => p.hand)];
  assert.equal(everything.length, 40);
  assert.ok(everything.every((id) => id >= 80001 && id < 80041), 'every card is a food card');
});

test('categories: several selected categories are combined, in a stable order', () => {
  const { game, room, rng } = lobby();
  game.setSettings(room, 1, { categories: ['games', 'fantasy'] });
  assert.deepEqual(room.categories, ['fantasy', 'games']);
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(room.draw.length + room.players.reduce((n, p) => n + p.hand.length, 0), 50);
});

test('categories: the lobby view lists every category with counts and what is selected', () => {
  const { game, room } = lobby();
  game.setSettings(room, 1, { categories: ['fantasy'] });
  const view = game.viewFor(room, 1);
  assert.deepEqual(
    view.categories.map((c) => [c.key, c.count, c.selected]),
    [['fantasy', 40, true], ['food', 40, false], ['games', 10, false]],
  );
  assert.equal(view.availableCards, 40);
});

test('categories: bad selections are refused, and only the host may choose', () => {
  const { game, room } = lobby();
  assert.equal(game.setSettings(room, 1, { categories: [] }).error, 'needCategory');
  assert.equal(game.setSettings(room, 1, { categories: ['cooking'] }).error, 'unknownCategory');
  assert.equal(game.setSettings(room, 2, { categories: ['food'] }).error, 'hostOnly');
  assert.deepEqual(room.categories, ['fantasy', 'food', 'games'], 'a refused change leaves the selection alone');
});

test('one bad setting in a message leaves every other setting in it alone', () => {
  const { game, room } = lobby();
  assert.equal(game.setSettings(room, 1, { judging: 'chooser', handSize: 99 }).error, 'handSizeRange');
  assert.equal(room.judging, 'everyone', 'the whole message is refused, so the room is never half changed');
});

test('categories: starting needs enough cards in the chosen categories', () => {
  const { game, room, rng } = lobby(['A', 'B', 'C', 'D', 'E', 'F']); // 6 players x 8 cards = 48
  game.setSettings(room, 1, { categories: ['games'] }); // only 10 cards
  assert.equal(game.start(room, 1, rng).error, 'notEnoughCards');
  game.setSettings(room, 1, { categories: ['fantasy', 'food'] });
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(room.phase, 'word');
});

test('categories: settings survive a save and reload, and a vanished category is dropped', () => {
  const { game, room } = lobby();
  game.setSettings(room, 1, { categories: ['food', 'games'], judging: 'chooser' });
  const saved = () => JSON.parse(JSON.stringify(room));

  const reloaded = rulesWith({ getCategories: () => CATEGORIES }).migrate(saved());
  assert.deepEqual(reloaded.categories, ['food', 'games']);
  assert.equal(reloaded.judging, 'chooser');

  const withoutFood = rulesWith({ getCategories: () => CATEGORIES.filter((c) => c.key !== 'food') }).migrate(saved());
  assert.deepEqual(withoutFood.categories, ['games'], 'the missing category is dropped');
  const onlyNew = rulesWith({ getCategories: () => [CATEGORIES[0]] }).migrate(saved());
  assert.deepEqual(onlyNew.categories, ['fantasy'], 'if nothing selected still exists, fall back to everything');
});
