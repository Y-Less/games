// What viewFor sends (see game.js) along whole seeded games: the same views every time for a seed, every seat on the
// scoreboard, and a fixed set of parts.  (These used to pin a SHA-1 of every view, which also pinned every computer
// decision and every field, so a legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';
import { recordedViews } from './views.js';

for (const [label, record] of [
  ['two-player game', () => recordedViews(71, 2, false)],
  ['three-player game with the unlucky private objectives', () => recordedViews(72, 3, true)],
]) {
  test(`the views of a ${label} are the same every time for a seed, and every seat is on the scoreboard`, () => {
    const first = record();
    assert.equal(first.finished, true);
    assert.deepEqual(record().views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 20, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      assert.equal(view.scoreboard.players.length, view.seats.filter(Boolean).length, 'every seat is on the scoreboard');
      if (view.you !== -1) assert.ok(view.seats[view.you], 'a member is seated where the view says');
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'size', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'log']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  const choosing = Object.keys(game.viewFor(room, 1));
  assert.deepEqual(choosing.slice(0, 11), ['code', 'phase', 'you', 'hostSeat', 'size', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'log']);
  assert.ok(choosing.includes('options') && choosing.includes('chosen'), 'the windows to choose from are offered');
});
