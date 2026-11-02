// The socket layer for Scribblers.  The rules live in game.js; the rooms, saving, views, joining, and the lobby events
// are the shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.  This
// file says what is particular to Scribblers: its settings, its own socket events, the clock work a turn needs (a word
// chosen for a drawer who dithers, a letter revealed, the end of a turn), the computer players, and the drawing itself.
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
//   SCRIBBLERS_BOT_DELAY     "min-max" milliseconds a computer player waits before choosing a word or guessing (default 700-1300)
//   SCRIBBLERS_BOT_DRAW      milliseconds before a computer player starts drawing its picture (default 1200)
//   SCRIBBLERS_PICTURES      where a computer player's pictures come from: "web" (default), "test" (bands worked out
//                            from the word, needing no network, which is what the tests use) or "off" (draw nothing)
//
// **A computer player draws.**  Its AI chooses the word (ai/, driven through game.js), and then this file fetches a
// picture of it from the web (picture.js) and puts it on the board a message-full of strokes at a time, which an AI may
// not do itself: an AI is a function of plain data, with no clock and no network.  Nothing else about a computer
// player is special - its guesses go through the same rules as anybody's.
//
// Depends on shared/roomServer.js (the room server and its timing helpers), ./game.js (the rules), ./drawing.js (the
// canvas and what may go on it) and ./picture.js (a word turned into something to draw).
import { botWait, createRoomServer, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import { MAX_BATCH, addOps, canvasMessages, clear, newDrawing, readOp, undo } from './drawing.js';
import * as game from './game.js';
import { drawingFor, testPicture } from './picture.js';

/** How long the server waits between one message-full of a computer player's picture and the next (milliseconds). */
const STROKE_PAUSE = 120;

/**
 * Where a computer player's pictures come from.
 * @returns {(word: string) => Promise<{ ops: object[], url: string | null }>} the instructions for a word
 * Side effects: none itself; the "web" source fetches when it is called.
 */
function pictureSource() {
  const kind = process.env.SCRIBBLERS_PICTURES ?? 'web';
  if (kind === 'off') return async () => ({ ops: [], url: null });
  if (kind === 'test') return async (word) => ({ ops: testPicture(word), url: 'test' });
  return (word) => drawingFor(word);
}

/**
 * Waits, without keeping the process alive on its own account.
 * @param {number} ms  how long to wait
 * @returns {Promise<void>}
 * Side effects: sets an unreferenced timer.
 */
const pause = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * Reads the Scribblers timings from the environment.
 * @returns {object} the waits, all in milliseconds (`bot` is a { min, max } range)
 * Side effects: none (reads process.env).
 */
function readDelays() {
  return {
    chooseMs: readDelayMs('SCRIBBLERS_CHOOSE_WAIT', game.CHOOSE_MS),
    betweenMs: readDelayMs('SCRIBBLERS_BETWEEN_WAIT', game.BETWEEN_MS),
    scoresMs: readDelayMs('SCRIBBLERS_SCORES_WAIT', 60000),
    awayMs: readDelayMs('SCRIBBLERS_AWAY_WAIT', 8000),
    bot: readDelayRange('SCRIBBLERS_BOT_DELAY', '700-1300'),
    botDraw: readDelayMs('SCRIBBLERS_BOT_DRAW', 1200),
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
  const pictureFor = pictureSource();
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

  /** The turn each room's computer player has already been given a picture for: code -> '<round>:<turn>'. */
  const painted = new Map();

  /**
   * Has this room's computer player still to be given its picture?  Only once a turn, and only while the board is
   * empty, so that a computer player standing in for somebody who left does not paint over what they had drawn.
   * @param {object} room  the room
   * @returns {boolean}
   * Side effects: none.
   */
  const pictureDue = (room) => painted.get(room.code) !== `${room.round}:${room.turn}` && canvasOf(room).ops.length === 0;

  /**
   * Draws a computer player's word: a picture of it is fetched from the web and put on the board a message-full of
   * strokes at a time, so the others watch it appear rather than meeting it all at once.  It stops if the turn moves
   * on, and a word with no picture anywhere simply leaves the board empty.
   *
   * @param {object} room  the room (its drawing is added to)
   * @param {Function} relay  sends an event to everybody in the room
   * @param {() => number} now  the clock
   * @returns {Promise<void>} resolves when the picture is on the board, or there is nothing more to do
   * Side effects: fetches twice over the network, fills this room's drawing, emits `draw` to the room, and logs.
   */
  async function paint(room, relay, now) {
    const turn = `${room.round}:${room.turn}`;
    painted.set(room.code, turn); // marked before the fetch, so a second timer cannot start the same picture again
    const word = room.word;
    const here = () => `${room.round}:${room.turn}` === turn && room.phase === 'drawing' && room.word === word;
    try {
      const { ops } = await pictureFor(word);
      if (!ops.length) {
        ctx.log(`no picture was found for "${word}"`);
        return;
      }
      for (let at = 0; at < ops.length; at += MAX_BATCH) {
        if (!here()) return; // the turn moved on while the picture was being fetched or sent
        const kept = addOps(canvasOf(room), ops.slice(at, at + MAX_BATCH), now());
        if (kept.length) relay(room, 'draw', { ops: kept });
        await pause(STROKE_PAUSE);
      }
    } catch (error) {
      ctx.log(`could not draw "${word}":`, error.message);
    }
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
     * The clock work of a turn, which is several clocks run off the one timer the room server gives a game: a word
     * chosen for a drawer who did not choose one, a letter revealed, the end of the drawing, the next turn, the next
     * round, a computer player's move, the picture a computer player draws, and the end of a turn nobody is there to
     * draw.  Whichever of them is due soonest is the one scheduled; doing it changes the room, which works the next one
     * out again.
     *
     * A drawer who closes the page is noticed when the next scheduled thing happens (a letter, the end of the turn),
     * because a connection going is not itself a change to the room; the turn therefore ends within a letter's time of
     * their leaving rather than the moment they go.
     *
     * @param {object} room  the room
     * @param {() => number} rng  random source
     * @param {() => number} now  the clock
     * @param {{ online: (id: *) => boolean, relay: Function }} who  who is connected right now (read again when the
     *   timer fires), and how to send a stream to the room (the picture a computer player draws)
     * @returns {{ key?: string, wait: number, run: () => void } | null} what to schedule, or null when nothing is due
     * Side effects: none itself; the returned run() moves the room on, or starts a picture.
     */
    nextAction(room, rng, now, { online, relay }) {
      const turnKey = `${room.round}:${room.turn}`;
      const drawer = room.players.find((p) => p.id === room.drawer);
      const drawing = ['choosing', 'drawing'].includes(room.phase);

      // A person was drawing and has gone: nothing else about the turn matters until they are back, so this is asked
      // first rather than taking its turn with the rest.
      if (drawing && game.isHuman(drawer) && !online(room.drawer)) {
        return {
          key: `away:${turnKey}`,
          wait: delays.awayMs,
          run() {
            if (!online(room.drawer)) insist(game.skipTurn(room, now()));
          },
        };
      }
      // A computer player has a word and an empty board: fetch a picture of it and start painting (once a turn).
      if (room.phase === 'drawing' && drawer && !game.isHuman(drawer) && pictureDue(room)) {
        return { key: `picture:${turnKey}`, wait: delays.botDraw, run: () => void paint(room, relay, now) };
      }

      // Everything else takes its turn by when it is due.
      const due = [];
      const bot = game.pendingBotAction(room);
      if (bot) {
        const tries = room.players.find((p) => p.id === bot.id)?.tries ?? 0;
        due.push({
          key: `bot:${turnKey}:${bot.type}:${bot.id}:${tries}`,
          at: now() + botWait(delays.bot, rng),
          // runBotAction answers with whether it played, not with a rule's outcome, so a refusal is turned into a throw
          // here instead (the room server then logs it and tries again after a pause).
          run() {
            if (!game.runBotAction(room, rng, now(), bot)) throw new Error(`the computer move ${bot.type} for ${bot.id} was refused`);
          },
        });
      }
      if (room.phase === 'scores') {
        due.push({ key: `scores:${room.round}`, at: now() + delays.scoresMs, run: () => insist(game.forceNextRound(room, rng, now())) });
      }
      if (room.nextHintAt !== null && room.nextHintAt !== undefined) {
        due.push({ key: `hint:${turnKey}:${room.hintsLeft}`, at: room.nextHintAt, run: () => insist(game.revealHint(room, rng, now())) });
      }
      if (room.deadline !== null && room.deadline !== undefined) {
        due.push({ key: `deadline:${turnKey}:${room.phase}`, at: room.deadline, run: () => insist(game.timeUp(room, rng, now(), nameOf)) });
      }
      if (!due.length) return null;
      const soonest = due.reduce((first, next) => (next.at < first.at ? next : first));
      return { key: soonest.key, wait: Math.max(0, soonest.at - now()), run: soonest.run };
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
