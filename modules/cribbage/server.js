// The socket layer for Cribbage. The rules live in game.js; the rooms, saving, views, joining and the lobby events are
// the shared room server (shared/roomServer.js). This file says what is particular to Cribbage: its settings (how far to
// play and how many seats), its own socket events (discard, play, ready), and what the server has to do by itself (a
// computer player's move after a short think).
//
// Timing can be changed through the environment (the tests make it fast):
//   CRIBBAGE_BOT_DELAY   "min-max" milliseconds a computer player thinks before acting (default 600-1400)
import { botWait, createRoomServer, pickKeys, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';

/**
 * Starts the Cribbage server half.
 *
 * Side effects: loads the saved rooms (bringing old ones up to date with game.migrate), registers the socket handlers
 * and starts the shared server's timers; dispose() stops them.
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }}
 */
export default function (ctx) {
  const thinkTime = readDelayRange('CRIBBAGE_BOT_DELAY', '600-1400');
  return createRoomServer(ctx, {
    game,
    pickSettings,
    migrate: game.migrate,
    /**
     * A computer player's move after a short think, if one has something to do. The move is made by game.botMove, which
     * never trusts an AI (a throwing or illegal AI is overruled), and a move that still fails is thrown so the shared
     * server logs it and tries again a little later instead of leaving the game stuck.
     */
    nextAction(room) {
      if (!game.pendingBot(room)) return null;
      return {
        wait: botWait(thinkTime),
        run() {
          const outcome = game.botMove(room);
          if (!outcome.ok) throw new Error(`a computer player could not move: ${outcome.error}`);
        },
      };
    },
    registerEvents({ act, on, userId, rng }) {
      on('discard', ({ cards }) => act((room, seat) => game.discard(room, seat, cards, rng)));
      on('play', ({ card }) => act((room, seat) => ctx.achievements.cardsPlayed(userId, game.playCard(room, seat, card), 1)));
      on('ready', () => act((room, seat) => game.ready(room, seat, rng)));
    },
  });
}

/**
 * Only the settings (how far to play and the number of seats), whatever else a client sends.
 *
 * @param {object} payload  what the client sent
 * @returns {{ target?: number, seats?: number }}
 */
function pickSettings(payload) {
  return pickKeys(payload, ['target', 'seats']);
}
