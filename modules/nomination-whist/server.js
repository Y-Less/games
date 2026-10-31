// The socket layer for Nomination Whist. The rules live in game.js; the rooms, saving, views, joining and the lobby events
// are the shared room server (shared/roomServer.js). This file says what is particular to this game: its settings, its own
// socket events (nominate, play, next), and what the server has to do by itself (a computer move, the end of a trick, the
// wait for everyone to close the score pop-up between rounds).
//
// Timing can be changed through the environment (the tests make it fast):
//   NOMINATION_WHIST_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   NOMINATION_WHIST_TRICK_PAUSE milliseconds a finished trick stays on the table (default 1500)
//   NOMINATION_WHIST_NEXT_WAIT   milliseconds to wait for everyone to close the score pop-up between rounds (default 60000)
import { botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';

/**
 * Reads the Nomination Whist timings from the environment.
 *
 * @returns {{ bot: { min: number, max: number }, trick: number, nextWait: number }} the computer-player delay range, the
 *   trick pause and the between-rounds wait, all in milliseconds
 */
function readDelays() {
  return {
    bot: readDelayRange('NOMINATION_WHIST_BOT_DELAY', '600-1400'),
    trick: readDelayMs('NOMINATION_WHIST_TRICK_PAUSE', 1500),
    nextWait: readDelayMs('NOMINATION_WHIST_NEXT_WAIT', 60000),
  };
}

/**
 * Starts the Nomination Whist server half.
 *
 * Side effects: everything createRoomServer does (loads and saves rooms, registers socket handlers, sets timers).
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }}
 */
export default function (ctx) {
  const delays = readDelays();
  return createRoomServer(ctx, {
    game,
    pickSettings,
    /**
     * A computer move, the end of a trick, or the wait for the score pop-up: whichever the room is in now.
     *
     * @param {object} room
     * @returns {{ key?: string, wait: number, run: () => void } | null} null when the game is waiting for a person
     */
    nextAction(room, rng) {
      const action = game.pendingAction(room);
      if (action) {
        return { wait: action.type === 'resolve' ? delays.trick : botWait(delays.bot, rng), run: () => game.runPending(room, rng) };
      }
      // The wait is not restarted when somebody closes the pop-up: the same round's timer keeps running.
      if (game.waitingForReady(room)) return { key: `next:${room.roundIndex}`, wait: delays.nextWait, run: () => game.forceNextRound(room, rng) };
      return null;
    },
    /** The game's own socket events: nominating, playing a card and closing the round-end pop-up. */
    registerEvents({ act, on, userId, rng }) {
      on('nominate', ({ number }) => act((room, seat) => game.nominate(room, seat, number)));
      on('play', ({ card }) => act((room, seat) => ctx.achievements.cardsPlayed(userId, game.playCard(room, seat, card), 1)));
      on('next', () => act((room) => game.nextRound(room, userId, rng)));
    },
  });
}

/**
 * Only the game's settings, whatever else a client sends.
 *
 * @param {object} payload  the client's "create" or "settings" message
 * @returns {object} just the settings keys that were sent
 */
function pickSettings(payload) {
  return pickKeys(payload, ['seats', 'length', 'missPoints', 'instantWin', 'jokers', 'hints']);
}
