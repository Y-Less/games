// A snapshot of what viewFor sends (see game.js): every view, for a person and a stranger, along whole seeded games of
// computers. The digest was taken before viewFor was split into smaller builders, so splitting it further must not change
// a byte of what is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as game from './game.js';
import { playTurn } from './bot.js';
import { seeded } from '../../shared/random.js';

/** Plays a seeded game for the given seats (seat 0, the person, is played by the computer's judgement) and returns every view. */
function recordedViews(seed, seats, target) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, target }, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  for (let guard = 0; guard < 3000 && room.phase === 'playing'; guard++) {
    playTurn(room, room.pending?.seat ?? room.turn, rng);
    look();
  }
  return { views, finished: room.phase === 'finished' };
}

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a three-player game are exactly as they were', () => {
  const { views, finished } = recordedViews(51, 3, 10);
  assert.equal(finished, true);
  assert.equal(digest(views), 'f225f3bb6559f9c49c7a0b000331a83f568ef6b3');
});

test('the views of a four-player game are exactly as they were', () => {
  const { views, finished } = recordedViews(52, 4, 15);
  assert.equal(finished, true);
  assert.equal(digest(views), '8c2872cd6b066ecec30bffbc121b9e2345f47c83');
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'settings', 'limits', 'seats', 'scoreboard', 'winners', 'endReason']);
  game.fillWithBots(room, 1);
  game.start(room, 1, seeded(3));
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostSeat', 'settings', 'limits', 'seats', 'scoreboard', 'winners', 'endReason', 'supply', 'board', 'decks', 'nobles', 'turn', 'round', 'pending', 'finalRound', 'triggeredBy', 'maxRounds', 'log', 'standings', 'afford', 'canPass']);
  assert.deepEqual(Object.keys(game.viewFor(room, 99)).slice(-2), ['log', 'standings']);
});
