// A snapshot of what viewFor sends (see game.js): every view, for a person and a stranger, along whole seeded games of
// computers. The digest was taken before viewFor was split into smaller builders, so splitting it further must not change
// a byte of what is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a two-player game to 61 are exactly as they were', () => {
  const { views, finished } = recordedViews(81, 2, 61);
  assert.equal(finished, true);
  assert.equal(digest(views), 'dcba79bfe80caf399337a34031dca1d38423ea02');
});

test('the views of a three-player game to 61 are exactly as they were', () => {
  const { views, finished } = recordedViews(82, 3, 61);
  assert.equal(finished, true);
  assert.equal(digest(views), '6a9851d4647d72960dd1bae2afef1a4c094d8940');
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  const parts = ['code', 'phase', 'target', 'seatCount', 'you', 'isHost', 'handNo', 'dealer', 'limits', 'skunkLine', 'seats', 'hand', 'need', 'cribCount', 'deckCount', 'starter', 'play', 'show', 'log', 'winner', 'placements', 'scoreboard'];
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), parts);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), parts);
});
