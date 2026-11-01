// What viewFor sends (see game.js) along whole seeded games of computers: the same views every time for a seed, nothing a
// stranger may not see, and a fixed set of parts. (These used to pin a SHA-1 of every view, which also pinned every computer
// decision, so a better AI broke them without any view changing.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
function recordedViews(seats, seed) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats }, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const person = room.seats[0];
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  room.seats[0] = { kind: 'bot', id: 'bot:90', name: person.name, ai: room.seats[1].ai };
  for (let guard = 0; guard < 20000 && room.phase !== 'finished'; guard++) {
    if (!game.runPending(room, rng)) break;
    look();
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

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
