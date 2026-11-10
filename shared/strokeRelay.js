// The live drawing half of a drawing game: the boards of the turn being drawn, the strokes going from whoever is
// drawing to everybody else, and the picture a computer player paints.  Scribblers and Draw! both work this way and
// used to say so twice.
//
// **A drawing is not part of the view.**  A view is the whole state of a room, sent to everybody on every change; a
// drawing is thousands of instructions a turn.  So the strokes live here, in memory, for the turn being drawn, and are
// relayed as they are made:
//
//   client -> server   line { x, y, x2, y2, c, w } | fill { x, y, c } | draw { ops } | clear | undo
//   server -> client   draw { ops }                 more strokes for a board
//                      canvas { ops, first, done }  a board as it now stands, in chunks
//
// A game with more than one board a turn adds a field saying which (see `label`).  **A board is known by its place,
// not by who is drawing it**, so a computer player standing in for somebody who leaves mid-turn inherits the strokes
// already on their board rather than finding a blank one under a new name.
//
// Nothing here is saved: a drawing belongs to the turn it was drawn in, and `forget` drops it as soon as the room is
// doing something else.
//
// What a game has to say for itself is in createStrokeRelay's options.  The rest - how a stroke is read, batched,
// undone and chunked - is shared/drawing.js, and the same for both.
import { shuffle } from './cards.js';
import { MAX_BATCH, addOps, canvasMessages, clear, newDrawing, readOp, undo } from './drawing.js';
import { drawingFor, testPicture } from './picture.js';

/** How often the server sends the next few strokes of a computer player's picture (milliseconds). */
export const STROKE_TICK = 100;
/** How fast a computer player draws, in strokes a second, unless the game's own environment variable says otherwise. */
export const BOT_STROKE_RATE = 100;

/**
 * Waits, without keeping the process alive on its own account: a picture half-painted is never a reason for a server
 * to stay up.
 * @param {number} ms  how long to wait
 * @returns {Promise<void>}
 * Side effects: sets an unreferenced timer.
 */
export const pause = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * Reads a positive number from the environment, for the settings that are not a number of milliseconds.
 * @param {string} name  the variable to read
 * @param {number} fallback  what to use when it is missing, or not a number above zero
 * @returns {number} the setting
 * Side effects: none (reads process.env).
 */
export function readRate(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Where a computer player's pictures come from, named by the game's own environment variable: "web" (the default),
 * "test" (worked out from the word, needing no network, which is what the tests use) or "off" (draw nothing).
 * @param {string} name  the environment variable, e.g. 'SCRIBBLERS_PICTURES'
 * @returns {(word: string) => Promise<{ ops: object[], url: string | null }>} the instructions for a word
 * Side effects: none itself; the "web" source fetches when it is called.
 */
export function pictureSource(name) {
  const kind = process.env[name] ?? 'web';
  if (kind === 'off') return async () => ({ ops: [], url: null });
  if (kind === 'test') return async (word) => ({ ops: testPicture(word), url: 'test' });
  return (word) => drawingFor(word);
}

/**
 * The drawing half of one game.
 *
 * @param {object} options
 * @param {object} options.ctx  the module context from the site (used for `log`)
 * @param {object} options.game  the rules, for `canDraw(room, userId)`
 * @param {(room: object) => string | number} options.turnKey  which turn the boards belong to.  A drawing is kept for
 *   as long as this is unchanged, and thrown away when it moves on, so it must name the turn and nothing else.  The
 *   two games count turns differently - one within a round, one across the game - and neither can be written in the
 *   other's terms, which is why this is asked for rather than worked out.
 * @param {(room: object) => number} [options.boards]  how many boards this turn has (one by default).  Sized from the
 *   room rather than written down, so that one board, two, or a board each is the same code.
 * @param {(room: object, userId: number) => number} [options.boardOf]  which board this person draws on
 * @param {(room: object, board: number) => string | undefined} options.wordFor  the word on a board
 * @param {(board: number) => object} [options.label]  what names a board on the wire.  A game with one board says
 *   nothing (the default); a game with more sends a field, and the client reads it.
 * @param {(word: string) => Promise<{ ops: object[] }>} options.pictureFor  where a computer player's picture comes from
 * @param {number} options.botRate  how fast a computer player draws, in strokes a second
 * @param {(room: object, drawing: object, userId: number, now: number) => void} [options.onUndo]  anything the game
 *   itself wants to do when somebody undoes, called after the undo has been attempted, with the room server's clock
 * @param {(room: object) => boolean} [options.drawingNow]  whether a room still needs its boards
 * @returns {{ canvasOf: Function, pictureDue: Function, paint: Function, forget: Function, registerEvents: Function }}
 * Side effects: none until its functions are called; those keep this game's drawings in memory.
 */
export function createStrokeRelay({
  ctx,
  game,
  turnKey,
  boards = () => 1,
  boardOf = () => 0,
  wordFor,
  label = () => ({}),
  pictureFor,
  botRate,
  onUndo,
  drawingNow = (room) => ['drawing', 'between'].includes(room.phase),
}) {
  /** The boards of the turn each room is on: code -> { key, boards: drawing[] }.  Never saved. */
  const canvases = new Map();
  /** The boards a computer player has already been given a picture for: code -> Set of '<key>:<board>'. */
  const painted = new Map();

  /**
   * One of the boards of the turn this room is on, starting fresh ones when the turn has moved on.
   * @param {object} room  the room
   * @param {number} [board]  which board
   * @returns {object} the drawing (see drawing.js)
   * Side effects: may replace this room's entry in `canvases`.
   */
  function canvasOf(room, board = 0) {
    const key = turnKey(room);
    let entry = canvases.get(room.code);
    if (!entry || entry.key !== key) {
      entry = { key, boards: Array.from({ length: boards(room) }, () => newDrawing()) };
      canvases.set(room.code, entry);
      painted.delete(room.code);
    }
    return entry.boards[board];
  }

  /**
   * Has this board still to be given its computer player's picture?  Only once a turn, and only while it is empty, so
   * that a computer player standing in for somebody who left does not paint over what they had already drawn.
   * @param {object} room  the room
   * @param {number} [board]  which board
   * @returns {boolean}
   * Side effects: none (it reads the drawing without starting one, which is why it does not use canvasOf).
   */
  function pictureDue(room, board = 0) {
    const key = turnKey(room);
    if (painted.get(room.code)?.has(`${key}:${board}`)) return false;
    const entry = canvases.get(room.code);
    return !entry || entry.key !== key || entry.boards[board].ops.length === 0;
  }

  /**
   * Draws a computer player's word on its board: a picture of it is fetched and then put on a few strokes a second, in
   * a scattered order, so that it comes up out of nothing the way a drawing does rather than being wiped on from the
   * top.  The strokes are the same ones either way - only the order and the pace change - so a picture left half-drawn
   * when the time runs out still shows the whole of its subject, faintly, instead of only its top third.
   *
   * It stops if the turn moves on, and a word with no picture anywhere simply leaves the board empty.
   *
   * @param {object} room  the room (its drawing is added to)
   * @param {number} board  which board
   * @param {Function} relay  sends an event to everybody in the room
   * @param {() => number} rng  random source, for the order the strokes go on in
   * @param {() => number} now  the clock
   * @returns {Promise<void>} resolves when the picture is on the board, or there is nothing more to do
   * Side effects: fetches over the network, fills the board, emits `draw` to the room, and logs.
   */
  async function paint(room, board, relay, rng, now) {
    const key = turnKey(room);
    const word = wordFor(room, board);
    if (!word) return;
    const marks = painted.get(room.code) ?? new Set();
    marks.add(`${key}:${board}`); // marked before the fetch, so a second timer cannot start the same picture again
    painted.set(room.code, marks);
    const here = () => turnKey(room) === key && room.phase === 'drawing' && wordFor(room, board) === word;
    try {
      const { ops } = await pictureFor(word);
      if (!ops.length) {
        ctx.log(`no picture was found for "${word}"`);
        return;
      }
      const order = shuffle(ops, rng);
      // How many strokes a tick is owed, kept as a running total rather than rounded each time, so that a rate of
      // fewer strokes than there are ticks in a second still comes out right over a turn.
      const perTick = (botRate * STROKE_TICK) / 1000;
      let credit = 0;
      for (let sent = 0; sent < order.length; ) {
        await pause(STROKE_TICK);
        if (!here()) return; // the turn moved on while the picture was being fetched or drawn
        credit += perTick;
        const take = Math.min(Math.floor(credit), order.length - sent, MAX_BATCH);
        if (take < 1) continue; // not a whole stroke owed yet
        credit -= take;
        const kept = addOps(canvasOf(room, board), order.slice(sent, sent + take), now());
        sent += take;
        if (kept.length) relay(room, 'draw', { ...label(board), ops: kept });
      }
    } catch (error) {
      ctx.log(`could not draw "${word}":`, error.message);
    }
  }

  /**
   * Forgets the boards of a room that is not being drawn on, so that no room holds a canvas it will never show again,
   * nor a note of the picture that went on it.
   * @param {object} room  the room that has just changed
   * @returns {void}
   * Side effects: may drop this room's entries from `canvases` and `painted`.
   */
  function forget(room) {
    if (drawingNow(room)) return;
    canvases.delete(room.code);
    painted.delete(room.code);
  }

  /**
   * The drawing events, which go straight to the other players instead of through a view.
   * @param {object} hooks  { on, userId, socket, now, roomOf, relay } from the room server
   * @returns {void}
   * Side effects: adds socket listeners; they change this game's drawings and send to others.
   */
  function registerEvents({ on, userId, socket, now, roomOf, relay }) {
    /**
     * The room and board this socket may draw on, or a refusal to send back.
     * @returns {{ room?: object, board?: number, error?: object }}
     */
    const drawingRoom = () => {
      const room = roomOf();
      if (!room) return { error: { ok: false, error: 'notInAnyGame' } };
      if (!game.canDraw(room, userId)) return { error: { ok: false, error: 'notYourTurnToDraw' } };
      return { room, board: boardOf(room, userId) };
    };

    /**
     * Takes strokes from a drawer, keeps them with their board, and passes them to everybody else.
     * @param {unknown[]} raws  what the client sent, one entry per instruction
     * @param {string} [kind]  the instruction type when the event name says it ('line' or 'fill')
     * @returns {object} the ack for the client
     * Side effects: adds to one of this room's drawings and emits `draw` to the other players.
     */
    const draw = (raws, kind) => {
      const { room, board, error } = drawingRoom();
      if (error) return error;
      const ops = raws
        .slice(0, MAX_BATCH)
        .map((raw) => readOp(kind ? { ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}), t: kind } : raw))
        .filter(Boolean);
      if (!ops.length) return { ok: false, error: 'badDrawing' };
      const kept = addOps(canvasOf(room, board), ops, now());
      if (kept.length) relay(room, 'draw', { ...label(board), ops: kept }, { except: userId });
      return { ok: true };
    };

    /**
     * Sends a whole board, in chunks, either to this socket alone or to everybody in the room.
     * @param {object} room  the room
     * @param {number} board  which board
     * @param {object[]} ops  the instructions
     * @param {boolean} [everyone]  true to send to the whole room, false for this socket only
     * @returns {void}
     * Side effects: emits `canvas` events.
     */
    const sendCanvas = (room, board, ops, everyone = false) => {
      for (const message of canvasMessages(ops)) {
        const payload = { ...label(board), ...message };
        if (everyone) relay(room, 'canvas', payload);
        else socket.emit('canvas', payload);
      }
    };

    on('line', (payload) => draw([payload], 'line'));
    on('fill', (payload) => draw([payload], 'fill'));
    on('draw', ({ ops }) => draw(Array.isArray(ops) ? ops : []));

    on('clear', () => {
      const { room, board, error } = drawingRoom();
      if (error) return error;
      if (clear(canvasOf(room, board))) sendCanvas(room, board, [], true);
      return { ok: true };
    });

    on('undo', () => {
      const { room, board, error } = drawingRoom();
      if (error) return error;
      const drawing = canvasOf(room, board);
      if (undo(drawing)) sendCanvas(room, board, drawing.ops, true);
      // The room server's clock, not the wall clock: it is the one `addOps` stamped the drawing with.
      onUndo?.(room, drawing, userId, now());
      return { ok: true };
    });

    // Somebody opened the page, or came back, in the middle of a turn: give them the boards as they stand.
    on('canvas', () => {
      const room = roomOf();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      // Every board either way: a room that is not being drawn on answers with empty ones, which is how a client that
      // has just arrived after a turn clears what it was showing.  So `boards` has to answer out of a turn as well.
      const live = drawingNow(room);
      for (let board = 0; board < boards(room); board++) sendCanvas(room, board, live ? canvasOf(room, board).ops : []);
      return { ok: true };
    });
  }

  return { canvasOf, pictureDue, paint, forget, registerEvents };
}
