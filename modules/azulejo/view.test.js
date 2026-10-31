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
function recordedViews(seed, size, freeWall) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', size, settings: { freeWall }, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const person = room.seats[0];
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  room.seats[0] = { kind: 'bot', id: 'bot:90', name: person.name, ai: room.seats[1].ai };
  for (let guard = 0; guard < 5000 && room.phase !== 'finished'; guard++) {
    if (!runPending(room, rng)) break;
    look();
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a three-player game are exactly as they were', () => {
  const { views, finished } = recordedViews(61, 3, false);
  assert.equal(finished, true);
  assert.equal(digest(views), '1f3894df0b469dddb60530d970106feb486555e5');
});

test('the views of a two-player game with a free wall are exactly as they were', () => {
  const { views, finished } = recordedViews(62, 2, true);
  assert.equal(finished, true);
  assert.equal(digest(views), 'a3e670fafb00f579a7e01995b7515d52da813de9');
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'size', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'log']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'size', 'settings', 'seats', 'scoreboard', 'winners', 'limits', 'log', 'round', 'first', 'turn', 'factories', 'centre', 'markerInCentre', 'bagCount', 'lid', 'lastTiling', 'choosing', 'choice', 'final']);
});
