// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
import assert from 'node:assert/strict';
import * as game from './game.js';
import { playTurn } from './bot.js';
import { seeded } from '../../shared/random.js';


/** Plays a seeded game for the given seats (seat 0, the person, is played by the computer's judgement) and returns every view. */
export function recordedViews(seed, seats, target) {
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
