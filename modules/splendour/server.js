// The socket layer for Splendour.  The rules live in game.js and the computer players in bot.js; the rooms, saving, views,
// joining and the lobby events are the shared room server (shared/roomServer.js).  This file says what is particular to
// Splendour: its two settings, its own socket events (take, takeTwo, reserve, buy, giveBack, noble, pass) and when a
// computer player moves.
//
// Timing can be changed through the environment (the tests make it fast):
//   SPLENDOUR_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   SPLENDOUR_AI          an AI id (see ai/index.js) that every computer player uses instead of a random pick, for repeatable
//                         runs (a test/benchmark hook: see startWithForcedAI in bot.js)
//
// Depends on: ../../shared/roomServer.js (the shared room server), ./game.js (the rules), and ./bot.js (the computer players).
import { botWait, createRoomServer, pickKeys, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';
import * as bot from './bot.js';

/**
 * Starts the Splendour server half.
 *
 * Side effects: reads SPLENDOUR_BOT_DELAY and SPLENDOUR_AI from the environment once, and sets up everything
 * createRoomServer sets up (saved rooms, timers, socket handlers).
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }}
 */
export default function (ctx) {
  const botDelay = readDelayRange('SPLENDOUR_BOT_DELAY', '600-1400');
  const forcedAI = bot.forcedAIFromEnv();
  return createRoomServer(ctx, {
    game,
    pickSettings,
    /**
     * The next computer move, if a computer player has something to do: it waits a moment, then plays its whole turn.
     *
     * Side effects: advances `rng` (to pick the delay); the returned `run` later mutates the room (a whole computer turn).
     *
     * @param {object} room
     * @param {() => number} rng  random numbers in [0, 1)
     * @returns {{ wait: number, run: () => object } | null} what to schedule, or null while a person is to act
     */
    nextAction(room, rng) {
      if (!bot.pendingAction(room)) return null;
      return { wait: botWait(botDelay, rng), run: () => bot.runPending(room, rng) };
    },
    // Only when the test hook is set: the same AI for every computer player.  Otherwise the shared default (game.start) is used.
    startRule: forcedAI ? (room, userId, rng) => bot.startWithForcedAI(room, userId, rng, forcedAI) : undefined,
    /**
     * Splendour's own socket events: each is one move, checked and applied by the rules in game.js.
     *
     * Side effects: registers seven socket handlers; each one, when it fires, may mutate the room through the rule it calls.
     *
     * @param {{ act: Function, on: Function }} helpers  from the shared room server: `on(event, handler)` listens, and
     *   `act(fn)` runs fn(room, seat) for the sender's own room and seat, and tells everybody if it worked
     * @returns {void}
     */
    registerEvents({ act, on }) {
      on('take', ({ colours }) => act((room, seat) => game.takeGems(room, seat, colours)));
      on('takeTwo', ({ colour }) => act((room, seat) => game.takeTwo(room, seat, colour)));
      on('reserve', ({ card, level }) => act((room, seat) => game.reserveCard(room, seat, card !== undefined ? { card } : { level })));
      on('buy', ({ card, pay }) => act((room, seat) => game.buyCard(room, seat, card, pay)));
      on('giveBack', ({ tokens }) => act((room, seat) => game.returnTokens(room, seat, tokens)));
      on('noble', ({ noble }) => act((room, seat) => game.chooseNoble(room, seat, noble)));
      on('pass', () => act((room, seat) => game.passTurn(room, seat)));
    },
  });
}

/**
 * Only the two settings (the target prestige and the number of seats), whatever else a client sends.
 *
 * Side effects: none.
 *
 * @param {object | undefined} payload  the client's message
 * @returns {{ target?: number, seats?: number }}
 */
function pickSettings(payload) {
  return pickKeys(payload, ['target', 'seats']);
}
