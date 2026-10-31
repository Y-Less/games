// The socket layer for Hearts. The rules live in game.js; the rooms, saving, views, joining and the lobby events are
// the shared room server (shared/roomServer.js). This file says what is particular to Hearts: its settings, its own
// socket events (pass, play, claim, next), and what the server has to do by itself (a computer move, the end of a trick,
// the wait for everyone to close the score pop-up between hands).
//
// Timing can be changed through the environment (the tests make it fast):
//   HEARTS_BOT_DELAY   "min-max" milliseconds a computer player waits before acting (default 600-1400)
//   HEARTS_TRICK_PAUSE milliseconds a finished trick stays on the table (default 1500)
//   HEARTS_NEXT_WAIT   milliseconds to wait for everyone to close the score pop-up between hands (default 60000)
import { botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';

/**
 * Reads the Hearts timings from the environment.
 *
 * @returns {{ bot: { min: number, max: number }, trick: number, nextWait: number }} computer-player range, trick pause and
 *   between-hands wait, all in milliseconds
 */
function readDelays() {
  return {
    bot: readDelayRange('HEARTS_BOT_DELAY', '600-1400'),
    trick: readDelayMs('HEARTS_TRICK_PAUSE', 1500),
    nextWait: readDelayMs('HEARTS_NEXT_WAIT', 60000),
  };
}

/**
 * Starts the Hearts server half.
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }}
 */
export default function (ctx) {
  const delays = readDelays();
  return createRoomServer(ctx, {
    game,
    pickSettings,
    /** A computer move, the end of a trick, or the wait for the score pop-up: whichever the room is in now. */
    nextAction(room, rng) {
      const action = game.pendingAction(room);
      if (action) {
        return { wait: action.type === 'resolve' ? delays.trick : botWait(delays.bot, rng), run: () => game.runPending(room, rng) };
      }
      // The wait is not restarted when somebody closes the pop-up: the same hand's timer keeps running.
      if (game.waitingForReady(room)) return { key: `next:${room.handNumber}`, wait: delays.nextWait, run: () => game.forceNextHand(room, rng) };
      return null;
    },
    registerEvents({ act, on, userId, rng }) {
      on('pass', ({ cards }) => act((room, seat) => game.choosePass(room, seat, cards)));
      on('play', ({ card }) => act((room, seat) => ctx.achievements.cardsPlayed(userId, game.playCard(room, seat, card), 1)));
      // The claimer plays one card in every remaining trick, so a claim counts `tricks` cards towards Played cards.
      on('claim', () => act((room, seat) => {
        const handSize = room.hands[seat]?.length ?? 0;
        const outcome = game.claimAll(room, seat);
        return ctx.achievements.cardsPlayed(userId, outcome, outcome.ok ? handSize : 0);
      }));
      on('next', () => act((room) => game.nextHand(room, userId, rng)));
    },
  });
}

/** Only the settings (the three options and the number of seats), whatever else a client sends. */
function pickSettings(payload) {
  return pickKeys(payload, ['target', 'jackOfDiamonds', 'moon', 'seats']);
}
