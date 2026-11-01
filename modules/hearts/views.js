// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';


/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
export function recordedViews(seats, seed, settings = {}) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, target: 50, ...settings }, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const person = room.seats[0];
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  // The computer's judgement moves for seat 0, but every look is taken with seat 0 as the person: that is what a member sees.
  const bot = { kind: 'bot', id: 'bot:90', name: person.name, ai: 'standard' };
  const asBot = () => (room.seats[0] = bot);
  const asPerson = () => (room.seats[0] = person);
  for (let guard = 0; guard < 5000 && room.phase !== 'finished'; guard++) {
    look();
    if (room.phase === 'handEnd') {
      asBot();
      game.forceNextHand(room, rng);
      asPerson();
    }
    else {
      asBot();
      const moved = game.runPending(room, rng);
      asPerson();
      if (!moved) break;
    }
  }
  look();
  return { views, finished: room.phase === 'finished' };
}
