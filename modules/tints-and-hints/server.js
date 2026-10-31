// The socket layer for Tints and Hints. The rules live in game.js; the rooms, saving, views, joining and the lobby events are
// the shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js. This file says
// what is particular to Tints and Hints: its settings (turns each), its own socket events (colour, hint, guess, advance, ready),
// the achievements for the squares people have guessed, and what the server has to do by itself (a computer move, or moving
// on from the reveal when somebody has not closed the scores).
//
// Timing can be changed through the environment (the tests make it fast):
//   TINTS_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   TINTS_NEXT_WAIT   milliseconds the reveal waits for everyone to close the scores before moving on (default 60000)
import { botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';
import { CORNERS, cellNumber } from './grid.js';

/**
 * Reads the Tints and Hints timings from the environment.
 *
 * @returns {{ bot: { min: number, max: number }, nextWait: number }} the computer-player range and the wait at the reveal,
 *   both in milliseconds
 */
function readDelays() {
  return {
    bot: readDelayRange('TINTS_BOT_DELAY', '600-1400'),
    nextWait: readDelayMs('TINTS_NEXT_WAIT', 60000),
  };
}

/**
 * Starts the Tints and Hints server half.
 *
 * Side effects: see createRoomServer (reads the saved rooms, starts timers, registers the socket events).
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }}
 */
export default function (ctx) {
  const delays = readDelays();
  /** An account's display name (used for people who have left the room, and for rooms saved before names were kept). */
  const nameOf = (id) => ctx.users.get(id)?.displayName ?? 'Someone';

  /**
   * Hands out the collecting achievements for the squares people have now guessed (once for each scored turn, whoever's
   * move scored it).
   *
   * Side effects: sets room.collected to this turn, and calls ctx.achievements.collect for every person who guessed. A
   * failure is logged and ignored: it must not stop the game.
   *
   * @param {object} room
   */
  function collectSquares(room) {
    if (room.phase !== 'reveal' || !room.result || room.collected === room.turn) return;
    room.collected = room.turn;
    const collect = (id, key, items) => {
      if (typeof id !== 'number') return; // computer players are not accounts
      try {
        ctx.achievements?.collect(id, key, items);
      } catch (error) {
        ctx.log('could not collect squares:', error.message);
      }
    };
    for (const { id, cell } of room.result.entries) {
      collect(id, 'palette', [cellNumber(cell)]);
      if (CORNERS.includes(cell)) collect(id, 'corners', [CORNERS.indexOf(cell)]);
    }
  }

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,
    kickKey: 'userId', // the client names the person to remove by account id, not by a seat number
    playerExtras: (userId) => ({ colour: ctx.markers.preferred(userId) }),
    viewOptions: (room, userId) => ({ nameOf, canCustom: ctx.markers.canCustom(userId) }),
    migrate: (room) => game.migrate(room, nameOf),
    afterChange: collectSquares,
    /**
     * A computer move, or moving on from the reveal: whichever the room is in now. A move that does nothing is reported as a
     * failure (it would otherwise be repeated for ever), so the room server's retry-with-a-pause takes over.
     */
    nextAction(room) {
      const action = game.pendingBotAction(room);
      if (action) {
        return {
          wait: botWait(delays.bot),
          run() {
            if (!game.runBotAction(room, Math.random, action)) throw new Error(`the computer move ${action.type} for ${action.id} was refused`);
          },
        };
      }
      // Somebody has not closed the scores (away, or gone): move on without them. The wait is not restarted when somebody
      // closes the pop-up: the same turn's timer keeps running.
      if (game.waitingForReady(room)) {
        return {
          key: `next:${room.turn}`,
          wait: delays.nextWait,
          run() {
            const outcome = game.forceNext(room);
            if (!outcome.ok) throw new Error(outcome.error);
          },
        };
      }
      return null;
    },
    registerEvents({ act, on, userId }) {
      on('colour', ({ colour }) => act((room) => game.setColour(room, userId, colour, ctx.markers.canCustom(userId))));
      on('hint', ({ text }) => act((room) => game.setHint(room, userId, text)));
      on('guess', ({ cell }) => act((room) => game.guess(room, userId, cell)));
      on('advance', () => act((room) => game.advance(room, userId)));
      on('ready', () => act((room) => game.ready(room, userId)));
    },
  });
}

/** Only the settings (turns each), whatever else a client sends. */
function pickSettings(payload) {
  return pickKeys(payload, ['turnsEach']);
}
