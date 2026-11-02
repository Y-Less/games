// The socket layer for Scribblers.  The rules live in game.js; the rooms, saving, views, joining, and the lobby events
// are the shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.  This
// file says what is particular to Scribblers: its settings, its own socket events, the clock work a turn needs (a word
// chosen for a drawer who dithers, a letter revealed, the end of a turn), and the drawing itself.
//
// **The drawing is not part of the view.**  A view is the whole state of a room, sent to everybody on every change; a
// drawing is thousands of instructions a turn.  So the strokes live in this file, in memory, for the turn being drawn,
// and are relayed to the other players as they are made - the same real-time sketch protocol as scribble.rs:
//
//   client -> server   line { x, y, x2, y2, c, w } | fill { x, y, c } | draw { ops } (a batch of either) | clear | undo
//   server -> client   draw { ops }                 more strokes to add to the board
//                      canvas { ops, first, done }  the board as it now stands, in chunks (a late arrival, or an undo)
//
// Timing can be changed through the environment (the tests make it fast):
//   SCRIBBLERS_CHOOSE_WAIT   milliseconds the drawer has to choose a word (default 30000)
//   SCRIBBLERS_BETWEEN_WAIT  milliseconds the word stays up between turns (default 6000)
//   SCRIBBLERS_SCORES_WAIT   milliseconds the round's scores wait for everybody to close them (default 60000)
//   SCRIBBLERS_AWAY_WAIT     milliseconds a drawing waits for a drawer who has gone (default 8000)
//
// Depends on shared/roomServer.js (the room server and its timing helpers), ./game.js (the rules) and ./drawing.js (the
// canvas and what may go on it).
import { createRoomServer, pickKeys, readDelayMs } from '../../shared/roomServer.js';
import { MAX_BATCH, addOps, canvasMessages, clear, newDrawing, readOp, undo } from './drawing.js';
import * as game from './game.js';

/** How long after a computer player inherits a drawing turn before that turn is given up (milliseconds). */
const SKIP_WAIT = 1000;

/**
 * Reads the Scribblers timings from the environment.
 * @returns {{ chooseMs: number, betweenMs: number, scoresMs: number, awayMs: number }} all in milliseconds
 * Side effects: none (reads process.env).
 */
function readDelays() {
  return {
    chooseMs: readDelayMs('SCRIBBLERS_CHOOSE_WAIT', game.CHOOSE_MS),
    betweenMs: readDelayMs('SCRIBBLERS_BETWEEN_WAIT', game.BETWEEN_MS),
    scoresMs: readDelayMs('SCRIBBLERS_SCORES_WAIT', 60000),
    awayMs: readDelayMs('SCRIBBLERS_AWAY_WAIT', 8000),
  };
}

/**
 * Starts the Scribblers server half.
 *
 * Side effects: see createRoomServer (reads the saved rooms, starts timers, registers the socket events); keeps the
 * drawing of each room being drawn in memory.
 *
 * @param {object} ctx  the module context from the site (users, storage, sockets)
 * @returns {{ dispose: () => void }} a handle that stops the timers
 */
export default function (ctx) {
  const delays = readDelays();
  /** An account's display name (for people who have left the room, and for rooms saved before names were kept). */
  const nameOf = (id) => ctx.users.get(id)?.displayName ?? 'Someone';
  /** The drawing of each room that is being drawn: code -> { key: '<round>:<turn>', drawing }.  Never saved. */
  const canvases = new Map();

  /**
   * The drawing of the turn this room is on, starting a fresh one when the turn has moved on.
   * @param {object} room  the room
   * @returns {object} the drawing (see drawing.js)
   * Side effects: may replace this room's entry in `canvases`.
   */
  function canvasOf(room) {
    const key = `${room.round}:${room.turn}`;
    let entry = canvases.get(room.code);
    if (!entry || entry.key !== key) {
      entry = { key, drawing: newDrawing() };
      canvases.set(room.code, entry);
    }
    return entry.drawing;
  }

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,
    kickKey: 'userId', // the client names the person to remove by account id, not by a seat number
    viewOptions: (room, userId, now) => ({ nameOf, now: now() }),
    createArgs: () => ({ chooseMs: delays.chooseMs, betweenMs: delays.betweenMs }),
    migrate: (room) => game.migrate(room, nameOf),
    /**
     * Forgets the drawing of a room that is not being drawn (between rounds, in the lobby, once it is over), so that no
     * room holds a canvas it will never show again.
     * @param {object} room  the room that has just changed
     * @returns {void}
     * Side effects: may drop this room's entry from `canvases`.
     */
    afterChange(room) {
      if (!['drawing', 'between'].includes(room.phase)) canvases.delete(room.code);
    },
    /**
     * The clock work of a turn: a word chosen for a drawer who did not choose one, a letter revealed, the end of the
     * drawing, the next turn, the next round, and the end of a turn nobody is there to draw.
     *
     * A drawer who closes the page is noticed when the next scheduled thing happens (a letter, the end of the turn),
     * because a connection going is not itself a change to the room; the turn therefore ends within a letter's time of
     * their leaving rather than the moment they go.
     *
     * @param {object} room  the room
     * @param {() => number} rng  random source
     * @param {() => number} now  the clock
     * @param {{ online: (id: *) => boolean }} who  who is connected right now (read again when the timer fires)
     * @returns {{ key?: string, wait: number, run: () => void } | null} what to schedule, or null when nothing is due
     * Side effects: none itself; the returned run() moves the room on.
     */
    nextAction(room, rng, now, { online }) {
      const turnKey = `${room.round}:${room.turn}`;
      // Nobody can draw this turn: a computer player has taken the drawer's place.
      if (game.drawerIsBot(room)) {
        return { key: `skip:${turnKey}`, wait: SKIP_WAIT, run: () => insist(game.skipTurn(room, now())) };
      }
      // The drawer has gone: give the turn up unless they are back by the time this fires.
      if (['choosing', 'drawing'].includes(room.phase) && !online(room.drawer)) {
        return {
          key: `away:${turnKey}`,
          wait: delays.awayMs,
          run() {
            if (!online(room.drawer)) insist(game.skipTurn(room, now()));
          },
        };
      }
      // The round's scores are up: move on without anybody who has not closed them.
      if (room.phase === 'scores') {
        return { key: `scores:${room.round}`, wait: delays.scoresMs, run: () => insist(game.forceNextRound(room, rng, now())) };
      }
      // A letter of the word, if one is due before the drawing ends.
      if (room.nextHintAt !== null && room.nextHintAt !== undefined && (room.deadline === null || room.nextHintAt <= room.deadline)) {
        return { key: `hint:${turnKey}:${room.hintsLeft}`, wait: Math.max(0, room.nextHintAt - now()), run: () => insist(game.revealHint(room, rng, now())) };
      }
      // Whatever the end of this phase means: the word chosen, the drawing over, or the next turn.
      if (room.deadline !== null && room.deadline !== undefined) {
        return { key: `deadline:${turnKey}:${room.phase}`, wait: Math.max(0, room.deadline - now()), run: () => insist(game.timeUp(room, rng, now(), nameOf)) };
      }
      return null;
    },
    /**
     * Registers the game's own socket events: what a player does through the rules (choose a word, guess, close the
     * scores), and the drawing, which goes straight to the other players instead of through a view.
     *
     * @param {object} hooks  { on, act, userId, socket, rng, now, roomOf, relay } from the room server
     * @returns {void}
     * Side effects: adds socket listeners; the drawing events change this module's in-memory canvases and send to others.
     */
    registerEvents({ on, act, userId, socket, rng, now, roomOf, relay }) {
      on('word', ({ n }) => act((room) => game.chooseWord(room, userId, n, now())));
      on('guess', ({ text }) => act((room) => game.guess(room, userId, text, now())));
      on('ready', () => act((room) => game.ready(room, userId, rng, now())));

      /**
       * The room this socket is drawing in, or a refusal to send back.
       * @returns {{ room: object } | { error: object }}
       */
      const drawingRoom = () => {
        const room = roomOf();
        if (!room) return { error: { ok: false, error: 'notInAnyGame' } };
        if (!game.canDraw(room, userId)) return { error: { ok: false, error: 'notYourTurnToDraw' } };
        return { room };
      };

      /**
       * Takes strokes from the drawer, keeps them with the turn's drawing, and passes them to everybody else.
       * @param {unknown[]} raws  what the client sent, one entry per instruction
       * @param {string} [kind]  the instruction type when the event name says it ('line' or 'fill')
       * @returns {object} the ack for the client
       * Side effects: adds to this room's drawing and emits `draw` to the other players.
       */
      const draw = (raws, kind) => {
        const { room, error } = drawingRoom();
        if (error) return error;
        const ops = raws
          .slice(0, MAX_BATCH)
          .map((raw) => readOp(kind ? { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}), t: kind } : raw))
          .filter(Boolean);
        if (!ops.length) return { ok: false, error: 'badDrawing' };
        const kept = addOps(canvasOf(room), ops, now());
        if (kept.length) relay(room, 'draw', { ops: kept }, { except: userId });
        return { ok: true };
      };

      /**
       * Sends a whole drawing, in chunks, either to this socket alone or to everybody in the room.
       * @param {object} room  the room
       * @param {object[]} ops  the instructions
       * @param {boolean} [everyone]  true to send to the whole room, false for this socket only
       * @returns {void}
       * Side effects: emits `canvas` events.
       */
      const sendCanvas = (room, ops, everyone = false) => {
        for (const message of canvasMessages(ops)) {
          if (everyone) relay(room, 'canvas', message);
          else socket.emit('canvas', message);
        }
      };

      on('line', (payload) => draw([payload], 'line'));
      on('fill', (payload) => draw([payload], 'fill'));
      on('draw', ({ ops }) => draw(Array.isArray(ops) ? ops : []));

      on('clear', () => {
        const { room, error } = drawingRoom();
        if (error) return error;
        if (clear(canvasOf(room))) sendCanvas(room, [], true);
        return { ok: true };
      });

      on('undo', () => {
        const { room, error } = drawingRoom();
        if (error) return error;
        const drawing = canvasOf(room);
        if (undo(drawing)) sendCanvas(room, drawing.ops, true);
        return { ok: true };
      });

      // Somebody opened the page, or came back, in the middle of a turn: give them the board as it stands.
      on('canvas', () => {
        const room = roomOf();
        if (!room) return { ok: false, error: 'notInAnyGame' };
        sendCanvas(room, ['drawing', 'between'].includes(room.phase) ? canvasOf(room).ops : []);
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
  return pickKeys(payload, ['rounds', 'drawTime', 'wordChoices']);
}
