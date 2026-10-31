// The socket layer for Just One. The rules live in game.js; the rooms, saving, views, joining and the lobby events are the
// shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js. This file says what
// is particular to Just One: its settings, its own socket events (clue, guess, pass, best, ready) and what the server has to
// do by itself (a computer move, or moving on from the reveal when somebody has not closed the scores).
//
// Timing can be changed through the environment (the tests make it fast):
//   JUST_ONE_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   JUST_ONE_NEXT_WAIT   milliseconds the reveal waits for everyone to close the scores before moving on (default 60000)
import { botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';

/**
 * Reads the Just One timings from the environment.
 *
 * @returns {{ bot: { min: number, max: number }, nextWait: number }} the computer-player range and the wait at the reveal,
 *   both in milliseconds
 */
function readDelays() {
  return {
    bot: readDelayRange('JUST_ONE_BOT_DELAY', '600-1400'),
    nextWait: readDelayMs('JUST_ONE_NEXT_WAIT', 60000),
  };
}

/**
 * Starts the Just One server half.
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

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,
    kickKey: 'userId', // the client names the person to remove by account id, not by a seat number
    viewOptions: () => ({ nameOf }),
    migrate: (room) => game.migrate(room, nameOf),
    /**
     * A computer move, or moving on from the reveal: whichever the room is in now. A move that does nothing is reported as a
     * failure (it would otherwise be repeated for ever), so the room server's retry-with-a-pause takes over.
     */
    nextAction(room, rng) {
      const action = game.pendingBotAction(room);
      if (action) {
        return {
          wait: botWait(delays.bot, rng),
          run() {
            if (!game.runBotAction(room, rng, action)) throw new Error(`the computer move ${action.type} for ${action.id} was refused`);
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
            const outcome = game.forceNext(room, rng);
            if (!outcome.ok) throw new Error(outcome.error);
          },
        };
      }
      return null;
    },
    registerEvents({ act, on, userId, rng }) {
      on('clue', ({ text }) => act((room) => game.submitClue(room, userId, text, rng)));
      on('guess', ({ text }) => act((room) => game.guess(room, userId, text)));
      on('pass', () => act((room) => game.pass(room, userId)));
      on('best', ({ n }) => act((room) => game.chooseBest(room, userId, n)));
      on('ready', () => act((room) => game.ready(room, userId, rng)));
    },
  });
}

/** Only the settings (turns each), whatever else a client sends. */
function pickSettings(payload) {
  return pickKeys(payload, ['turnsEach']);
}
