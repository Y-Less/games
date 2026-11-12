// The socket layer every seated game shares.  A game's server.js used to be a ~280 line copy of this file with a few
// words changed; now it states only what is different about the game (its settings, its own socket events, what the
// server has to do by itself next) and createRoomServer() does the rest:
//
//   - keeps the rooms in memory and saves them under ctx.dataDir (debounced, written atomically);
//   - throws away old rooms every hour;
//   - remembers which sockets each account has open and sends every person their own view of the room;
//   - joins, resumes, creates, leaves, and kicks, and the lobby events (settings, addBot, removeBot, fillBots, start, again);
//   - runs the game's "next thing the server does by itself" (a computer move, a pause between tricks...) on a timer;
//   - reports a finished game to the statistics once.
//
// Nothing here knows any rules.  The game's rules module (`game`) must provide the seat vocabulary described under
// `options.game` below; seats.js (also shared) implements most of it for games with numbered seats, and roster.js for games that keep a list of players (set options.members and options.layout for those).
//
// Randomness and the clock are injected (`options.rng`, `options.now`) so a test can make a server deterministic;
// the defaults (Math.random and Date.now) are chosen once, here, and nowhere else in the shared code or the rules.  The same
// `rng` and `now` reach the rules (start, removeHuman, kick), the game's own socket events (registerEvents gets `rng`),
// `nextAction(room, rng, now)` and so the computer players, so one seed replays a whole game.
// Depends on: node:fs and node:path only; the rules module, ctx and clock are injected through createRoomServer arguments.
import { refusalReply } from './messages.js';
import { createRoomLife } from './roomLife.js';
import { seatLayout } from './layout.js';

/**
 * How long a computer player seems to think before it acts, as "min-max" milliseconds.  The pause is not for the
 * computer's sake — it decides in a millisecond or two — but so that a person can see what happened before the next
 * thing happens.
 */
export const THINKING = '600-1400';
/**
 * The same, for a game of cards.  A card game asks for far more moves than a board game does, and each one is
 * smaller: a hand of Hearts is fifty-two plays, where a game of Azulejo is a few dozen.  A pause long enough to
 * follow a move that rearranges a board is dead time fifty times over when the move is one card, so a card game's
 * computer players think for about half as long.
 */
export const CARD_THINKING = '300-700';

/**
 * Reads a "min-max" milliseconds range from the environment (the tests make computer players fast this way).
 *
 * @param {string} name       the environment variable, e.g. 'HEARTS_BOT_DELAY'
 * @param {string} fallback   the range used when it is unset or malformed, e.g. THINKING
 * @returns {{ min: number, max: number }} min is never negative and max is never below min
 * Side effects: none (reads process.env).
 */
export function readDelayRange(name, fallback) {
  const parse = (text) => String(text).split('-').map(Number);
  let [min, max] = parse(process.env[name] ?? fallback);
  const [fallbackMin, fallbackMax] = parse(fallback);
  if (!Number.isFinite(min) || min < 0) min = fallbackMin;
  if (!Number.isFinite(max)) max = Math.max(fallbackMax, min);
  return { min, max: Math.max(max, min) };
}

/**
 * Reads a single number of milliseconds from the environment.
 *
 * @param {string} name      the environment variable, e.g. 'HEARTS_TRICK_PAUSE'
 * @param {number} fallback  used when it is unset, not a number or negative
 * @returns {number}
 * Side effects: none (reads process.env).
 */
export function readDelayMs(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Picks how long a computer player should wait before acting.
 *
 * @param {{ min: number, max: number }} range  from readDelayRange
 * @param {() => number} rng                    a random number generator returning [0, 1) (required: pass the server's)
 * @returns {number} milliseconds
 * Side effects: none beyond advancing `rng` once.
 */
export function botWait(range, rng) {
  return range.min + rng() * (range.max - range.min);
}

/**
 * Keeps only the named keys of a payload that a client actually sent (a "settings" or "create" message).
 *
 * @param {object | undefined} payload  whatever the client sent
 * @param {string[]} keys               the settings the game accepts
 * @returns {object} a new object with just those keys, leaving out the undefined ones
 * Side effects: none.
 */
export function pickKeys(payload, keys) {
  const picked = {};
  for (const key of keys) if (payload && Object.hasOwn(payload, key) && payload[key] !== undefined) picked[key] = payload[key];
  return picked;
}

/**
 * A refusal as the client receives it: the rules' code and, when its words need them, the values to put in (see
 * shared/messages.js).  Without the values a sentence such as "You need at least {min} players." reaches the player with
 * the gap still in it.
 * @param {{ error?: string, params?: object }} outcome  what a rule returned, which the caller has already found to
 *   have failed — so it has an error, even though a rule result on its own only says it might
 * @returns {{ ok: false, error: string, params?: object }}
 * Side effects: none.
 */
const refused = (outcome) => ({ ok: false, error: /** @type {string} */ (outcome.error), ...(outcome.params ? { params: outcome.params } : {}) });

/**
 * Builds the server half of a seated game.
 *
 * Side effects: reads the saved rooms from disk now, starts an hourly sweep timer, registers a 'connection' handler on
 * ctx.io, and later writes the rooms to disk and sets timers for computer moves. dispose() undoes the timers.
 *
 * @param {object} ctx  the module context the site gives server.js (io, dataDir, log, codes, stats, ...)
 * @param {object} options
 * @param {object} options.game  the rules module.  It must export: createRoom({ code, hostId, hostName, settings, ...extra })
 *   (the one rule that throws instead of returning { ok: false }: the Error's message is shown to the person, so throw
 *   only what they should read, such as "Play to 61 or 121."),
 *   viewFor(room, userId, viewOptions), statsPlayers(room), isLive(room), isHuman(seat), hasPlayer(room, userId),
 *   seatOf(room, userId), addHuman(room, userId, name), removeHuman(room, userId, rng, now) (returns { ok, empty, ... };
 *   `changed: false` says the room was left as it was, e.g. a finished list game keeps its standings, so nothing is saved or sent),
 *   kick(room, hostId, seat, rng, now), setSettings(room, userId, settings), addBot(room, userId, seat),
 *   removeBot(room, userId, seat, rng), fillWithBots(room, userId), start(room, userId, rng, now), playAgain(room, userId).
 *   Every rule returns { ok: true, ... } or { ok: false, error }.
 * @param {(payload: object) => object} options.pickSettings  keeps only the settings the game accepts from a client message
 * @param {(room: object, rng: () => number, now: () => number, who: { online: (id: number) => boolean, relay: Function }) => ({ key?: string, wait: number, run: () => void } | null)} options.nextAction  what the server
 *   must do by itself next, if anything (given the server's `rng` and `now`, to hand to botWait and the computer players,
 *   `who.online` for rules that wait on somebody being there, and `who.relay` for a job that sends a stream of its own,
 *   as `registerEvents` gets): `wait` milliseconds from now it calls `run()` (a computer move, the end of a trick
 *   pause...).  If `key` is given and the same key is already waiting, the existing timer is kept instead of restarted.
 * @param {(h: object) => void} options.registerEvents  adds the game's own socket events.  It is called for every connection
 *   with { on, act, userId, socket, rng, now, roomOf, relay } (the server's random numbers and clock, for rules that need them): `on(event, handler)` wraps a handler (payload in, ack object out) with validation and
 *   error handling; `act(rule)` runs rule(room, seat) on the room this socket is in and tells everybody if it worked;
 *   `roomOf()` is the room this socket is looking at (undefined outside one); `relay(room, event, payload, { except })`
 *   sends an event straight to the room's people, for a stream no view can carry (the strokes of a drawing).
 * @param {(payload: object) => object} [options.createArgs]  extra arguments for game.createRoom beyond the settings
 * @param {(userId: number) => object} [options.playerExtras]  what the server knows about a person that the rules need when they
 *   take a place (for example their preferred marker colour).  It is merged into the game.createRoom arguments for the host
 *   and handed to game.addHuman as a fourth argument for everybody who joins.
 * @param {(room: object, userId: number, now: () => number) => object} [options.viewOptions]  extra options for game.viewFor (such as the current
 *   time, or something that depends on who is looking)
 * @param {(room: object) => object[]} [options.members]  the people and computer players of a room, each with `kind` and `id`
 *   (default: room.seats, which has null for an empty seat; the player-list games of shared/roster.js use room.players)
 * @param {{ slotOf: Function, indexOf: Function, at: Function }} [options.layout]  how this game's places are laid out
 *   (shared/layout.js): `seatLayout` for numbered seats (the default), `rosterLayout` for a list of players.  It is
 *   what turns the slot a client names into the member sitting in it.
 * @param {(room: object, userId: number) => object} [options.startRule]  replaces game.start for the 'start' event
 * @param {(room: object) => object} [options.migrate]  brings a saved room up to date when it is loaded
 * @param {(room: object) => void} [options.afterChange]  runs after every change to a room, before it is saved and sent to
 *   anybody (for something the game does once per change, such as handing out achievements).  A throw is logged and ignored.
 * @param {() => number} [options.rng]  random numbers for rules that need them (default Math.random, created once here)
 * @param {() => number} [options.now]  the clock in milliseconds (default Date.now, created once here)
 * @returns {{ dispose: () => void, rooms: Map<string, object> }} dispose() stops timers and saves; `rooms` is exposed for tests
 */
export function createRoomServer(ctx, options) {
  const { game, pickSettings, nextAction, registerEvents, createArgs = () => ({}), viewOptions = () => ({}), playerExtras = () => ({}), afterChange, members = (room) => room.seats, layout = seatLayout, startRule, migrate, rng = Math.random, now = Date.now } = options;

  // Everything that happens to a room, as against anybody asking for it: shared/roomLife.js owns the saved rooms, the
  // open sockets, the timers, and the vote running in a room.  What is left in this file is the protocol — the events
  // a client may send, what each of them is allowed to do, and what it is told back.
  const life = createRoomLife({ ctx, game, members, layout, viewOptions, afterChange, playerExtras, nextAction, migrate, rng, now });
  const { votes } = life;

  // One connection per browser tab: track the socket, register the shared events, then the game-specific ones.
  ctx.io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    life.addSocket(userId, socket);

    // Returns the room this socket is currently looking at, or undefined.
    const roomOfSocket = () => life.roomAt(socket.data.code);

    /**
     * Registers a socket event.  The handler gets the payload (always a plain object, never an array or null) and returns
     * the ack object ({ ok: true } if it returns nothing); a throw is logged and the client gets a generic error.
     * @param {string} event  the socket event name
     * @param {(payload: object) => (object | undefined)} handler  the work to do
     * @returns {object} the socket (from socket.on)
     * Side effects: registers a listener on the socket; each call replies through the client ack callback and may log.
     */
    const on = (event, handler) =>
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          reply(handler(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) ?? { ok: true });
        } catch (error) {
          ctx.log(`${event} failed:`, error);
          reply({ ok: false, error: 'serverError' });
        }
      });

    /**
     * Runs a rule on the room this socket is in, then tells everyone if it worked.
     * The rule gets (room, seat); the client only ever sees { ok } or { ok: false, error }.
     * @param {(room: object, seat: number) => { ok: boolean, error?: string }} rule  the rule to run
     * @returns {{ ok: boolean, error?: string }} the ack for the client
     * Side effects: whatever the rule mutates; calls `changed(room)` on success.
     */
    const act = (rule) => {
      const room = roomOfSocket();
      const seat = room ? game.seatOf(room, userId) : -1;
      if (seat === -1) return { ok: false, error: 'notInAnyGame' };
      const outcome = rule(room, seat);
      if (outcome.ok) life.changed(room);
      return outcome.ok ? { ok: true } : refused(outcome);
    };

    on('resume', ({ code }) => life.enter(socket, code));
    on('join', ({ code }) => (typeof code === 'string' && code.trim() ? life.enter(socket, code) : { ok: false, error: 'typeInviteCode' }));

    on('create', (payload) => {
      const mine = life.liveRoomOf(userId);
      if (mine) {
        life.attach(socket, mine);
        return { ok: false, error: 'alreadyInGameStart', params: { code: mine.code } };
      }
      let room;
      try {
        room = game.createRoom({
          code: ctx.codes.generate((c) => life.taken(c)),
          hostId: userId,
          hostName: socket.data.user.name,
          settings: pickSettings(payload),
          now: now(),
          ...playerExtras(userId),
          ...createArgs(payload),
        });
      } catch (error) {
        ctx.log('create refused:', error.message); // a rules bug would surface here too, so keep a trace of it
        return refusalReply(error); // a refusal the rules threw keeps its code; anything else is a bug, and is a plain server error
      }
      life.leaveAllRooms(userId);
      life.keep(room);
      life.attach(socket, room);
      return { ok: true, code: room.code };
    });

    on('leave', () => {
      const room = roomOfSocket();
      if (!room) return { ok: true };
      if (!game.hasPlayer(room, userId)) {
        socket.data.code = null;
        socket.emit('state', null);
        return { ok: true };
      }
      life.leaveRoom(room, userId);
      return { ok: true };
    });

    // The host removes someone: the rules refuse a finished game, a missing seat, and the host themselves.
    on('kick', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const outcome = game.kick(room, userId, payload.slot, rng, now());
      if (!outcome.ok) return refused(outcome);
      life.detach(outcome.userId, room.code);
      life.changed(room);
      return { ok: true };
    });

    // Anybody may ask for a player to be put out, and the others answer; the host still has `kick` for an outright one.
    on('voteKick', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const asked = votes.ask(room, userId, payload.slot);
      if (!asked.ok) return refused(asked);
      life.changed(room);
      return { ok: true };
    });

    on('voteAnswer', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const answered = votes.answer(room, userId, payload.agree === true);
      if (!answered.ok) return refused(answered);
      if (answered.target !== null) life.putOutByVote(room, answered.target);
      else life.changed(room);
      return { ok: true, passed: Boolean(answered.passed) };
    });

    on('voteDrop', () => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const dropped = votes.drop(room, userId);
      if (!dropped.ok) return refused(dropped);
      life.changed(room);
      return { ok: true };
    });

    on('settings', (payload) => act((room) => game.setSettings(room, userId, pickSettings(payload))));
    on('addBot', ({ seat }) => act((room) => game.addBot(room, userId, seat)));
    on('removeBot', ({ slot }) => act((room) => game.removeBot(room, userId, slot, rng)));
    on('fillBots', (payload) => act((room) => game.fillWithBots(room, userId, payload.count)));
    on('start', () => act((room) => (startRule ?? game.start)(room, userId, rng, now())));
    on('again', () => act((room) => game.playAgain(room, userId)));

    registerEvents({ on, act, userId, socket, rng, now, roomOf: roomOfSocket, relay: life.relay });

    socket.on('disconnect', () => {
      life.dropSocket(userId, socket);
      const room = roomOfSocket();
      // Somebody going is not a change to the room, but it can change what the server owes it next: a game that waits
      // on a player who has gone (a drawer who shut the tab) must be given the chance to set that timer now, rather
      // than only when something else happens to fire.  An unchanged `nextAction` keeps the timer it already has.
      if (room) {
        life.push(room);
        life.reschedule(room);
      }
    });
  });

  return { rooms: life.rooms, dispose: life.dispose };
}
