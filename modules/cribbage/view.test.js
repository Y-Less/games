// What viewFor sends (see game.js) along whole seeded games: the same views every time for a seed, nothing hidden shown
// to a stranger, and a fixed set of parts.  (These used to pin a SHA-1 of every view, which also pinned every computer
// decision and every field, so a legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';
import { recordedViews } from './views.js';

for (const [seed, seats] of [
  [81, 2],
  [82, 3],
]) {
  test(`the views of a ${seats}-player game to 61 are the same every time for a seed, and a stranger sees no cards`, () => {
    const first = recordedViews(seed, seats, 61);
    assert.equal(first.finished, true);
    assert.deepEqual(recordedViews(seed, seats, 61).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 50, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      if (view.you === -1) assert.equal(view.hand.length, 0, 'a stranger is sent no cards');
      else if (view.phase === 'discard') assert.ok(view.hand.length > 0, 'a person is sent their hand');
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  const parts = ['code', 'phase', 'target', 'seatCount', 'you', 'isHost', 'handNo', 'dealer', 'limits', 'skunkLine', 'seats', 'hand', 'need', 'cribCount', 'deckCount', 'starter', 'play', 'show', 'log', 'winner', 'placements', 'scoreboard'];
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), parts);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), parts);
});
