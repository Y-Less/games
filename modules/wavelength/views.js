// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';


/** Plays a seeded game (the first player is made to act through the computer's judgement) and returns every view. */
export function recordedViews(seed, size, turnsEach, mode = null) {
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
