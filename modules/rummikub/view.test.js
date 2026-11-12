// What viewFor sends (see game.js) along whole seeded games: the same views every time for a seed, every seat on the
// scoreboard, and a fixed set of parts.  (These used to pin a SHA-1 of every view, which also pinned every computer
// decision and every field, so a legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';
import { NOW, recordedViews } from './views.js';

// Everything a seat shows the table (game.js seatView).  A seat that carries anything else is carrying its holder's
// tiles, which belong to nobody but them.
const SEAT_SHOWS = ['seat', 'name', 'bot', 'ai', 'online', 'score', 'count', 'melded', 'ready'];

for (const [label, record] of [
  ['two-round game for three', () => recordedViews(41, 3, { rounds: 2 })],
  ['one-round game for two', () => recordedViews(42, 2, {})],
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
      // The racks and the pool are the only secrets (game.js:8), and a tile is a plain number, so there is no
      // distinctive identifier to scan for the way there is for a card or a die.  What can be checked, and what a
      // change to where a player's state lives would break, is that a seat shows counts and never contents: no list
      // of tiles may hang off a seat, and a stranger holds nothing at all.
      for (const seat of view.seats) {
        if (!seat) continue;
        for (const [key, value] of Object.entries(seat)) {
          assert.ok(SEAT_SHOWS.includes(key), `a seat was sent "${key}", which is not one of the things a seat shows`);
          assert.ok(!Array.isArray(value), `a seat was sent a list of ${key}: seats show counts, not contents`);
        }
      }
      if (view.you === -1) assert.deepEqual(view.rack ?? [], [], 'a stranger holds no tiles');
      assert.ok(!text.includes('"pool"'), 'the pool is never sent, in any order');
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: NOW });
  assert.deepEqual(Object.keys(game.viewFor(room, 1, { now: NOW })), ['code', 'phase', 'you', 'hostSeat', 'size', 'playing', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'deal', 'log']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3), NOW);
  assert.deepEqual(Object.keys(game.viewFor(room, 1, { now: NOW })), ['code', 'phase', 'you', 'hostSeat', 'size', 'playing', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'deal', 'log', 'round', 'first', 'turn', 'version', 'table', 'poolCount', 'rack', 'drawn', 'lastPlay', 'remaining', 'lastRound', 'final']);
});
