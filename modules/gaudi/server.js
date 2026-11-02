// The socket layer for Gaudi.  The rules live in game.js and the computer players in bot.js; the rooms, saving, views,
// joining and the lobby events are the shared room server (shared/roomServer.js).  This file says what is particular to
// Gaudi: its one setting, its own socket events (size, window, place, tool, end, undo) and what the server has to do by
// itself (a computer player's move).
//
// Timing can be changed through the environment (the tests make it fast):
//   GAUDI_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
import { botWait, createRoomServer, pickKeys, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';
import * as bot from './bot.js';

/**
 * Reads the Gaudi timings from the environment.
 *
 * @returns {{ bot: { min: number, max: number } }} how long a computer player waits before acting, in milliseconds
 *
 * Side effects: none (reads process.env).
 */
function readDelays() {
  return { bot: readDelayRange('GAUDI_BOT_DELAY', '600-1400') };
}

/**
 * Starts the Gaudi server half.
 *
 * Side effects: see createRoomServer (loads saved rooms, registers the socket handlers, sets timers).
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }} the running server, which dispose() stops
 */
export default function (ctx) {
  const delays = readDelays();
  return createRoomServer(ctx, {
    game,
    pickSettings,
    /**
     * A new room is made with the number of seats the client asked for (the rules refuse a size that is not allowed).
     *
     * @param {{ seats?: number }} payload  the "create" message
     * @returns {{ size: number }} the arguments for game.createRoom
     *
     * Side effects: none.
     */
    createArgs: (payload) => ({ size: payload.seats === undefined ? game.DEFAULT_SIZE : payload.seats }),
    /**
     * The next computer move (choosing a window or taking a turn), if the game is waiting for a computer player.
     *
     * @param {object} room  the room
     * @param {() => number} rng  random source returning [0, 1)
     * @returns {{ wait: number, run: () => object | null } | null} a delay in milliseconds and what to run after it, or null
     *
     * Side effects: none itself; run() mutates the room through bot.runPending.
     */
    nextAction(room, rng) {
      return bot.pendingAction(room) ? { wait: botWait(delays.bot, rng), run: () => bot.runPending(room, rng) } : null;
    },
    /**
     * The events only Gaudi has; the lobby events (settings, addBot, start, again...) come from the shared server.
     *
     * @param {{ act: Function, on: Function, userId: number, rng: () => number }} api  from the shared room server: act runs a
     *   change on the sender's room and seat, on registers a socket event
     * @returns {void}
     *
     * Side effects: registers the socket handlers; each handler, when called, mutates the room via game.js.
     */
    registerEvents({ act, on, userId, rng }) {
      on('size', ({ seats }) => act((room) => game.setSize(room, userId, seats)));
      on('window', ({ pid }) => act((room, seat) => game.chooseWindow(room, seat, pid, rng)));
      on('place', ({ die, cell }) => act((room, seat) => game.placeDie(room, seat, { die, cell }, rng)));
      on('tool', ({ tool, params }) => act((room, seat) => game.useTool(room, seat, { tool, params }, rng)));
      on('end', () => act((room, seat) => game.endTurn(room, seat, rng)));
      on('undo', () => act((room, seat) => game.undoTurn(room, seat)));
    },
  });
}

/**
 * Only the one setting, whatever else a client sends.
 *
 * @param {object} payload  a "settings" or "create" message
 * @returns {{ badPrivate?: boolean }} just the allowed keys
 *
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, ['badPrivate']);
}
