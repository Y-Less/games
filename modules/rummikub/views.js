// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
import assert from 'node:assert/strict';
import * as game from './game.js';
import { runPending } from './bot.js';
import { seeded } from '../../shared/random.js';


export const NOW = 1000;

/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
export function recordedViews(seed, size, settings) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', size, settings, now: NOW });
  const views = [JSON.stringify(game.viewFor(room, 1, { now: NOW })), JSON.stringify(game.viewFor(room, 99, { now: NOW }))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1, { now: NOW })));
  assert.equal(game.start(room, 1, rng, NOW).ok, true);
  const person = room.seats[0];
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1, { now: NOW })), JSON.stringify(game.viewFor(room, 99, { now: NOW })), JSON.stringify(game.viewFor(room, 1, { online: () => false, now: NOW + 5 })));
  look();
  // The computer's judgement moves for seat 0, but every look is taken with seat 0 as the person: that is what a member sees.
  const bot = { kind: 'bot', id: 'bot:90', name: person.name, ai: room.seats[1].ai };
  const asBot = () => (room.seats[0] = bot);
  const asPerson = () => (room.seats[0] = person);
  for (let guard = 0; guard < 3000 && room.phase !== 'finished'; guard++) {
    look();
    if (room.phase === 'between') {
      asBot();
      game.forceNext(room, rng, NOW);
      asPerson();
    }
    else {
      asBot();
      const moved = runPending(room, rng, NOW).ok;
      asPerson();
      if (!moved) break;
    }
  }
  look();
  return { views, finished: room.phase === 'finished' };
}
