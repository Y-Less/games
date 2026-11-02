// What viewFor sends (see game.js) for each person and a stranger along whole seeded games with computers: the same views
// every time for a seed, a scoreboard that lists everybody and marks only those the game is waiting for, and a fixed set of
// parts.  (These used to pin a SHA-1 of every view, which also pinned every computer decision and every field, so a
// legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { recordedViews } from './views.js';

const WAITING_PHASES = ['guessing1', 'guessing2'];

for (const [label, args] of [
  ['four-player game', [111, 4, 1]],
  ['three-player game of two turns each', [112, 3, 2]],
]) {
  test(`the views of a ${label} are the same every time for a seed, and the scoreboard says whom the game waits for`, () => {
    const first = recordedViews(...args);
    assert.equal(first.finished, true);
    assert.deepEqual(recordedViews(...args).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 30, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      if (view === null || view.you === undefined) continue; // a stranger
      assert.equal(view.scoreboard.players.length, view.players.length, 'every player is on the scoreboard');
      const current = view.scoreboard.players.filter((p) => p.current);
      if (!WAITING_PHASES.includes(view.phase)) assert.deepEqual(current, [], `nobody is to act in ${view.phase}`);
      else assert.ok(current.length >= 1, `somebody is to act in ${view.phase}`);
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostId', 'turnsEach', 'turn', 'turnsTotal', 'hinter', 'tint', 'hints', 'guesses', 'result', 'players', 'scoreboard', 'colours', 'canCustomColour', 'limits']);
});
