// A snapshot of what viewFor sends (see game.js): every view, for a person and a stranger, along whole seeded games of
// computers. The digest was taken before viewFor was split into smaller builders, so splitting it further must not change
// a byte of what is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as game from './game.js';
import { runPending } from './bot.js';
import { seeded } from '../../shared/random.js';

/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
function recordedViews(seed, size, badPrivate) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', size, settings: { badPrivate }, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const person = room.seats[0];
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  room.seats[0] = { kind: 'bot', id: 'bot:90', name: person.name, ai: room.seats[1].ai };
  for (let guard = 0; guard < 20000 && room.phase !== 'finished'; guard++) {
    if (!runPending(room, rng)) break;
    look();
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a two-player game are exactly as they were', () => {
  const { views, finished } = recordedViews(71, 2, false);
  assert.equal(finished, true);
  assert.equal(digest(views), 'b3c3615b7aacc7aa9017620a0656eb65f129c56b');
});

test('the views of a three-player game with the unlucky private objectives are exactly as they were', () => {
  const { views, finished } = recordedViews(72, 3, true);
  assert.equal(finished, true);
  assert.equal(digest(views), '44bd400f813176b519f8c94f1408725e3d4f51ad');
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'size', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'log']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  const choosing = Object.keys(game.viewFor(room, 1));
  assert.deepEqual(choosing.slice(0, 11), ['code', 'phase', 'you', 'hostSeat', 'size', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'log']);
  assert.ok(choosing.includes('options') && choosing.includes('chosen'), 'the windows to choose from are offered');
});
