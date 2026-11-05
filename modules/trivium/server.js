// The socket layer for Trivium.  The rules live in game.js; the rooms, saving, views, joining and the lobby events are
// the shared room server (shared/roomServer.js), driven through the player-list rules of shared/roster.js.  This file
// says what is particular to Trivium: its settings, its two socket events, the clock work the game runs on, and the
// questions.
//
// **The questions come from outside the rules.**  shared/trivia.js is the site's one door to The Trivia API and to the
// site's own question bank; it is asynchronous and it is shared between every room, so it cannot live in game.js, which
// is plain data and plain functions.  When the wheel starts turning, this file asks the store for the round's
// questions of the category it stopped on and hands them to `game.deal`, and the round is under way by the time the
// wheel comes to rest.  How many questions each category holds is what the wheel's slices are cut by, so the counts are
// read once and refreshed in the background.
//
// **The game is all clock.**  Nothing waits on a person: a question closes on its deadline, the reveal walks through
// the answers and moves on, and the next wheel spins by itself.  Those, and the computer players' answers, are all run
// off the one timer the room server gives a game, soonest first.
//
// Timing can be changed through the environment (the tests make it fast):
//   TRIVIUM_ANSWER_MS     milliseconds a question is up for (default 15000)
//   TRIVIUM_SPIN_MS       milliseconds the wheel turns for (default 5000)
//   TRIVIUM_REVEAL_STEP   milliseconds the reveal takes over each answer (default 500)
//   TRIVIUM_REVEAL_HOLD   milliseconds the right answer stays up afterwards (default 3000)
//   TRIVIUM_GRACE_MS      milliseconds a round waits for its questions before the game gives up (default 20000)
//   TRIVIUM_TRIVIA        where the questions come from: "live" (default) or "test" (made up, needing no network)
//
// Depends on shared/roomServer.js, shared/trivia.js (the questions), ./game.js (the rules) and ./testing.js (the
// questions the tests use).
import { createRoomServer, pickKeys, readDelayMs } from '../../shared/roomServer.js';
import { sharedTrivia } from '../../shared/trivia.js';
import * as game from './game.js';
import { testStore } from './testing.js';

/** How often a round that is waiting on its questions looks again (milliseconds). */
const POLL_MS = 200;

/**
 * Reads the Trivium timings from the environment.
 *
 * @returns {object} the waits, all in milliseconds
 * Side effects: none (reads process.env only).
 */
function readDelays() {
  return {
    answerMs: readDelayMs('TRIVIUM_ANSWER_MS', game.ANSWER_MS),
    spinMs: readDelayMs('TRIVIUM_SPIN_MS', game.SPIN_MS),
    revealStep: readDelayMs('TRIVIUM_REVEAL_STEP', game.REVEAL_STEP_MS),
    revealHold: readDelayMs('TRIVIUM_REVEAL_HOLD', game.REVEAL_HOLD_MS),
    graceMs: readDelayMs('TRIVIUM_GRACE_MS', 20000),
  };
}

/**
 * Where the questions come from: the site's one shared cache, or the made-up ones the tests use.
 *
 * @returns {object} a trivia store (take, prime, sources)
 * Side effects: none itself; the store fetches when it is asked for questions.
 */
const questionSource = () => (process.env.TRIVIUM_TRIVIA === 'test' ? testStore() : sharedTrivia());

/**
 * Starts the Trivium server half.
 *
 * Side effects: see createRoomServer (reads the saved rooms, starts timers, registers the socket events); keeps a
 * count of each category's questions, and a note of which rooms are waiting on a round's questions.
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }} the handle the site calls on shutdown to stop timers
 */
export default function (ctx) {
  const delays = readDelays();
  const store = questionSource();

  /** An account's display name (for people who have left the room, and for rooms saved before names were kept). */
  const nameOf = (id) => ctx.users.get(id)?.displayName ?? 'Someone';

  /** How many questions there are of each category, which is what the wheel's slices are cut by; null until counted. */
  let counts = null;
  /** Whether the caches have been filled ahead of the first question (done once, when a room first stirs). */
  let primed = false;
  /** Rooms whose round has been asked for: code -> `roundKey`, so one round is never fetched twice. */
  const dealing = new Map();
  /** Rooms whose round could not be dealt: code -> the `roundKey` that gave up. */
  const givenUp = new Map();
  /**
   * Which round of which room, as a note to keep about it.  The room's own age is in it because an invite code is
   * only reserved while its room lives: a code can come round again, and a note left behind by the room that had it
   * before must not be mistaken for one about this one.
   *
   * @param {object} room  the room
   * @returns {string} the key
   * Side effects: none.
   */
  const roundKey = (room) => `${room.createdAt}:${room.round}`;

  /**
   * Asks both question sources how many they have of each category, so the wheel can be cut to match.  It is done
   * once a room stirs rather than when the site starts, and again at no particular time: the numbers only decide how
   * wide a slice is, so yesterday's are no worse than today's.
   *
   * @returns {Promise<void>} resolves when they are in (or when asking went wrong, which changes nothing)
   * Side effects: sets `counts`; reads the bank and makes one small request a category.
   */
  async function countCategories() {
    try {
      const { byCategory } = await store.sources();
      counts = Object.fromEntries(Object.entries(byCategory ?? {}).map(([category, held]) => [category, (held?.api ?? 0) + (held?.bank ?? 0)]));
    } catch (error) {
      ctx.log('the categories were not counted:', error.message); // an even wheel is a perfectly good wheel
    }
  }

  /**
   * Fetches a round's questions and hands them to the rules.  It is started as the wheel starts turning and is
   * expected to be in long before it stops; a round that cannot be dealt at all is noted, and the game then ends on
   * the scores it has rather than waiting for ever.
   *
   * @param {object} room  the room whose round is being dealt
   * @returns {Promise<void>} resolves once the questions are in, or once they are known not to be coming
   * Side effects: fills room.deck through game.deal, or notes the round in `givenUp`; logs either way.
   */
  async function dealRound(room) {
    const key = roundKey(room);
    const category = room.spin?.category;
    dealing.set(room.code, key);
    try {
      const questions = await store.take(room.perRound, { category });
      // The room may have moved on while the questions were on their way (everybody left, the game was given up on).
      if (room.phase === 'spin' && roundKey(room) === key) game.deal(room, questions);
    } catch (error) {
      ctx.log('no questions to be had for', category, ':', error.code ?? error.message);
      givenUp.set(room.code, key);
    }
  }

  return createRoomServer(ctx, {
    game,
    pickSettings,
    members: (room) => room.players,
    kickKey: 'userId', // the client names the person to remove by account id, not by a seat number
    playerExtras: (userId) => ({ colour: ctx.markers.preferred(userId) }),
    viewOptions: (room, userId, now) => ({ nameOf, canCustom: ctx.markers.canCustom(userId), now: now() }),
    createArgs: () => ({ counts: counts ?? {}, answerMs: delays.answerMs, spinMs: delays.spinMs, revealStep: delays.revealStep, revealHold: delays.revealHold }),
    migrate: (room) => game.migrate(room, nameOf),
    /**
     * After every change: fill the question caches the first time anybody stirs, keep a waiting room's wheel in step
     * with what the sources actually hold, and forget the notes kept about a room that has moved on.
     *
     * @param {object} room  the room that has just changed
     * @returns {void}
     * Side effects: may prime the store and count the categories (both in the background), may replace room.wheel,
     *   and tidies this module's maps.
     */
    afterChange(room) {
      if (!primed) {
        primed = true;
        store.prime().catch((error) => ctx.log('the question caches were not filled:', error.code ?? error.message));
        void countCategories();
      }
      if (room.phase === 'lobby' && counts) game.setWheel(room, counts);
      if (!game.isLive(room)) {
        dealing.delete(room.code);
        givenUp.delete(room.code);
      }
    },
    /**
     * The clock work of a game, which is several clocks run off the one timer the room server gives a module: the
     * round's questions being asked for, the wheel coming to rest, a computer player answering, the question's
     * deadline, and the end of a reveal.  Whichever is due soonest is the one scheduled; doing it changes the room,
     * which works the next one out again.
     *
     * @param {object} room  the room to look at
     * @param {() => number} rng  random source, for the spin and the computer players
     * @param {() => number} now  the clock
     * @returns {{ key?: string, wait: number, run: () => void } | null} what to do, or null when nothing is due
     * Side effects: none while choosing; the returned run() moves the room on, or starts a fetch.
     */
    nextAction(room, rng, now) {
      if (room.phase === 'spin') return spinAction(room, rng, now);
      if (room.phase === 'question') return questionAction(room, now);
      if (room.phase === 'reveal') {
        return {
          key: `next:${room.round}:${room.ask}`,
          wait: Math.max(0, room.revealUntil - now()),
          run: () => insist(game.nextQuestion(room, rng, now())),
        };
      }
      return null;
    },
    /**
     * Adds Trivium's own socket events to each connection.
     *
     * @param {{act: Function, on: Function, userId: number, now: () => number}} h  the room server's helpers
     * @returns {void}
     * Side effects: registers socket event handlers; each event later mutates the room through the rules and broadcasts.
     */
    registerEvents({ act, on, userId, now }) {
      on('colour', ({ colour }) => act((room) => game.setColour(room, userId, colour, ctx.markers.canCustom(userId))));
      on('answer', ({ choice, x, y }) => act((room) => game.answer(room, userId, choice, x, y, now())));
    },
  });

  /**
   * While the wheel turns: get the round's questions if nobody has asked for them yet, wait for them if somebody has,
   * and put the first question up once the wheel has come to rest.  A round whose questions never come gives up, so
   * that a quiz with nothing to ask ends on the scores it has instead of spinning for ever.
   *
   * @param {object} room  the room
   * @param {() => number} rng  random source
   * @param {() => number} now  the clock
   * @returns {{ key: string, wait: number, run: () => void }} what to do next
   * Side effects: none itself.
   */
  function spinAction(room, rng, now) {
    const round = `${room.round}`;
    const key = roundKey(room);
    const stuck = givenUp.get(room.code) === key || now() - room.spinUntil > delays.graceMs;
    if (!room.deck.length && stuck) return { key: `giveup:${round}`, wait: 0, run: () => insist(game.giveUp(room)) };
    if (!room.deck.length && dealing.get(room.code) !== key) return { key: `deal:${round}`, wait: 0, run: () => void dealRound(room) };
    if (!room.deck.length) return { key: `wait:${round}`, wait: POLL_MS, run: () => {} };
    return { key: `ask:${round}:${room.ask}`, wait: Math.max(0, room.spinUntil - now()), run: () => insist(game.askNext(room, rng, now())) };
  }

  /**
   * While a question is up: whichever comes first, the next computer player's answer or the deadline.
   *
   * @param {object} room  the room
   * @param {() => number} now  the clock
   * @returns {{ key: string, wait: number, run: () => void }} what to do next
   * Side effects: none itself.
   */
  function questionAction(room, now) {
    const question = `${room.round}:${room.ask}`;
    const bot = game.pendingBotAction(room);
    const deadline = { key: `deadline:${question}`, at: room.deadline, run: () => insist(game.timeUp(room, now())) };
    const due = bot && bot.at < room.deadline ? { key: `bot:${question}:${bot.id}`, at: bot.at, run: () => insist(answered(game.runBotAction(room, now(), bot))) } : deadline;
    return { key: due.key, wait: Math.max(0, due.at - now()), run: due.run };
  }
}

/**
 * Turns a computer player's answer that the rules would not have into the shape `insist` understands, so that a
 * refused move is retried rather than quietly repeated for ever.
 *
 * @param {boolean} played  whether the rules took the answer
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: none.
 */
const answered = (played) => (played ? { ok: true } : { ok: false, error: 'botAnswerRefused' });

/**
 * Turns a refused clock action into a throw, so that the room server logs it and tries again rather than leaving the
 * room waiting for ever on something that quietly did nothing.
 *
 * @param {{ ok: boolean, error?: string }} outcome  what the rule returned
 * @returns {void}
 * Side effects: throws on a refusal.
 */
function insist(outcome) {
  if (!outcome.ok) throw new Error(outcome.error);
}

/**
 * Only the settings the host may choose, whatever else a client sends.
 *
 * @param {object} payload  the settings the client sent (untrusted)
 * @returns {object} a new object with just `rounds` and `perRound`
 * Side effects: none.
 */
function pickSettings(payload) {
  return pickKeys(payload, ['rounds', 'perRound']);
}
