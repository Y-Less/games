// The socket layer for GTK.  The rules live in game.js; the rooms, saving, views, joining, and the lobby events are the
// shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.  This file says
// what is particular to GTK: its settings, its own socket events (answers, choose, ready) and what the server has to do
// by itself (a computer move, or moving on from the reveal when somebody has not closed the scores).
//
// Timing can be changed through the environment (the tests make it fast):
//   GTK_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 700-1800)
//   GTK_NEXT_WAIT   milliseconds the reveal waits for everyone to close the scores before moving on (default 60000)
//
// Depends on shared/roomServer.js (the room server and its timing helpers) and ./game.js (the rules).
import { accountNames, afterWait, botMove, botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import { rosterLayout } from '../../shared/layout.js';
import * as game from './game.js';

/**
 * Reads the GTK timings from the environment.
 * @returns {{ bot: { min: number, max: number }, nextWait: number }} the computer-player range and the wait at the
 *   reveal, both in milliseconds
 * Side effects: none (reads process.env).
 */
function readDelays() {
  return {
    bot: readDelayRange('GTK_BOT_DELAY', '700-1800'),
    nextWait: readDelayMs('GTK_NEXT_WAIT', 60000),
  };
}

/**
 * Starts the GTK server half.
 * @param {object} ctx  the module context from the site (users, storage, sockets)
 * @returns {{ dispose: () => void }} a handle that stops the timers
 * Side effects: see createRoomServer (reads the saved rooms, starts timers, registers the socket events).
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
    viewOptions: (room, userId, clock) => ({ nameOf, now: clock() }),
    migrate: (room) => game.migrate(room, nameOf),
    /**
     * A computer move, or moving on from the reveal: whichever the room is in now.  A move that does nothing is
     * reported as a failure (it would otherwise be repeated for ever), so the room server's retry-with-a-pause takes over.
     * @param {object} room  the room
     * @param {() => number} rng  random source
     * @returns {{ wait: number, key?: string, run: () => void } | null} what to schedule, or null when nothing is due
     * Side effects: none itself; the returned run() plays the move or forces the next question on the room.
     */
    nextAction(room, rng, now) {
      const action = game.pendingBotAction(room);
      if (action) return botMove(action, botWait(delays.bot, rng), () => game.runBotAction(room, rng, action, nameOf, now()));
      // The clock has run out on writing or picking: answer or pick for whoever is left, so one person who has
      // wandered off cannot hold up the table.  The same key keeps the same timer, so a pick does not extend it.
      if (game.isTimed(room)) {
        return {
          key: `time:${room.turn}:${room.question}:${room.phase}`,
          wait: Math.max(0, room.deadline - now()),
          run() {
            if (!game.fillTimedOut(room, rng, nameOf, now())) throw new Error('nobody was left to answer or pick when the time ran out');
          },
        };
      }
      // Somebody has not closed the scores (away, or gone): move on without them.  The wait is not restarted when
      // somebody closes the pop-up: the same question's timer keeps running.
      if (game.waitingForReady(room)) return afterWait(`next:${room.turn}:${room.question}`, delays.nextWait, () => game.forceNext(room, rng, nameOf, now()));
      return null;
    },
    /**
     * Registers GTK's socket events; each one runs a game.js action for the connected user and broadcasts the result.
     * @param {object} hooks  { act (run a room action and share it), on (listen for an event), userId, rng }
     * @returns {void}
     * Side effects: adds socket listeners; each event mutates the room through game.js.
     */
    registerEvents({ act, on, userId, rng, now }) {
      on('answers', ({ texts }) => act((room) => game.submitAnswers(room, userId, texts, rng, nameOf, now())));
      on('choose', ({ n }) => act((room) => game.choose(room, userId, n, nameOf)));
      on('ready', () => act((room) => game.ready(room, userId, rng, nameOf, now())));
    },
  });
}

/**
 * Only the settings (rounds, questions a turn, and the time to answer), whatever else a client sends.
 * @param {object} payload  the untrusted settings object from the client
 * @returns {object} a copy with only the allowed keys
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, ['rounds', 'questionsPerTurn', 'seconds', 'size']);
}
