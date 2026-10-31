// A snapshot of what viewFor sends (see game.js): every view, for each person and a stranger, along whole seeded games with
// computers. The digest was taken before viewFor was split into smaller builders, so splitting it further must not change
// a byte of what is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

/** Plays a seeded game (the first player is made to act through the computer's judgement) and returns every view. */
function recordedViews(seed, size, turnsEach) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, now: 1, turnsEach });
  assert.equal(game.addHuman(room, 2).ok, true);
  const names = (id) => `Player ${id}`;
  const views = [];
  const look = () => {
    for (const id of [1, 2, 99]) views.push(JSON.stringify(game.viewFor(room, id, { nameOf: names })), JSON.stringify(game.viewFor(room, id, { online: () => false })));
  };
  look();
  while (room.players.length < size) assert.equal(game.addBot(room, 1).ok, true);
  look();
  assert.equal(game.start(room, 1, rng).ok, true);
  look();
  const first = room.players.find((p) => p.id === 1);
  const second = room.players.find((p) => p.id === 2);
  for (let guard = 0; guard < 3000 && !['finished', 'abandoned'].includes(room.phase); guard++) {
    if (room.phase === 'reveal') game.forceNext(room, rng);
    else {
      let action = game.pendingBotAction(room);
      for (const person of [first, second]) {
        if (action) break;
        person.kind = 'bot'; // the computer's judgement acts for this person, just for this move
        action = game.pendingBotAction(room);
        if (action) assert.equal(game.runBotAction(room, rng, action, names), true);
        person.kind = 'human';
        if (action) action = { done: true };
      }
      if (action && !action.done) assert.equal(game.runBotAction(room, rng, action, names), true);
      if (!action) break;
    }
    look();
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

const digest = (views) => createHash('sha1').update(views.join('\n')).digest('hex');

test('the views of a four-player game are exactly as they were', () => {
  const { views, finished } = recordedViews(101, 4, 1);
  assert.equal(finished, true);
  assert.equal(digest(views), 'c47ca3aa0eb8ced598d28ee1c7251ced0f5a1231');
});

test('the views of a three-player game of two turns each are exactly as they were', () => {
  const { views, finished } = recordedViews(102, 3, 2);
  assert.equal(finished, true);
  assert.equal(digest(views), '283b9b13687df13e8c41cdc681f44aeacad6a7a1');
});

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostId', 'turnsEach', 'turn', 'turnsTotal', 'guesser', 'word', 'clues', 'guess', 'result', 'points', 'players', 'scoreboard', 'limits']);
});
