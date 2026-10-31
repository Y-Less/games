// The socket layer for Azulejo. The rules live in game.js and the computer players in bot.js; the rooms, saving, views,
// joining and the lobby events are the shared room server (shared/roomServer.js). This file says what is particular to
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
    /** The number of seats is chosen when a game is created (the settings are only the free-wall option). */
    createArgs: (payload) => ({ size: payload.seats === undefined ? game.DEFAULT_SIZE : payload.seats }),
    /** A computer move or column choice, if one is due. */
    nextAction(room) {
      if (!bot.pendingAction(room)) return null;
      return { wait: botWait(botDelay), run: () => bot.runPending(room) };
    },
    registerEvents({ act, on, userId }) {
      on('size', ({ seats }) => act((room) => game.setSize(room, userId, seats)));
      on('move', ({ source, colour, line }) => act((room, seat) => game.takeTiles(room, seat, { source, colour, line })));
      on('column', ({ col }) => act((room, seat) => game.chooseColumn(room, seat, { col })));
    },
  });
}

/**
 * Only the one setting, whatever else a client sends.
 *
 * @param {object | undefined} payload  whatever the client sent with 'create' or 'settings'
 * @returns {{ freeWall?: any }} a new object (never the payload itself); validation is game.normaliseSettings' job
 */
function pickSettings(payload) {
  return pickKeys(payload, ['freeWall']);
}
