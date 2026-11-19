// Plays whole seeded games and records every view the rules send, for the view test (node), the leak test, and the
// client's draw-everything test (vitest): the same views reach all three, so what the server sends is also what the
// table has to be able to draw.
//
// Seat 0 stays a person, so that a hand, a battlefield of your own cards, and a duel's result are all in the record;
// seat 1 is a computer player.  The person's moves are a plain script rather than an AI, because this is about the
// views a game passes through, not about playing it well.
import assert from 'node:assert/strict';
import * as game from './game.js';
import { seeded } from '../../shared/random.js';

/** How many moves a recording is given before it gives up on the game ending. */
const GUARD = 4000;

/**
 * The person's move in whatever the game is waiting for from them.  It challenges every third turn, so that a
 * recording has duels in it without being nothing but duels.
 */
function personMoves(room, rng) {
  const seat = 0;
  switch (room.phase) {
    case 'turn':
      if (room.duelNo % 3 === 2 || room.stacks.flat().length < 20) return game.challenge(room, seat);
      if (room.history.length % 7 === 6) return game.swapAll(room, seat, [], rng);
      return game.swapOne(room, seat, room.hands[seat][0], room.history.length % 3, rng);
    case 'challenged':
      return game.answer(room, seat, room.duelNo % 4 !== 3);
    case 'starter':
      return game.chooseStarter(room, seat, room.duelNo % 2);
    case 'placing':
      return game.place(room, seat, room.hands[seat][0]);
    case 'sudden': {
      const out = new Set(room.duel.sudden.out[seat]);
      const free = [0, 1, 2, 3, 4].filter((position) => !out.has(position));
      return game.suddenPick(room, seat, free[0], rng);
    }
    case 'duelOver':
      return game.ready(room, seat, rng);
    default:
      return { ok: false, error: 'nothingToDo' };
  }
}

/**
 * Plays one seeded game and records every view it passed through: the person's, a stranger's, and the person's as it
 * looks while they are away.
 *
 * @param {number} seed
 * @param {number} [target]  the score to play to
 * @returns {{ views: string[], rooms: object[], finished: boolean }} the views as JSON text, and the room as it stood
 *   when each set of them was taken
 * Side effects: none outside the room it makes.
 */
export function recordedViews(seed, target = 20) {
  const rng = seeded(seed);
  const room = game.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { target }, now: 1 });
  const views = [];
  const rooms = [];
  // Three views and one room every time, so that view number i was taken from room number i / 3 and a test can say
  // what the reader was entitled to know at that moment.
  const look = () => {
    views.push(JSON.stringify(game.viewFor(room, 1)), JSON.stringify(game.viewFor(room, 99)), JSON.stringify(game.viewFor(room, 1, { online: () => false })));
    rooms.push(JSON.parse(JSON.stringify(room)));
  };
  look();
  game.fillWithBots(room, 1);
  look();
  assert.equal(game.start(room, 1, rng).ok, true);
  look();

  for (let guard = 0; guard < GUARD && room.phase !== 'finished'; guard++) {
    if (room.phase === 'revealing') {
      assert.equal(game.revealNext(room, rng).ok, true);
    } else {
      const pending = game.pendingBot(room);
      const outcome = pending ? game.botMove(room, rng, pending) : personMoves(room, rng);
      assert.equal(outcome.ok, true, `${room.phase}: ${outcome.error}`);
    }
    look();
  }
  look();
  return { views, rooms, finished: room.phase === 'finished' };
}
