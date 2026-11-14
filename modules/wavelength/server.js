// The socket layer for Wavelength.  The rules live in game.js; the rooms, saving, views, joining, and the lobby events are the
// shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.  This file says what
// is particular to Wavelength: its settings (turns each, solo or team), its own socket events (colour, mode, marker, lock,
// clue, guess, ready) and what the server has to do by itself (a computer move, or moving on from the reveal when somebody
// has not closed the scores).
//
// Timing can be changed through the environment (the tests make it fast):
//   WAVELENGTH_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   WAVELENGTH_NEXT_WAIT   milliseconds the reveal waits for everyone to close the scores before moving on (default 60000)
import { accountNames, afterWait, botMove, botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import { rosterLayout } from '../../shared/layout.js';
import * as game from './game.js';

/**
 * Reads the Wavelength timings from the environment.
 *
 * @returns {{ bot: { min: number, max: number }, nextWait: number }} the computer-player range and the wait at the reveal,
 *   both in milliseconds
 *
 * Side effects: none (reads process.env only).
 */
function readDelays() {
  return {
    bot: readDelayRange('WAVELENGTH_BOT_DELAY', '600-1400'),
    nextWait: readDelayMs('WAVELENGTH_NEXT_WAIT', 60000),
  };
}

/**
 * Starts the Wavelength server half.
 *
 * Side effects: see createRoomServer (reads the saved rooms, starts timers, registers the socket events).
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }} the handle the site calls on shutdown to stop timers
 */
export default function (ctx) {
  const delays = readDelays();
  /** An account's display name (used for people who have left the room, and for rooms saved before names were kept). */
  const nameOf = accountNames(ctx);

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,
    layout: rosterLayout, // a list of players rather than numbered seats (shared/layout.js)
    playerExtras: (userId) => ({ colour: ctx.markers.preferred(userId) }),
    viewOptions: (room, userId) => ({ nameOf, canCustom: ctx.markers.canCustom(userId) }),
    migrate: (room) => game.migrate(room, nameOf),
    /**
     * A computer move, or moving on from the reveal: whichever the room is in now.  A move that does nothing is reported as a
     * failure (it would otherwise be repeated for ever), so the room server's retry-with-a-pause takes over.
     *
     * @param {object} room  the room to look at
     * @param {() => number} rng  random source, for the computer's thinking time and its decisions
     * @returns {{key?: string, wait: number, run: () => void}|null} what to do after `wait` milliseconds, or null for nothing
     *
     * Side effects: none while choosing; the returned run() makes the computer move or forces the next turn (mutates the room)
     * and throws if the game refuses, which makes the room server retry later.
     */
    nextAction(room, rng) {
      const action = game.pendingBotAction(room);
      if (action) return botMove(action, botWait(delays.bot, rng), () => game.runBotAction(room, rng, action));
      // Somebody has not closed the scores (away, or gone): move on without them.  The wait is not restarted when somebody
      // closes the pop-up: the same turn's timer keeps running.
      if (game.waitingForReady(room)) return afterWait(`next:${room.turn}`, delays.nextWait, () => game.forceNext(room, rng));
      return null;
    },
    /**
     * Adds this game's own socket events to each connection; every handler runs a game rule on the sender's room via `act`.
     *
     * @param {{act: Function, on: Function, userId: number, rng: () => number}} h  the room server's helpers: `on` registers an event,
     *   `act` runs a rule on the room and tells everybody, `userId` is this connection's account, `rng` the shared random source
     * @returns {void}
     *
     * Side effects: registers socket event handlers; each event later mutates the room through the game rules and broadcasts.
     */
    registerEvents({ act, on, userId, rng }) {
      on('colour', ({ colour }) => act((room) => game.setColour(room, userId, colour, ctx.markers.canCustom(userId))));
      on('mode', ({ mode }) => act((room) => game.setMode(room, userId, mode)));
      on('marker', ({ position }) => act((room) => game.setMarker(room, userId, position)));
      on('lock', () => act((room) => game.lockIn(room, userId)));
      on('clue', ({ text }) => act((room) => game.setClue(room, userId, text)));
      on('guess', ({ position }) => act((room) => game.guess(room, userId, position)));
      on('ready', () => act((room) => game.ready(room, userId, rng)));
    },
  });
}

/**
 * Only the settings (turns each, and solo or team play), whatever else a client sends.
 *
 * @param {object} payload  the settings the client sent (untrusted)
 * @returns {object} a new object with just `rounds` and `mode`
 *
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, ['rounds', 'mode', 'size']);
}
