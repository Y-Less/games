// The socket layer for Rummikub.  The rules live in game.js and the computer players in bot.js; the rooms, saving, views,
// joining and the lobby events are the shared room server (shared/roomServer.js).  This file says what is particular to
// Rummikub: its settings, its own socket events (play, draw, next, size) and what the server has to do by itself (a
// computer move, a turn timer running out, the wait between rounds).
//
// Timing can be changed through the environment (the tests make it fast):
//   RUMMIKUB_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 900-1800)
//   RUMMIKUB_ROUND_WAIT  milliseconds to wait for everyone to press Continue between rounds (default 60000)
import { botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';
import * as bot from './bot.js';
import { LIMITS } from './rules.js';

/**
 * Reads the Rummikub timings from the environment.
 *
 * @returns {{ bot: { min: number, max: number }, roundWait: number }} the computer-player delay range and the wait between
 *   rounds, both in milliseconds
 * Side effects: none (reads process.env).
 */
function readDelays() {
  return {
    bot: readDelayRange('RUMMIKUB_BOT_DELAY', '900-1800'),
    roundWait: readDelayMs('RUMMIKUB_ROUND_WAIT', 60000),
  };
}

/**
 * Starts the Rummikub server half.
 *
 * Side effects: everything createRoomServer does (loads saved rooms, registers the socket handlers, sets timers).
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }}
 */
export default function (ctx) {
  const delays = readDelays();
  return createRoomServer(ctx, {
    game,
    pickSettings,
    /** The extra argument for a new room: the number of seats the host asked for (the default size if none). */
    createArgs: (payload) => ({ size: payload.seats === undefined ? game.DEFAULT_SIZE : payload.seats }),
    /** The view needs the clock, to show how long is left on the turn timer. */
    viewOptions: (room, userId, now) => ({ now: now() }),
    /**
     * The next thing the server does by itself, in this order of priority: a computer move; a turn timer running out; the
     * wait between rounds.  Returns null when the game is waiting for a person.
     */
    nextAction(room, rng, now) {
      if (bot.pendingAction(room)) return { wait: botWait(delays.bot, rng), run: () => bot.runPending(room, rng, now()) };
      if (room.phase === 'playing' && room.deadline !== null && room.deadline !== undefined) {
        return {
          wait: Math.max(0, room.deadline - now()),
          run: () => game.timeout(room, Math.max(now(), room.deadline)),
        };
      }
      // The wait is not restarted when somebody presses Continue: the same round's timer keeps running.
      if (room.phase === 'between') return { key: `between:${room.round}`, wait: delays.roundWait, run: () => game.forceNext(room, rng, now()) };
      return null;
    },
    /** Rummikub's own events: a whole turn (play), a draw, Continue between rounds, and the number of seats. */
    registerEvents({ act, on, userId, rng, now }) {
      on('size', ({ seats }) => act((room) => game.setSize(room, userId, seats)));
      on('play', ({ table }) => act((room, seat) => game.play(room, seat, { table }, now())));
      on('draw', () => act((room, seat) => game.draw(room, seat, now())));
      on('next', () => act((room, seat) => game.next(room, seat, rng, now())));
    },
  });
}

/**
 * Only the host-set options, whatever else a client sends.
 *
 * @param {object | undefined} payload  what the client sent with 'create' or 'settings'
 * @returns {object} a new object holding just the rule limits and `playOnMeld` that were given
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, [...Object.keys(LIMITS), 'playOnMeld']);
}
