// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

/**
 * Plays a seeded game (the two people are made to act through the computer's judgement) and returns every view.
 * @param {number} seed  the seed for the random source
 * @param {number} size  how many players the table has (people plus computer players)
 * @param {number} roundsEach  how many rounds each player is the subject of
 * @returns {{ views: string[], finished: boolean }} every view as JSON text, and whether the game ran to the end
 * Side effects: none outside the room it builds.
 */
export function recordedViews(seed, size, roundsEach) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, now: 1, roundsEach });
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
  for (let guard = 0; guard < 4000 && !['finished', 'abandoned'].includes(room.phase); guard++) {
    if (room.phase === 'reveal') game.forceNext(room, rng, names);
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
