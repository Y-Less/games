// What viewFor sends (see game.js) along whole seeded games: the same views every time for a seed, nothing hidden shown
// to a stranger, and a fixed set of parts. (These used to pin a SHA-1 of every view, which also pinned every computer
// decision and every field, so a legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
function recordedViews(seed, seats, target) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, target }, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  // Seat 0 stays a person (so that their own hand and crib are shown); the computer's judgement plays for them.
  for (let guard = 0; guard < 5000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'show') game.ready(room, 0, rng);
    else {
      const pending = game.pendingBot(room);
      if (pending) game.botMove(room, rng);
      else if (room.phase === 'discard') {
        const seat = room.seats.findIndex((s) => !s.discarded);
        const need = room.hands[seat].length - 4;
        assert.equal(game.discard(room, seat, room.hands[seat].slice(0, need), rng).ok, true);
      } else if (room.phase === 'play') {
        const legal = game.playableCards(room, room.play.turn);
        const outcome = game.playCard(room, room.play.turn, legal[0]);
        assert.equal(outcome.ok, true, outcome.error);
      } else break;
    }
    look();
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

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
