// What Game.viewFor sends, for each seat and for a stranger, along whole seeded games with computer players: the same
// views every time for a seed, nothing for a stranger, and a fixed set of parts.  (These used to pin a SHA-1 of every view,
// which also pinned every computer decision and every field, so a legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from './game.js';
import { cards, recordedViews, seededRng } from './views.js';

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
      if (view === null) continue; // a stranger is sent nothing
      assert.equal(typeof view.phase, 'string');
      for (const p of view.scoreboard.players) assert.ok(p.bot ? p.userId === undefined : Number.isInteger(p.userId), 'people carry their account id, computers none');
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const game = new Game({ getCardIds: () => cards(400), hints: [], rng: seededRng(1) });
  const host = game.addPlayer('Host', 'user:1');
  assert.deepEqual(Object.keys(game.viewFor(host.id)), ['phase', 'round', 'roundsEach', 'completedRounds', 'totalRounds', 'winners', 'handSize', 'chooserId', 'hostId', 'minPlayers', 'maxPlayers', 'pointsPerVote', 'pointsChooserCorrect', 'pointsFooledChooser', 'pointsFavourite', 'judging', 'categories', 'availableCards', 'drawCount', 'discardCount', 'word', 'wordHidden', 'me', 'players', 'scoreboard', 'table', 'voteTargets', 'results']);
  assert.equal(game.viewFor('stranger'), null);
});
