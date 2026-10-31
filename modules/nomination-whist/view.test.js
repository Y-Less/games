// A snapshot of what viewFor sends (see game.js): every view, for a person and a stranger, along whole seeded games of
// computers. The digest was taken before viewFor was split into smaller builders, so splitting it further must not change
// a byte of what is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a four-player short game are exactly as they were', () => {
  const { views, finished } = recordedViews(31, { seats: 4, length: 'short' });
  assert.equal(finished, true);
  assert.equal(digest(views), 'b4b3e0a533307e370cb43b5f04cbf65df55f9114');
});

test('the views of a five-player game with Jokers are exactly as they were', () => {
  const { views, finished } = recordedViews(32, { seats: 5, length: 'short', jokers: true });
  assert.equal(finished, true);
  assert.equal(digest(views), '814b903ee5a97ed93e0d326d350186eaa6d3e8b8');
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'settings', 'seats', 'rounds', 'winners', 'instantWin', 'limits']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'settings', 'seats', 'rounds', 'winners', 'instantWin', 'limits', 'round', 'hand', 'trick', 'trickWinner', 'lastTrick', 'turn', 'forbidden', 'suggestion', 'legal']);
});
