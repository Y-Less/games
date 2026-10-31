// A snapshot of what viewFor sends (see game.js): every view, for a person and a stranger, along whole seeded games of
// computers. The digest was taken before viewFor was split into smaller builders, so splitting it further must not change
// a byte of what is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
function recordedViews(seats, seed, settings = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, target: 50, ...settings }, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const person = room.seats[0];
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  room.seats[0] = { kind: 'bot', id: 'bot:90', name: person.name, ai: 'standard' };
  for (let guard = 0; guard < 5000 && room.phase !== 'finished'; guard++) {
    look();
    if (room.phase === 'handEnd') game.forceNextHand(room, rng);
    else if (!game.runPending(room, rng)) break;
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a four-player game are exactly as they were', () => {
  const { views, finished } = recordedViews(4, 11);
  assert.equal(finished, true);
  assert.equal(digest(views), 'ab190dbb953aff0da9fcf9a1edd8e17375dea6ed');
});

test('the views of a five-player game with the moon scoring for the shooter are exactly as they were', () => {
  const { views, finished } = recordedViews(5, 12, { moon: 'self', jackOfDiamonds: false });
  assert.equal(finished, true);
  assert.equal(digest(views), '15e34104932cfac94e8213bde2376c9e6a175e05');
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'settings', 'seats', 'scoreboard', 'handNumber', 'lastHand', 'winners', 'seatCount', 'deal', 'limits', 'pass']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'settings', 'seats', 'scoreboard', 'handNumber', 'lastHand', 'winners', 'seatCount', 'deal', 'limits', 'hand', 'received', 'trick', 'trickWinner', 'lastTrick', 'turn', 'canClaim', 'lastClaim', 'heartsBroken', 'trickNumber', 'legal', 'pass']);
});
