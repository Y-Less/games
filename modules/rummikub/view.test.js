// A snapshot of what viewFor sends (see game.js): every view, for a person and a stranger, along whole seeded games of
// computers. The digest was taken before viewFor was split into smaller builders, so splitting it further must not change
// a byte of what is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as game from './game.js';
import { runPending } from './bot.js';
import { seeded } from '../../shared/random.js';

const NOW = 1000;

/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
function recordedViews(seed, size, settings) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', size, settings, now: NOW });
  const views = [JSON.stringify(game.viewFor(room, 1, { now: NOW })), JSON.stringify(game.viewFor(room, 99, { now: NOW }))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1, { now: NOW })));
  assert.equal(game.start(room, 1, rng, NOW).ok, true);
  const person = room.seats[0];
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1, { now: NOW })), JSON.stringify(game.viewFor(room, 99, { now: NOW })), JSON.stringify(game.viewFor(room, 1, { online: () => false, now: NOW + 5 })));
  look();
  room.seats[0] = { kind: 'bot', id: 'bot:90', name: person.name, ai: room.seats[1].ai };
  for (let guard = 0; guard < 3000 && room.phase !== 'finished'; guard++) {
    look();
    if (room.phase === 'between') game.forceNext(room, rng, NOW);
    else if (!runPending(room, rng, NOW).ok) break;
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a two-round game for three are exactly as they were', () => {
  const { views, finished } = recordedViews(41, 3, { rounds: 2 });
  assert.equal(finished, true);
  assert.equal(digest(views), 'e65ab765b6cb727d3f5d117484135e1a57bf759d');
});

test('the views of a one-round game for two are exactly as they were', () => {
  const { views, finished } = recordedViews(42, 2, {});
  assert.equal(finished, true);
  assert.equal(digest(views), '5616f1456b8c1f5f7037208ecc6d1d753fb18380');
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: NOW });
  assert.deepEqual(Object.keys(game.viewFor(room, 1, { now: NOW })), ['code', 'phase', 'you', 'hostSeat', 'size', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'deal', 'log']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3), NOW);
  assert.deepEqual(Object.keys(game.viewFor(room, 1, { now: NOW })), ['code', 'phase', 'you', 'hostSeat', 'size', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'deal', 'log', 'round', 'first', 'turn', 'version', 'table', 'poolCount', 'rack', 'drawn', 'lastPlay', 'remaining', 'lastRound', 'final']);
});
