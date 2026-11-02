// The socket layer for Azulejo.  The rules live in game.js and the computer players in bot.js; the rooms, saving, views,
// joining and the lobby events are the shared room server (shared/roomServer.js).  This file says what is particular to
// Azulejo: its one setting, its own socket events (size, move, column) and what the server does by itself (a computer
// move or column choice).
//
// Timing can be changed through the environment (the tests make it fast):
//   AZULEJO_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
import { botWait, createRoomServer, pickKeys, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';
import * as bot from './bot.js';

/**
 * Starts the Azulejo server half.
 *
 * Side effects: everything createRoomServer does (loads saved rooms, registers socket handlers, sets timers).
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }} dispose() stops the timers and saves the rooms
 */
export default function (ctx) {
  // How long a computer player waits before acting, read once when the server starts.
  const botDelay = readDelayRange('AZULEJO_BOT_DELAY', '600-1400');
  return createRoomServer(ctx, {
    game,
    pickSettings,
    /**
     * The number of seats is chosen when a game is created (the settings are only the free-wall option).
     *
     * @param {{ seats?: number }} payload  the client's create message
     * @returns {{ size: number }} the arguments for game.createRoom (game.createRoom checks the size)
     *
     * Side effects: none.
     */
    createArgs: (payload) => ({ size: payload.seats === undefined ? game.DEFAULT_SIZE : payload.seats }),
    /**
     * A computer move or column choice, if one is due.  The server calls it after every change and schedules what it returns.
     *
     * @param {object} room  the room (not changed here)
     * @param {() => number} rng  random numbers in [0, 1), used for the delay and passed on to the action
     * @returns {{ wait: number, run: () => any } | null} null when the game is waiting for a person; otherwise how long to wait and what to run
     *
     * Side effects: none.
     */
    nextAction(room, rng) {
      if (!bot.pendingAction(room)) return null;
      return { wait: botWait(botDelay, rng), run: () => bot.runPending(room, rng) };
    },
    /**
     * Registers the three Azulejo socket events on top of the shared lobby events.
     *
     * @param {object} helpers  from the shared room server
     * @param {Function} helpers.act  runs a room action for the calling player and sends the results
     * @param {Function} helpers.on  registers a socket event handler
     * @param {number} helpers.userId  the account id of the caller
     * @param {() => number} helpers.rng  random numbers in [0, 1)
     *
     * Side effects: registers handlers; each event, when it arrives, mutates the room through game.js.
     */
    registerEvents({ act, on, userId, rng }) {
      // Host only (game.setSize checks): change the number of seats in the lobby.
      on('size', ({ seats }) => act((room) => game.setSize(room, userId, seats)));
      // Take tiles from a source and put them on a pattern line or the floor (game.takeTiles checks it all).
      on('move', ({ source, colour, line }) => act((room, seat) => game.takeTiles(room, seat, { source, colour, line }, rng)));
      // Free wall only: choose the column for a completed pattern line (game.chooseColumn checks it).
      on('column', ({ col }) => act((room, seat) => game.chooseColumn(room, seat, { col }, rng)));
    },
  });
}

/**
 * Only the one setting, whatever else a client sends.
 *
 * @param {object | undefined} payload  whatever the client sent with 'create' or 'settings'
 * @returns {{ freeWall?: any }} a new object (never the payload itself); validation is game.normaliseSettings' job
 *
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, ['freeWall']);
}
