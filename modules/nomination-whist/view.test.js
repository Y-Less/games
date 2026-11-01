// What viewFor sends (see game.js) along whole seeded games of computers: the same views every time for a seed, a
// standard scoreboard whose `current` flag follows the turn (the site's "Take your time" clock reads it), nothing for a
// stranger, and a fixed set of parts. (These used to pin a SHA-1 of every view, which also pinned every computer
// decision and every field, so a legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
function recordedViews(seed, settings) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const person = room.seats[0];
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  room.seats[0] = { kind: 'bot', id: 'bot:90', name: person.name, ai: room.seats[1].ai };
  for (let guard = 0; guard < 20000 && room.phase !== 'finished'; guard++) {
    look();
    if (room.phase === 'roundEnd') game.forceNextRound(room, rng);
    else if (!game.runPending(room, rng)) break;
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

for (const [label, seed, settings] of [
  ['four-player short game', 31, { seats: 4, length: 'short' }],
  ['five-player game with Jokers', 32, { seats: 5, length: 'short', jokers: true }],
]) {
  test(`the views of a ${label} are the same every time for a seed, with a standard scoreboard and no cards for a stranger`, () => {
    const first = recordedViews(seed, settings);
    assert.equal(first.finished, true);
    assert.deepEqual(recordedViews(seed, settings).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 50, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      if (view.you === -1) assert.equal(view.hand?.length ?? 0, 0, 'a stranger is sent no cards');
      assert.equal(view.scoreboard.players.length, view.seats.filter(Boolean).length, 'every seat is on the scoreboard');
      if (['nominating', 'playing'].includes(view.phase) && view.turn !== null) assert.deepEqual(view.scoreboard.players.filter((p) => p.current).map((p) => p.id), [view.turn], 'current follows the turn');
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'settings', 'seats', 'rounds', 'scoreboard', 'winners', 'instantWin', 'limits']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'settings', 'seats', 'rounds', 'scoreboard', 'winners', 'instantWin', 'limits', 'round', 'hand', 'trick', 'trickWinner', 'lastTrick', 'turn', 'forbidden', 'suggestion', 'legal']);
});
