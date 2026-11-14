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
//   SCRIBBLERS_BOT_RATE      strokes a second a computer player draws at (default 100; the tests turn it right up)
//   SCRIBBLERS_PICTURES      where a computer player's pictures come from: "web" (default), "test" (bands worked out
//                            from the word, needing no network, which is what the tests use) or "off" (draw nothing)
//
// **A computer player draws.**  Its AI chooses the word (ai/, driven through game.js), and then this file fetches a
// picture of it from the web (picture.js) and puts it on the board a few strokes a second, in a scattered order, which
// an AI may not do itself: an AI is a function of plain data, with no clock and no network.  Nothing else about a
// computer player is special - its guesses go through the same rules as anybody's.
//
// **Words the players add** are kept here too: a word added in a lobby is used in that game and saved under the
// module's data folder, so it is offered in later games as well.  The rules never touch a file, so they are given the
// saved words when a room is made.
//
// Depends on shared/roomServer.js (the room server and its timing helpers), ./game.js (the rules), and
// shared/strokeRelay.js (the boards, the strokes on them, and the picture a computer player paints).
import fs from 'node:fs';
import path from 'node:path';
import { accountNames, botMove, botWait, createRoomServer, insist, pickKeys, readDelayMs, readDelayRange } from '../../shared/roomServer.js';
import { rosterLayout } from '../../shared/layout.js';
import { BOT_STROKE_RATE, createStrokeRelay, pictureSource, readRate } from '../../shared/strokeRelay.js';
import * as game from './game.js';

/** How soon after filling the board somebody has to undo it to have thought better of it ("Arrgh!", milliseconds). */
const ARRGH_MS = 5000;
/** How many words added by players are kept from one game to the next. */
const KEEP_WORDS = 500;

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
    botRate: readRate('SCRIBBLERS_BOT_RATE', BOT_STROKE_RATE), // strokes a second, not milliseconds
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
  const wordsFile = path.join(ctx.dataDir, 'added-words.json');

  /**
   * The words people have added in earlier games, read once.  An unreadable file is logged and treated as none: a word
   * list is not worth refusing to start a game over.
   * @returns {string[]} the words, oldest first
   * Side effects: reads the file, and may log.
   */
  function readWords() {
    try {
      const saved = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
      return (Array.isArray(saved?.words) ? saved.words : []).filter((word) => typeof word === 'string');
    } catch (error) {
      if (error.code !== 'ENOENT') ctx.log('could not read the added words:', error.message);
      return [];
    }
  }

  const addedWords = readWords();

  /**
   * Keeps a word somebody added, for this game and for the ones after it.  The newest KEEP_WORDS are kept, written
   * atomically (a temporary file renamed over the real one) so that a crash mid-write leaves the old list whole.
   * @param {string} word  the word, as the rules accepted it
   * @returns {void}
   * Side effects: adds to `addedWords` and rewrites the file; a failure is logged, never thrown.
   */
  function rememberWord(word) {
    if (addedWords.includes(word)) return;
    addedWords.push(word);
    if (addedWords.length > KEEP_WORDS) addedWords.splice(0, addedWords.length - KEEP_WORDS);
    try {
      fs.writeFileSync(`${wordsFile}.tmp`, JSON.stringify({ words: addedWords }));
      fs.renameSync(`${wordsFile}.tmp`, wordsFile);
    } catch (error) {
      ctx.log('could not save the added words:', error.message);
    }
  }
  /** An account's display name (for people who have left the room, and for rooms saved before names were kept). */
  const nameOf = accountNames(ctx);

  // The board, the strokes on it, and the picture a computer player paints: shared/strokeRelay.js, which Draw! uses
  // too.  Scribblers has one board a turn, so it says nothing about which, and the relay's defaults are its own.
  const strokes = createStrokeRelay({
    ctx,
    game,
    turnKey: (room) => `${room.round}:${room.turn}`,
    wordFor: (room) => room.word,
    pictureFor: pictureSource('SCRIBBLERS_PICTURES'),
    botRate: delays.botRate,
    // "Arrgh!": the fill went everywhere, and the drawer thought better of it within a few seconds.
    onUndo(room, drawing, userId, now) {
      if (!(drawing.lastFillAt > 0 && now - drawing.lastFillAt <= ARRGH_MS)) return;
      drawing.lastFillAt = 0; // once per fill, not once per undo
      try {
        ctx.achievements.add(userId, 'arrgh');
      } catch (error) {
        ctx.log('could not record Arrgh!:', error.message);
      }
    },
  });

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,
    layout: rosterLayout, // a list of players rather than numbered seats (shared/layout.js)
    viewOptions: (room, userId, now) => ({ nameOf, now: now() }),
    createArgs: () => ({ chooseMs: delays.chooseMs, betweenMs: delays.betweenMs, added: addedWords }),
    migrate: (room) => game.migrate(room, nameOf),
    afterChange: strokes.forget,
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
      const inTurn = ['choosing', 'drawing'].includes(room.phase);

      // A person was drawing and has gone: nothing else about the turn matters until they are back, so this is asked
      // first rather than taking its turn with the rest.
      if (inTurn && game.isHuman(drawer) && !online(room.drawer)) {
        return {
          key: `away:${turnKey}`,
          wait: delays.awayMs,
          run() {
            if (!online(room.drawer)) insist(game.skipTurn(room, now()));
          },
        };
      }
      // A computer player has a word and an empty board: fetch a picture of it and start painting (once a turn).
      if (room.phase === 'drawing' && drawer && !game.isHuman(drawer) && strokes.pictureDue(room)) {
        return { key: `picture:${turnKey}`, wait: delays.botDraw, run: () => void strokes.paint(room, 0, relay, rng, now) };
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
          // (botMove), and the room server then logs it and tries again after a pause.
          run: botMove(bot, 0, () => game.runBotAction(room, rng, now(), bot)).run,
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
      on('vote', ({ dir }) => act((room) => game.vote(room, userId, dir, now())));

      // A word somebody adds in the lobby is used in this game and kept for the ones after it.
      on('addWord', ({ text }) => {
        let added = null;
        const reply = act((room) => {
          const outcome = game.addWord(room, userId, text);
          if (outcome.ok && outcome.word) added = outcome.word;
          return outcome;
        });
        if (added) rememberWord(added);
        return reply;
      });

      // line, fill, draw, clear, undo and canvas: the same relay Draw! uses (shared/strokeRelay.js).
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
