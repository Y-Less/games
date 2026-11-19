// The socket layer for Zurubang.  The rules live in game.js and one fight in duel.js; the rooms, saving, views,
// joining, and the lobby events are the shared room server (shared/roomServer.js).  This file says what is particular
// to Zurubang: its one setting, its own socket events, and the two things the server does without being asked — a
// computer player's move after a short think, and turning the next pair over during a duel.
//
// Depends on shared/roomServer.js and ./game.js.
//
// Timing can be changed through the environment (the tests make it fast):
//   ZURUBANG_BOT_DELAY    "min-max" milliseconds a computer player thinks before acting (default 300-700)
//   ZURUBANG_REVEAL_WAIT  milliseconds a pair stays face up before the next is turned (default 2500)
//   ZURUBANG_NEXT_WAIT    milliseconds to wait for both players to close a duel's result (default 60000)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_THINKING, botWait, createRoomServer, insist, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Starts the Zurubang server half.
 *
 * Side effects: mounts the card art at /assets/zurubang/cards, loads the saved rooms, registers the socket handlers,
 * and starts the shared server's timers; dispose() stops them.
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }} the handle the site calls to stop the server half
 */
export default function (ctx) {
  const thinkTime = readDelayRange('ZURUBANG_BOT_DELAY', CARD_THINKING);
  const revealWait = readDelayMs('ZURUBANG_REVEAL_WAIT', 2500);
  const nextWait = readDelayMs('ZURUBANG_NEXT_WAIT', 60000);
  ctx.mount('/cards', path.join(here, 'cards'), { maxAge: '7d', immutable: true });

  /** What each person is holding, counted once ever towards "the whole deck" (see module.json). */
  const lastHands = new WeakMap(); // room -> the hands last counted, so a change that moved no card costs nothing
  function collectCards(room) {
    const held = game.heldByPeople(room);
    const signature = held.map((person) => `${person.userId}:${person.cards.join(',')}`).join('|');
    if (lastHands.get(room) === signature) return;
    lastHands.set(room, signature);
    for (const person of held) {
      try {
        ctx.achievements?.collect(person.userId, 'collector', person.cards);
      } catch (error) {
        ctx.log(`could not collect cards: ${error.message}`);
      }
    }
  }

  return createRoomServer(ctx, {
    game,
    pickSettings,
    migrate: game.migrate,
    afterChange: collectCards,
    /**
     * A computer player's move after a short think; failing that, the next pair of the duel turned over; failing that,
     * the wait for both players to close a duel that nobody has closed.  A move that is refused is thrown, so that the
     * shared server logs it and tries again rather than leaving the room stuck.
     */
    nextAction(room, rng) {
      const pending = game.pendingBot(room);
      if (pending) {
        return {
          key: pending.key,
          wait: botWait(thinkTime, rng),
          run: () => insist(game.botMove(room, rng, pending)),
        };
      }
      // Nobody has to ask for the next pair: a duel is watched, not waited on, and either player may hurry it.
      if (room.phase === 'revealing') {
        return { key: `reveal:${room.duelNo}:${room.duel.at}`, wait: revealWait, run: () => insist(game.revealNext(room, rng)) };
      }
      if (game.waitingForReady(room)) return { key: `next:${room.duelNo}`, wait: nextWait, run: () => insist(game.forceNext(room, rng)) };
      return null;
    },
    /** Zurubang's own socket events: the three things a turn can be, the duel's answers, and the cards. */
    registerEvents({ act, on, userId, rng }) {
      on('swapOne', ({ card, stack }) => act((room, seat) => ctx.achievements.cardsPlayed(userId, game.swapOne(room, seat, card, stack, rng), 1)));
      on('swapAll', ({ stacks }) => act((room, seat) => ctx.achievements.cardsPlayed(userId, game.swapAll(room, seat, stacks, rng), game.HAND_SIZE)));
      on('challenge', () => act((room, seat) => game.challenge(room, seat)));
      on('answer', ({ accept }) => act((room, seat) => game.answer(room, seat, Boolean(accept))));
      on('starter', ({ seat: who }) => act((room, seat) => game.chooseStarter(room, seat, who)));
      on('place', ({ card }) => act((room, seat) => ctx.achievements.cardsPlayed(userId, game.place(room, seat, card), 1)));
      on('reveal', () => act((room, seat) => game.reveal(room, seat, rng)));
      on('sudden', ({ position }) => act((room, seat) => game.suddenPick(room, seat, position, rng)));
      on('ready', () => act((room, seat) => game.ready(room, seat, rng)));
    },
  });
}

/**
 * Only the setting this game accepts, whatever else a client sends.
 *
 * @param {object} payload  what the client sent
 * @returns {{ target?: number }} the permitted settings
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, ['target']);
}
