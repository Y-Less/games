// What viewFor sends (see game.js) along whole seeded games of computers: the same views every time for a seed, nothing a
// stranger may not see, and a fixed set of parts.  (These used to pin a SHA-1 of every view, which also pinned every computer
// decision, so a better AI broke them without any view changing.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';
import { recordedViews } from './views.js';

for (const [seats, seed] of [
  [4, 21],
  [6, 22],
]) {
  test(`the views of a ${seats}-player game are the same every time for a seed, and a stranger never gets a hand`, () => {
    const first = recordedViews(seats, seed);
    assert.equal(first.finished, true);
    assert.deepEqual(recordedViews(seats, seed).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 20, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      if (view.you === -1) assert.equal(view.hand?.length ?? 0, 0, 'a stranger is sent no cards');
      else if (view.phase !== 'lobby') assert.ok(Array.isArray(view.hand), 'a person is sent their hand');
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'seatCount', 'decks', 'seats', 'scoreboard', 'winner', 'limits']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'seatCount', 'decks', 'seats', 'scoreboard', 'winner', 'limits', 'hand', 'pile', 'turn', 'plays', 'rank', 'last', 'lastCall', 'canPlay', 'canCall', 'mustRespond']);
});
