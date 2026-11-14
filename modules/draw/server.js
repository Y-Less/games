// The socket layer for Draw!.  The rules live in game.js; the rooms, saving, views, joining and the lobby events are
// the shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.  This file
// says what is particular to Draw!: its settings, its own socket events, the clock work of a turn, the computer
// players, and the two drawings.
//
// The module's id is `draw`, which is also the name of one of its socket events; they are different layers (a
// namespace and an event within it) and never meet, so neither needs renaming.
//
// **The drawings are not part of the view**, and are not kept here either: they are shared/strokeRelay.js, which
// Scribblers uses as well.  Draw! has a board for each of the pair drawing rather than one, so it is the game that
// adds a field saying which:
//
//   client -> server   line { x, y, x2, y2, c, w } | fill { x, y, c } | draw { ops } | clear | undo
//   server -> client   draw { board, ops }                 more strokes for one of the boards
//                      canvas { board, ops, first, done }  a board as it now stands, in chunks
//
// **A board is known by its place, not by who is drawing it** (`board`: its index in the view's `boards`, so 0 or 1).
// A computer player taking over from somebody who leaves mid-turn therefore inherits the strokes already on their
// board, rather than finding a blank one under a new name.  The field is not called `slot`: on this site a slot is a
// member's place in a room, and the two would be different numbers of different things on one wire.
//
// Timing can be changed through the environment (the tests make it fast):
//   DRAW_CHOOSE_WAIT   milliseconds the drawers have to pick a word (default 5000)
//   DRAW_BETWEEN_WAIT  milliseconds the two words stay up between rounds (default 4000)
//   DRAW_AWAY_WAIT     milliseconds a turn waits for drawers who have gone (default 8000)
//   DRAW_BOT_DELAY     "min-max" milliseconds a computer player waits before choosing or guessing (default 700-1300)
//   DRAW_BOT_DRAW      milliseconds before a computer player starts drawing its picture (default 1200)
//   DRAW_BOT_RATE      strokes a second a computer player draws at (default 100; the tests turn it right up)
//   DRAW_PICTURES      where a computer player's pictures come from: "web" (default), "test" or "off"
//
// Depends on shared/roomServer.js, shared/drawing.js (what a drawing is made of), shared/picture.js (a word turned
// into something to draw) and ./game.js (the rules).
import { accountNames, botMove, botWait, createRoomServer, insist, pickKeys, readDelayMs, readDelayRange, soonest } from '../../shared/roomServer.js';
import { rosterLayout } from '../../shared/layout.js';
import { BOT_STROKE_RATE, createStrokeRelay, pictureSource, readRate } from '../../shared/strokeRelay.js';
import * as game from './game.js';

/**
 * Every timing the game runs on, from the environment.
 * @returns {object} the delays, in milliseconds (and botRate in strokes a second)
 * Side effects: none (reads process.env).
 */
const readDelays = () => ({
  chooseMs: readDelayMs('DRAW_CHOOSE_WAIT', game.CHOOSE_MS),
  betweenMs: readDelayMs('DRAW_BETWEEN_WAIT', game.BETWEEN_MS),
  awayMs: readDelayMs('DRAW_AWAY_WAIT', 8000),
  bot: readDelayRange('DRAW_BOT_DELAY', '700-1300'),
  botDraw: readDelayMs('DRAW_BOT_DRAW', 1200),
  botRate: readRate('DRAW_BOT_RATE', BOT_STROKE_RATE),
});

/**
 * Starts the Draw! server half.
 * @param {object} ctx  the module context from the site (io, dataDir, codes, stats, users, log, ...)
 * @returns {{ dispose: () => void }} a handle that stops the timers
 * Side effects: see createRoomServer, plus the in-memory drawings this file keeps.
 */
export default function (ctx) {
  const delays = readDelays();
  /** An account's display name (for rooms saved before names were kept). */
  const nameOf = accountNames(ctx);

  // The boards, the strokes on them, and the pictures the computer players paint: shared/strokeRelay.js, which
  // Scribblers uses too.  Draw! has a board for each of the pair drawing, so it says which on the wire.
  const strokes = createStrokeRelay({
    ctx,
    game,
    turnKey: (room) => room.turn,
    boards: game.boardsOf,
    boardOf: game.slotOf,
    wordFor: (room, board) => room.words[game.drawersOf(room)[board]],
    label: (board) => ({ board }),
    pictureFor: pictureSource('DRAW_PICTURES'),
    botRate: delays.botRate,
  });

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,
    layout: rosterLayout, // a list of players rather than numbered seats (shared/layout.js)
    viewOptions: (room, userId, now) => ({ nameOf, now: now() }),
    createArgs: () => ({ chooseMs: delays.chooseMs, betweenMs: delays.betweenMs }),
    migrate: (room) => game.migrate(room, nameOf),
    afterChange: strokes.forget,
    /**
     * The clock work of a round, run off the one timer the room server gives a game: a word picked for a drawer who
     * dithered, the end of the drawing, the next round, a computer player's move, the picture a computer player
     * paints, and a round neither drawer is there for.  Whichever is due soonest is the one scheduled.
     *
     * @param {object} room  the room
     * @param {() => number} rng  random source
     * @param {() => number} now  the clock
     * @param {{ online: (id: *) => boolean, relay: Function }} who  who is connected, and how to send to the room
     * @returns {{ key?: string, wait: number, run: () => void } | null}
     * Side effects: none itself; the returned run() moves the room on, or starts a picture.
     */
    nextAction(room, rng, now, { online, relay }) {
      const inTurn = ['choosing', 'drawing'].includes(room.phase);
      const playerOf = (id) => room.players.find((p) => p.id === id);
      const drawers = game.drawersOf(room).map(playerOf);
      // A board whose drawer is a person who has gone will stay empty; the turn goes on for the other one, and is
      // only given up when neither of them is there to draw at all.
      const canStillDraw = (p) => p && (!game.isHuman(p) || online(p.id));
      if (inTurn && drawers.length && !drawers.some(canStillDraw)) {
        return {
          key: `away:${room.turn}`,
          wait: delays.awayMs,
          run() {
            if (!game.drawersOf(room).map(playerOf).some(canStillDraw)) insist(game.skipTurn(room, now()));
          },
        };
      }
      // A computer player with a word and an empty board: fetch a picture of it and start painting (once a turn).
      if (room.phase === 'drawing') {
        for (let board = 0; board < drawers.length; board++) {
          if (drawers[board] && !game.isHuman(drawers[board]) && strokes.pictureDue(room, board)) {
            return { key: `picture:${room.turn}:${board}`, wait: delays.botDraw, run: () => void strokes.paint(room, board, relay, rng, now) };
          }
        }
      }

      const due = [];
      const bot = game.pendingBotAction(room);
      if (bot) {
        const tries = room.players.find((p) => p.id === bot.id)?.tries ?? 0;
        due.push({
          key: `bot:${room.turn}:${bot.type}:${bot.id}:${tries}`,
          at: now() + botWait(delays.bot, rng),
          run: botMove(bot, 0, () => game.runBotAction(room, rng, now(), bot)).run,
        });
      }
      if (room.deadline !== null && room.deadline !== undefined) {
        due.push({ key: `deadline:${room.turn}:${room.phase}`, at: room.deadline, run: () => insist(game.timeUp(room, rng, now())) });
      }
      return soonest(due, now());
    },
    /**
     * The game's own socket events: what a player does through the rules, and the drawing, which goes straight to the
     * other players instead of through a view.
     * @param {object} hooks  { on, act, userId, socket, rng, now, roomOf, relay } from the room server
     * @returns {void}
     * Side effects: adds socket listeners; the drawing events change this module's drawings and send to others.
     */
    registerEvents({ on, act, userId, socket, rng, now, roomOf, relay }) {
      on('word', ({ n }) => act((room) => game.chooseWord(room, userId, n, now())));
      on('guess', ({ text }) => act((room) => game.guess(room, userId, text, now())));

      // line, fill, draw, clear, undo and canvas: the same relay Scribblers uses (shared/strokeRelay.js).
      strokes.registerEvents({ on, userId, socket, now, roomOf, relay });
    },
  });
}

/**
 * Only the settings the host may choose, whatever else a client sends.
 * @param {object} payload  the untrusted settings object from the client
 * @returns {object} a copy with only the allowed keys
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, ['rounds', 'drawTime', 'wordChoices', 'size']);
}
