// The socket layer for Draw!.  The rules live in game.js; the rooms, saving, views, joining and the lobby events are
// the shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.  This file
// says what is particular to Draw!: its settings, its own socket events, the clock work of a round, the computer
// players, and the two drawings.
//
// The module's id is `draw`, which is also the name of one of its socket events; they are different layers (a
// namespace and an event within it) and never meet, so neither needs renaming.
//
// **The drawings are not part of the view.**  A view is the whole state of a room, sent to everybody on every change;
// a drawing is thousands of instructions.  So the strokes live in this file, in memory, for the round being drawn, and
// are relayed as they are made - the same protocol as Scribblers (shared/drawing.js), with one field added, because
// there are two boards:
//
//   client -> server   line { x, y, x2, y2, c, w } | fill { x, y, c } | draw { ops } | clear | undo
//   server -> client   draw { slot, ops }                 more strokes for one of the boards
//                      canvas { slot, ops, first, done }  a board as it now stands, in chunks
//
// **A board is known by its place, not by who is drawing it** (`slot`: 0 or 1).  A computer player taking over from
// somebody who leaves mid-round therefore inherits the strokes already on their board, rather than finding a blank one
// under a new name.
//
// Timing can be changed through the environment (the tests make it fast):
//   DRAW_CHOOSE_WAIT   milliseconds the drawers have to pick a word (default 5000)
//   DRAW_BETWEEN_WAIT  milliseconds the two words stay up between rounds (default 4000)
//   DRAW_AWAY_WAIT     milliseconds a turn waits for drawers who have gone (default 8000)
//   DRAW_BOT_DELAY     "min-max" milliseconds a computer player waits before choosing or guessing (default 700-1300)
//   DRAW_BOT_DRAW      milliseconds before a computer player starts drawing its picture (default 1200)
//   DRAW_BOT_RATE      strokes a second a computer player draws at (default 10; the tests turn it right up)
//   DRAW_PICTURES      where a computer player's pictures come from: "web" (default), "test" or "off"
//
// Depends on shared/roomServer.js, shared/drawing.js (what a drawing is made of), shared/picture.js (a word turned
// into something to draw) and ./game.js (the rules).
import { shuffle } from '../../shared/cards.js';
import { MAX_BATCH, addOps, canvasMessages, clear, newDrawing, readOp, undo } from '../../shared/drawing.js';
import { drawingFor, testPicture } from '../../shared/picture.js';
import { botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import { rosterLayout } from '../../shared/layout.js';
import * as game from './game.js';

/** How often the server sends the next few strokes of a computer player's picture (milliseconds). */
const STROKE_TICK = 100;
/** How fast a computer player draws, in strokes a second, unless DRAW_BOT_RATE says otherwise. */
const BOT_STROKE_RATE = 100;

/**
 * Where a computer player's pictures come from.
 * @returns {(word: string) => Promise<{ ops: object[], url: string | null }>} the instructions for a word
 * Side effects: none itself; the "web" source fetches when it is called.
 */
function pictureSource() {
  const kind = process.env.DRAW_PICTURES ?? 'web';
  if (kind === 'off') return async () => ({ ops: [], url: null });
  if (kind === 'test') return async (word) => ({ ops: testPicture(word), url: null });
  return (word) => drawingFor(word);
}

/**
 * How fast a computer player draws, from the environment.
 * @param {string} name  the environment variable
 * @param {number} fallback  strokes a second when it is unset or unusable
 * @returns {number}
 * Side effects: none (reads process.env).
 */
function readRate(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

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

/** Waits a while, for the pacing of a computer player's picture. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the Draw! server half.
 * @param {object} ctx  the module context from the site (io, dataDir, codes, stats, users, log, ...)
 * @returns {{ dispose: () => void }} a handle that stops the timers
 * Side effects: see createRoomServer, plus the in-memory drawings this file keeps.
 */
export default function (ctx) {
  const delays = readDelays();
  const pictureFor = pictureSource();
  /** An account's display name (for rooms saved before names were kept). */
  const nameOf = (id) => ctx.users?.get(id)?.displayName ?? 'Someone';

  /** The two drawings of the round each room is on: code -> { round, boards: [drawing, drawing] }. */
  const canvases = new Map();
  /** The boards a computer player has already been given a picture for: code -> Set of '<round>:<slot>'. */
  const painted = new Map();

  /**
   * One of the two drawings of the round this room is on, starting fresh ones when the round has moved on.
   * @param {object} room  the room
   * @param {number} slot  0 or 1
   * @returns {object} the drawing (see shared/drawing.js)
   * Side effects: may replace this room's entry in `canvases`.
   */
  function canvasOf(room, slot) {
    let entry = canvases.get(room.code);
    if (!entry || entry.turn !== room.turn) {
      entry = { turn: room.turn, boards: [newDrawing(), newDrawing()] };
      canvases.set(room.code, entry);
      painted.delete(room.code);
    }
    return entry.boards[slot];
  }

  /**
   * Has this board still to be given its computer player's picture?  Only once a turn, and only while it is empty, so
   * that a computer player standing in for somebody who left does not paint over what they had already drawn.
   * @param {object} room  the room
   * @param {number} slot  0 or 1
   * @returns {boolean}
   * Side effects: none (it reads the drawing without starting one).
   */
  function pictureDue(room, slot) {
    if (painted.get(room.code)?.has(`${room.turn}:${slot}`)) return false;
    const entry = canvases.get(room.code);
    return !entry || entry.turn !== room.turn || entry.boards[slot].ops.length === 0;
  }

  /**
   * Draws a computer player's word on its own board: a picture is fetched and then put on a few strokes a second, in
   * a scattered order, so that it comes up out of nothing the way a drawing does.  It stops if the round moves on.
   *
   * @param {object} room  the room (its drawing is added to)
   * @param {number} slot  which board
   * @param {Function} relay  sends an event to everybody in the room
   * @param {() => number} rng  random source, for the order the strokes go on in
   * @param {() => number} now  the clock
   * @returns {Promise<void>}
   * Side effects: fetches over the network, fills the board, emits `draw` to the room, and logs.
   */
  async function paint(room, slot, relay, rng, now) {
    const turn = room.turn;
    const drawer = game.drawersOf(room)[slot];
    const word = room.words[drawer];
    if (!word) return;
    const marks = painted.get(room.code) ?? new Set();
    marks.add(`${turn}:${slot}`); // marked before the fetch, so a second timer cannot start the same picture again
    painted.set(room.code, marks);
    const here = () => room.turn === turn && room.phase === 'drawing' && room.words[game.drawersOf(room)[slot]] === word;
    try {
      const { ops } = await pictureFor(word);
      if (!ops.length) {
        ctx.log(`no picture was found for "${word}"`);
        return;
      }
      const order = shuffle(ops, rng);
      // How many strokes a tick is owed, kept as a running total rather than rounded each time.
      const perTick = (delays.botRate * STROKE_TICK) / 1000;
      let credit = 0;
      for (let sent = 0; sent < order.length; ) {
        await pause(STROKE_TICK);
        if (!here()) return; // the round moved on while the picture was being fetched or drawn
        credit += perTick;
        const take = Math.min(Math.floor(credit), order.length - sent, MAX_BATCH);
        if (take < 1) continue;
        credit -= take;
        const kept = addOps(canvasOf(room, slot), order.slice(sent, sent + take), now());
        sent += take;
        if (kept.length) relay(room, 'draw', { slot, ops: kept });
      }
    } catch (error) {
      ctx.log(`could not draw "${word}":`, error.message);
    }
  }

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,
    layout: rosterLayout, // a list of players rather than numbered seats (shared/layout.js)
    viewOptions: (room, userId, now) => ({ nameOf, now: now() }),
    createArgs: () => ({ chooseMs: delays.chooseMs, betweenMs: delays.betweenMs }),
    migrate: (room) => game.migrate(room, nameOf),
    /**
     * Forgets the drawings of a room that is not drawing, so that no room holds boards it will never show again.
     * @param {object} room  the room that has just changed
     * @returns {void}
     * Side effects: may drop this room's entries from `canvases` and `painted`.
     */
    afterChange(room) {
      if (['drawing', 'between'].includes(room.phase)) return;
      canvases.delete(room.code);
      painted.delete(room.code);
    },
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
        for (let slot = 0; slot < drawers.length; slot++) {
          if (drawers[slot] && !game.isHuman(drawers[slot]) && pictureDue(room, slot)) {
            return { key: `picture:${room.turn}:${slot}`, wait: delays.botDraw, run: () => void paint(room, slot, relay, rng, now) };
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
          run() {
            if (!game.runBotAction(room, rng, now(), bot)) throw new Error(`the computer move ${bot.type} for ${bot.id} was refused`);
          },
        });
      }
      if (room.deadline !== null && room.deadline !== undefined) {
        due.push({ key: `deadline:${room.turn}:${room.phase}`, at: room.deadline, run: () => insist(game.timeUp(room, rng, now())) });
      }
      if (!due.length) return null;
      const soonest = due.reduce((first, next) => (next.at < first.at ? next : first));
      return { key: soonest.key, wait: Math.max(0, soonest.at - now()), run: soonest.run };
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

      /**
       * The room and board this socket may draw on, or a refusal to send back.
       * @returns {{ room: object, slot: number } | { error: object }}
       */
      const drawingRoom = () => {
        const room = roomOf();
        if (!room) return { error: { ok: false, error: 'notInAnyGame' } };
        if (!game.canDraw(room, userId)) return { error: { ok: false, error: 'notYourTurnToDraw' } };
        return { room, slot: game.slotOf(room, userId) };
      };

      /**
       * Takes strokes from a drawer, keeps them with their board, and passes them to everybody else.
       * @param {unknown[]} raws  what the client sent, one entry per instruction
       * @param {string} [kind]  the instruction type when the event name says it ('line' or 'fill')
       * @returns {object} the ack for the client
       * Side effects: adds to one of this room's drawings and emits `draw` to the other players.
       */
      const draw = (raws, kind) => {
        const { room, slot, error } = drawingRoom();
        if (error) return error;
        const ops = raws
          .slice(0, MAX_BATCH)
          .map((raw) => readOp(kind ? { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}), t: kind } : raw))
          .filter(Boolean);
        if (!ops.length) return { ok: false, error: 'badDrawing' };
        const kept = addOps(canvasOf(room, slot), ops, now());
        if (kept.length) relay(room, 'draw', { slot, ops: kept }, { except: userId });
        return { ok: true };
      };

      /**
       * Sends a whole board, in chunks, either to this socket alone or to everybody in the room.
       * @param {object} room  the room
       * @param {number} slot  which board
       * @param {object[]} ops  the instructions
       * @param {boolean} [everyone]  true to send to the whole room, false for this socket only
       * @returns {void}
       * Side effects: emits `canvas` events.
       */
      const sendCanvas = (room, slot, ops, everyone = false) => {
        for (const message of canvasMessages(ops)) {
          if (everyone) relay(room, 'canvas', { slot, ...message });
          else socket.emit('canvas', { slot, ...message });
        }
      };

      on('line', (payload) => draw([payload], 'line'));
      on('fill', (payload) => draw([payload], 'fill'));
      on('draw', ({ ops }) => draw(Array.isArray(ops) ? ops : []));

      on('clear', () => {
        const { room, slot, error } = drawingRoom();
        if (error) return error;
        if (clear(canvasOf(room, slot))) sendCanvas(room, slot, [], true);
        return { ok: true };
      });

      on('undo', () => {
        const { room, slot, error } = drawingRoom();
        if (error) return error;
        const drawing = canvasOf(room, slot);
        if (undo(drawing)) sendCanvas(room, slot, drawing.ops, true);
        return { ok: true };
      });

      // Somebody opened the page, or came back, in the middle of a round: give them both boards as they stand.
      on('canvas', () => {
        const room = roomOf();
        if (!room) return { ok: false, error: 'notInAnyGame' };
        const live = ['drawing', 'between'].includes(room.phase);
        for (let slot = 0; slot < 2; slot++) sendCanvas(room, slot, live ? canvasOf(room, slot).ops : []);
        return { ok: true };
      });
    },
  });

  /**
   * Turns a refused clock action into a throw, so that the room server logs it and tries again rather than leaving the
   * room waiting for ever on something that quietly did nothing.
   * @param {{ ok: boolean, error?: string }} outcome  what the rule returned
   * @returns {void}
   * Side effects: throws on a refusal.
   */
  function insist(outcome) {
    if (!outcome.ok) throw new Error(outcome.error);
  }
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
