// What viewFor sends, for each player and for somebody who is not in the room, along whole seeded games with computer
// players: the same views every time for a seed, nothing secret for an outsider, and a fixed set of parts.  (These used
// to pin a SHA-1 of every view, which also pinned every computer decision and every field, so a legitimate change broke
// them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { rulesWith } from './harness.js';
import { cards, recordedViews } from './views.js';

const describeJudging = { everyone: 'everyone judges', chooser: 'the chooser judges', favourite: 'favourites are picked' };

for (const [judging, seed] of [
  ['everyone', 91],
  ['chooser', 92],
  ['favourite', 93],
]) {
  test(`the views of a game where ${describeJudging[judging]} are the same every time for a seed, and say who is an account`, () => {
    const first = recordedViews(judging, seed);
    assert.equal(first.finished, true);
    assert.deepEqual(recordedViews(judging, seed).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 50, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      assert.equal(typeof view.phase, 'string');
      for (const p of view.scoreboard.players) assert.ok(p.bot ? p.userId === undefined : Number.isInteger(p.userId), 'people carry their account id, computers none');
    }
  });
}

test('a view lists its parts in a fixed order, and an outsider is shown nothing of their own', () => {
  const game = rulesWith({ getCardIds: () => cards(400), hints: [] });
  const room = game.createRoom({ code: 'one-two-three', hostId: 1, hostName: 'Host', now: 0 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'you', 'phase', 'turn', 'rounds', 'completedTurns', 'totalTurns', 'completedRounds', 'handSize', 'chooserId', 'hostId', 'minPlayers', 'maxPlayers', 'size', 'pointsPerVote', 'pointsChooserCorrect', 'pointsFooledChooser', 'pointsFavourite', 'judging', 'categories', 'availableCards', 'drawCount', 'discardCount', 'word', 'wordHidden', 'me', 'players', 'scoreboard', 'table', 'voteTargets', 'results']);
  const outsider = game.viewFor(room, 'nobody');
  assert.deepEqual(Object.keys(outsider), Object.keys(game.viewFor(room, 1)), 'the same parts, so the client never meets a missing one');
  assert.deepEqual(outsider.me, { isChooser: false, hand: [], myPick: null, myVote: null, isImposter: false });
  assert.equal(outsider.players.some((p) => p.id === outsider.you), false, 'and they are nobody at the table');
  assert.deepEqual(outsider.voteTargets, []);
});

test('somebody who is not in the room is never told a word that is still being played for', () => {
  const game = rulesWith({ getCardIds: () => cards(400), hints: [] });
  const rng = () => 0.5;
  const room = game.createRoom({ code: 'four-five-six', hostId: 1, hostName: 'Host', now: 0 });
  game.fillWithBots(room, 1, 3);
  assert.equal(game.start(room, 1, rng).ok, true);
  assert.equal(game.submitWord(room, room.chooserId, 'lighthouse', rng).ok, true);
  assert.equal(room.phase, 'picking');
  assert.equal(game.viewFor(room, 'nobody').word, null, 'an outsider is not handed the word the imposter is kept from');
});
