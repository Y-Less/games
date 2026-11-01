// Plays whole seeded games and records every view the rules send, for the view test (node) and the client's
// render-everything test (vitest): the same views reach both, so what the server sends is also what the table draws.
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';


/** Plays a seeded game of computers (seat 0 included) and returns every view of seat 0's person and of a stranger. */
export function recordedViews(seed, seats, target) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { seats, target }, now: 1 });
  const views = [JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99))];
  game.fillWithBots(room, 1);
  views.push(JSON.stringify(game.viewFor(room, 1)));
  assert.equal(game.start(room, 1, rng).ok, true);
  const look = () => views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
  look();
  // Seat 0 stays a person (so that their own hand and crib are shown); the computer's judgement plays for them.
  for (let guard = 0; guard < 5000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'show') game.ready(room, 0, rng);
    else {
      const pending = game.pendingBot(room);
      if (pending) game.botMove(room, rng);
      else if (room.phase === 'discard') {
        const seat = room.seats.findIndex((s) => !s.discarded);
        const need = room.hands[seat].length - 4;
        assert.equal(game.discard(room, seat, room.hands[seat].slice(0, need), rng).ok, true);
      } else if (room.phase === 'play') {
        const legal = game.playableCards(room, room.play.turn);
        const outcome = game.playCard(room, room.play.turn, legal[0]);
        assert.equal(outcome.ok, true, outcome.error);
      } else break;
    }
    look();
  }
  look();
  return { views, finished: room.phase === 'finished' };
}
