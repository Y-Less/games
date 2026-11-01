// What viewFor sends (see game.js) for each person and a stranger along whole seeded games with computers: the same views
// every time for a seed, a scoreboard that lists everybody and marks only those the game is waiting for, and a fixed set of
// parts. (These used to pin a SHA-1 of every view, which also pinned every computer decision and every field, so a
// legitimate change broke them without saying what moved.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

/** Plays a seeded game (the first player is made to act through the computer's judgement) and returns every view. */
function recordedViews(seed, size, turnsEach, mode = null) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', now: 1, turnsEach });
  if (mode) assert.equal(game.setMode(room, 1, mode).ok, true);
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
      if (!action) {
        // Only people are left to move: the computer's judgement acts for them, just for this move (a team of people waits for them all).
        for (const person of [first, second]) person.kind = 'bot';
        action = game.pendingBotAction(room);
        if (action) assert.equal(game.runBotAction(room, rng, action, names), true);
        for (const person of [first, second]) person.kind = 'human';
      } else assert.equal(game.runBotAction(room, rng, action, names), true);
      if (!action) break;
    }
    look();
  }
  look();
  return { views, finished: room.phase === 'finished' };
}

const WAITING_PHASES = ['clue', 'guessing'];

for (const [label, args] of [
  ['four-player game', [121, 4, 1]],
  ['team game', [122, 4, 1, 'team']],
]) {
  test(`the views of a ${label} are the same every time for a seed, and the scoreboard says whom the game waits for`, () => {
    const first = recordedViews(...args);
    assert.equal(first.finished, true);
    assert.deepEqual(recordedViews(...args).views, first.views, 'a seed replays the same game and the same views');
    assert.ok(first.views.length > 30, 'the game was long enough to look at');
    for (const text of first.views) {
      const view = JSON.parse(text);
      if (view === null || view.you === undefined) continue; // a stranger
      assert.equal(view.scoreboard.players.length, view.players.length, 'every player is on the scoreboard');
      const current = view.scoreboard.players.filter((p) => p.current);
      if (!WAITING_PHASES.includes(view.phase)) assert.deepEqual(current, [], `nobody is to act in ${view.phase}`);
      else assert.ok(current.length >= 1, `somebody is to act in ${view.phase}`);
    }
  });
}

test('a view lists its parts in a fixed order', () => {
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, now: 1 });
  assert.deepEqual(Object.keys(game.viewFor(room, 1)), ['code', 'phase', 'you', 'hostId', 'turnsEach', 'mode', 'turn', 'turnsTotal', 'psychic', 'spectrum', 'target', 'clue', 'marker', 'guesses', 'bands', 'result', 'players', 'scoreboard', 'colours', 'canCustomColour', 'limits']);
});
