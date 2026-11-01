// The socket layer for Cheat. The rules live in game.js; the rooms, saving, views, joining and the lobby events are the
// shared room server (shared/roomServer.js). This file says what is particular to Cheat: its settings (just the number of
// seats), its own socket events (play, call, accept), and what the server has to do by itself (a computer player's play
// or its decision about the last play).
//
// Timing can be changed through the environment (the tests make it fast):
//   CHEAT_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 900-1800)
import { botWait, createRoomServer, pickKeys, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';

/**
 * Reads the Cheat timings from the environment.
 *
 * @returns {{ bot: { min: number, max: number } }} the range of milliseconds a computer player waits before acting
 * Side effects: none (reads process.env).
 */
function readDelays() {
  return { bot: readDelayRange('CHEAT_BOT_DELAY', '900-1800') };
}

/**
 * How long a computer player waits before deciding about the last play. A computer player thinks for a while before it
 * plays, and a little less before it decides about the last play, so that a person has time to call "Cheat!" first if they
 * want to. The wait is `min * 0.6 + random * (max - min) * 0.5`, which is a botWait over a scaled range.
 *
 * @param {{ min: number, max: number }} range  the computer-player range from readDelays
 * @param {() => number} rng  the server's random numbers
 * @returns {number} milliseconds
 * Side effects: advances the rng.
 */
function decideWait({ min, max }, rng) {
  const low = min * 0.6;
  return botWait({ min: low, max: low + (max - min) * 0.5 }, rng);
}

/**
 * Starts the Cheat server half.
 *
 * Side effects: everything createRoomServer does (reads saved rooms, registers the connection handler, sets timers).
 *
 * @param {object} ctx  the module context from the site (io, dataDir, log, codes, stats, achievements...)
 * @returns {{ dispose: () => void }} the handle the site calls to stop the server half
 */
export default function (ctx) {
  const delays = readDelays();
  return createRoomServer(ctx, {
    game,
    pickSettings,
    /** The computer player's next play or decision, if the game is waiting for one. */
    nextAction(room, rng) {
      const action = game.pendingAction(room);
      if (!action) return null;
      const wait = action.type === 'decide' ? decideWait(delays.bot, rng) : botWait(delays.bot, rng);
      return { key: action.key, wait, run: () => game.runPending(room, rng) };
    },
    /** Cheat's own socket events: play cards, call "Cheat!" and accept the last play. */
    registerEvents({ act, on, userId }) {
      on('play', ({ cards }) => act((room, seat) => ctx.achievements.cardsPlayed(userId, game.playCards(room, seat, cards), Array.isArray(cards) ? cards.length : 0)));
      on('call', () => act((room, seat) => game.callCheat(room, seat)));
      on('accept', () => act((room, seat) => game.accept(room, seat)));
    },
  });
}

/**
 * Keeps only the settings a client may send (the number of seats), whatever else it sends.
 *
 * @param {object | undefined} payload  the client's message
 * @returns {{ seats?: number }} the permitted settings
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, ['seats']);
}
