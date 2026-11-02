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
// `options.game` below; seats.js (also shared) implements most of it for games with numbered seats, and roster.js for games that keep a list of players (set options.members and options.kickKey for those).
//
// Randomness and the clock are injected (`options.rng`, `options.now`) so a test can make a server deterministic;
// the defaults (Math.random and Date.now) are chosen once, here, and nowhere else in the shared code or the rules.  The same
// `rng` and `now` reach the rules (start, removeHuman, kick), the game's own socket events (registerEvents gets `rng`),
// `nextAction(room, rng, now)` and so the computer players, so one seed replays a whole game.
// Depends on: node:fs and node:path only; the rules module, ctx and clock are injected through createRoomServer arguments.
import fs from 'node:fs';
import path from 'node:path';
import { refusalReply } from './messages.js';

// Retention and timing: how long to keep a finished room, then an unfinished one (kept longer: players may return to a
// paused game), how often to sweep for old rooms, and how long to debounce saves.
const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const KEEP_OTHER_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 100;

/** How many times in a row a scheduled move may throw before the server stops retrying it, and how long it waits (doubling). */
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

/**
 * Reads a "min-max" milliseconds range from the environment (the tests make computer players fast this way).
 *
 * @param {string} name       the environment variable, e.g. 'HEARTS_BOT_DELAY'
 * @param {string} fallback   the range used when it is unset or malformed, e.g. '600-1400'
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
 * @param {string} [options.kickKey]  the field of the 'kick' message that names who to remove (default 'seat'; the
 *   player-list games send the account id as 'userId')
 * @param {(room: object, userId: number) => object} [options.startRule]  replaces game.start for the 'start' event
 * @param {(room: object) => object} [options.migrate]  brings a saved room up to date when it is loaded
 * @param {(room: object) => void} [options.afterChange]  runs after every change to a room, before it is saved and sent to
 *   anybody (for something the game does once per change, such as handing out achievements).  A throw is logged and ignored.
 * @param {() => number} [options.rng]  random numbers for rules that need them (default Math.random, created once here)
 * @param {() => number} [options.now]  the clock in milliseconds (default Date.now, created once here)
 * @returns {{ dispose: () => void, rooms: Map<string, object> }} dispose() stops timers and saves; `rooms` is exposed for tests
 */
/**
 * A refusal as the client receives it: the rules' code and, when its words need them, the values to put in (see
 * shared/messages.js).  Without the values a sentence such as "You need at least {min} players." reaches the player with
 * the gap still in it.
 * @param {{ error: string, params?: object }} outcome  what a rule returned
 * @returns {{ ok: false, error: string, params?: object }}
 * Side effects: none.
 */
const refused = (outcome) => ({ ok: false, error: outcome.error, ...(outcome.params ? { params: outcome.params } : {}) });

export function createRoomServer(ctx, options) {
  const { game, pickSettings, nextAction, registerEvents, createArgs = () => ({}), viewOptions = () => ({}), playerExtras = () => ({}), afterChange, members = (room) => room.seats, kickKey = 'seat', startRule, migrate, rng = Math.random, now = Date.now } = options;
  const file = path.join(ctx.dataDir, 'rooms.json');
  const rooms = new Map();
  const sockets = new Map(); // user id -> the sockets that user has open
  const timers = new Map(); // room code -> { timer, key } for the next thing the server does by itself
  const failures = new Map(); // room code -> how many scheduled moves have thrown in a row

  loadRooms();

  let saveTimer = null;

  /**
   * Reads the saved rooms, if any.  A missing file is normal; an unreadable file is logged and the rooms start empty; one
   * room that cannot be brought up to date is logged and skipped, so it does not take the others down with it.
   * @returns {void}
   * Side effects: fills the `rooms` map from disk (running `migrate` on each saved room) and may log errors.
   */
  function loadRooms() {
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') ctx.log('could not read the saved games:', error.message);
      return;
    }
    for (const entry of Array.isArray(saved) ? saved : []) {
      try {
        const room = migrate ? migrate(entry) ?? entry : entry;
        rooms.set(room.code, room);
      } catch (error) {
        ctx.log(`could not load the saved game ${entry?.code}:`, error.message);
      }
    }
  }

  /**
   * Writes every room to disk now, atomically (a temporary file renamed over the real one, so a crash mid-write leaves
   * the old file whole).  A failure is logged, never thrown.
   * @returns {void}
   * Side effects: clears any pending debounced save, writes `rooms.json`, may log.
   */
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify([...rooms.values()]));
      fs.renameSync(`${file}.tmp`, file);
    } catch (error) {
      ctx.log('could not save the games:', error.message);
    }
  }

  /** Asks for a save soon; many changes in a short time cost one write (the timer is unreferenced, so it never keeps the process alive). */
  function save() {
    saveTimer ??= setTimeout(saveNow, SAVE_DEBOUNCE_MS);
    saveTimer.unref?.();
  }

  /**
   * Stops any pending timer for a room.
   * @param {string} code  the room code
   * @returns {void}
   * Side effects: clears the room timer for scheduled actions and removes it from `timers`.
   */
  function cancelTimer(code) {
    clearTimeout(timers.get(code)?.timer);
    timers.delete(code);
  }

  /**
   * Forgets a room completely (its timer, its saved copy) and sends anybody still looking at it back to the menu.
   * @param {object} room  the room to drop
   * @returns {void}
   * Side effects: cancels its timer, deletes it from `failures` and `rooms`, detaches its people's sockets, and schedules a save.
   */
  function discard(room) {
    cancelTimer(room.code);
    failures.delete(room.code);
    rooms.delete(room.code);
    for (const seat of members(room)) if (game.isHuman(seat)) detach(seat.id, room.code);
    save();
  }

  /**
   * Drops rooms nobody has touched for a day (finished) or a week (still going).
   * @returns {void}
   * Side effects: discards stale rooms (see `discard`).
   */
  function sweep() {
    const current = now();
    for (const room of [...rooms.values()]) {
      if (current - room.updatedAt > (game.isLive(room) ? KEEP_OTHER_MS : KEEP_FINISHED_MS)) discard(room);
    }
  }
  /**
   * Finds the sockets a person has open that are currently looking at the room with this code.
   * @param {number} id  the account id
   * @param {string} code  the room code
   * @returns {object[]} matching sockets (possibly none)
   * Side effects: none.
   */
  function open(id, code) {
    return [...(sockets.get(id) ?? [])].filter((s) => s.data.code === code);
  }
  // Returns a predicate (id => boolean): "is this person connected to the room?", handed to the rules so the view can show who is away.
  const online = (code) => (id) => open(id, code).length > 0;
  // Returns the unfinished room a person is in, or undefined: a person can be in only one at a time.
  const liveRoomOf = (userId) => [...rooms.values()].find((r) => game.isLive(r) && game.hasPlayer(r, userId));

  /**
   * Sends every connected person in the room their own view of it.
   * @param {object} room  the room to broadcast
   * @returns {void}
   * Side effects: emits a 'state' event on each human member's open sockets for this room.
   */
  function push(room) {
    for (const seat of members(room)) {
      if (!game.isHuman(seat)) continue;
      for (const socket of open(seat.id, room.code)) socket.emit('state', game.viewFor(room, seat.id, { online: online(room.code), ...viewOptions(room, seat.id, now) }));
    }
  }

  /**
   * Sends an event straight to the people in a room, bypassing the view.  A view is the whole state of a room and is
   * sent to everybody on every change, so it cannot carry a stream: the thousands of strokes of a drawing go this way
   * instead, as they are made.
   * @param {object} room  the room whose people should get it
   * @param {string} event  the socket event name
   * @param {*} payload  what to send
   * @param {{ except?: number | string }} [options]  a player id to leave out (usually the one who caused it)
   * @returns {void}
   * Side effects: emits on every socket those people have open on this room.
   */
  function relay(room, event, payload, { except = null } = {}) {
    for (const member of members(room)) {
      if (!game.isHuman(member) || member.id === except) continue;
      for (const other of open(member.id, room.code)) other.emit(event, payload);
    }
  }

  /**
   * Points a socket at a room and gives everyone in it the current view.
   * @param {object} socket  the socket to attach
   * @param {object} room  the room it is now looking at
   * @returns {void}
   * Side effects: sets `socket.data.code`, then emits 'state' via `push`.
   */
  function attach(socket, room) {
    socket.data.code = room.code;
    push(room);
  }

  /**
   * Sends a person sockets back to the menu (they were removed from the room).
   * @param {number} userId  the account removed
   * @param {string} code  the room they left
   * @returns {void}
   * Side effects: clears `socket.data.code` and emits a null 'state' on each of their sockets for that room.
   */
  function detach(userId, code) {
    for (const socket of open(userId, code)) {
      socket.data.code = null;
      socket.emit('state', null);
    }
  }

  /**
   * Works out what the server has to do by itself next for this room and sets the timer for it, replacing any earlier
   * timer (unless the action says its key is unchanged).  If the action throws, the failure is logged and it is tried
   * again after a growing pause; after MAX_RETRIES failures in a row the room is left alone until somebody acts (any
   * change to the room, see `changed`, starts the count afresh).
   * The same goes if working out the next action throws, or if telling everybody afterwards does: a bug in one game's rules
   * must not escape from a timer (where nothing would catch it) or leave the room waiting for ever.
   * @param {object} room  the room to schedule for
   * @returns {void}
   * Side effects: cancels/sets the room timer; when it fires it runs the game's action, which may mutate the room, and calls `changed`.
   */
  function schedule(room) {
    let action;
    try {
      action = nextAction(room, rng, now, { online: online(room.code), relay });
    } catch (error) {
      cancelTimer(room.code);
      failedMove(room, 'could not work out the next move', error);
      return;
    }
    const waiting = timers.get(room.code);
    if (!action) {
      cancelTimer(room.code);
      return;
    }
    if (action.key !== undefined && waiting?.key === action.key) return;
    cancelTimer(room.code);
    const timer = setTimeout(() => {
      timers.delete(room.code);
      if (rooms.get(room.code) !== room) return;
      try {
        action.run();
        changed(room); // which also forgets earlier failures
      } catch (error) {
        failedMove(room, 'a scheduled move failed', error);
      }
    }, action.wait);
    timer.unref?.();
    timers.set(room.code, { timer, key: action.key });
  }

  /**
   * Notes that a scheduled move (or the work of finding it) threw: logs it and, for the first MAX_RETRIES failures in a row,
   * tries again after a pause that doubles each time.
   * @param {object} room  the room whose move failed
   * @param {string} what  what failed, for the log
   * @param {Error} error  the thrown error
   * @returns {void}
   * Side effects: logs, counts the failure for this room and may set a retry timer.
   */
  function failedMove(room, what, error) {
    const count = (failures.get(room.code) ?? 0) + 1;
    failures.set(room.code, count);
    ctx.log(`${what}:`, error);
    if (count <= MAX_RETRIES) retryLater(room, RETRY_BASE_MS * 2 ** (count - 1));
  }

  /**
   * Tries scheduling again after a pause (used after a scheduled move threw).
   * @param {object} room  the room to reschedule
   * @param {number} wait  milliseconds to wait first
   * @returns {void}
   * Side effects: sets the room timer (unreferenced), which later calls `schedule(room)` if the room still exists.
   */
  function retryLater(room, wait) {
    const timer = setTimeout(() => {
      timers.delete(room.code);
      if (rooms.get(room.code) === room) schedule(room);
    }, wait);
    timer.unref?.();
    timers.set(room.code, { timer, key: undefined });
  }

  /**
   * Tells the statistics about a finished game, once.
   * @param {object} room  the room to check
   * @returns {void}
   * Side effects: sets `room.recorded` and calls `ctx.stats.record` (errors are logged, never thrown).
   */
  function recordIfFinished(room) {
    if (room.phase !== 'finished' || room.recorded) return;
    room.recorded = true;
    try {
      ctx.stats.record({ code: room.code, players: game.statsPlayers(room) });
    } catch (error) {
      ctx.log('could not record the statistics:', error.message);
    }
  }

  /**
   * Call after any change to a room: stamps it, forgets any run of failed scheduled moves (somebody acted, so the room is
   * worth retrying for), runs the game's afterChange hook, records a finished game, saves, tells everyone, and reschedules.
   * @param {object} room  the room that changed
   * @returns {void}
   * Side effects: sets `room.updatedAt`, clears the room's failure count, may mutate the room via `afterChange`, and triggers recording, saving, pushing, and scheduling.
   */
  function changed(room) {
    room.updatedAt = now();
    failures.delete(room.code);
    try {
      afterChange?.(room);
    } catch (error) {
      ctx.log('afterChange failed:', error);
    }
    recordIfFinished(room);
    save();
    push(room);
    schedule(room);
  }

  /**
   * Takes a person out of a room (a computer player replaces them mid-game) and tells everyone.  When the rules say the room
   * was left as it was (`changed: false`: a finished list game keeps its standings), nobody is told and nothing is saved, so
   * a finished room is not kept young for ever by its players starting other games.
   * @param {object} room  the room being left
   * @param {number} userId  the account leaving
   * @returns {{ ok: boolean, empty?: boolean, changed?: boolean, error?: string }} the rules outcome (`empty` means the room was discarded)
   * Side effects: mutates the room via the rules, detaches the person's sockets, then discards or `changed`s the room.
   */
  function leaveRoom(room, userId) {
    const outcome = game.removeHuman(room, userId, rng, now());
    if (!outcome.ok) return outcome;
    detach(userId, room.code);
    if (outcome.empty) discard(room);
    else if (outcome.changed !== false) changed(room);
    return outcome;
  }

  /**
   * Takes a person out of every room they are in (before they join or create another).
   * @param {number} userId  the account
   * @param {object|null} [except]  a room to leave alone (the one being joined)
   * @returns {void}
   * Side effects: as `leaveRoom` for each room found.
   */
  function leaveAllRooms(userId, except = null) {
    for (const old of [...rooms.values()]) if (old !== except && game.hasPlayer(old, userId)) leaveRoom(old, userId);
  }

  /**
   * Puts a socket into a room: resumes the person's own live game, or joins the room with the given code.  With no code,
   * a person without a live game is shown the menu.
   * @param {object} socket  the connected socket (needs `data.user`)
   * @param {unknown} rawCode  the code as typed or pasted by the client; normalised here
   * @returns {{ ok: boolean, code?: string | null, error?: string }} the ack for the client
   * Side effects: attaches the socket to a room or emits a null 'state'; joining adds the person to the room, leaves other rooms, and calls `changed`.
   */
  function enter(socket, rawCode) {
    const userId = socket.data.user.id;
    const mine = liveRoomOf(userId);
    const code = ctx.codes.normalise(rawCode);
    if (rawCode && !code) return { ok: false, error: 'notAnInviteCode' };
    if (mine && code && mine.code !== code) {
      attach(socket, mine);
      return { ok: false, error: 'alreadyInGameJoin', params: { code: mine.code } };
    }
    if (mine) {
      attach(socket, mine);
      return { ok: true, code: mine.code };
    }
    if (!code) {
      // A finished game is not resumed without its invite code: coming back from the menu starts afresh.
      socket.emit('state', null);
      return { ok: true, code: null };
    }
    const room = rooms.get(code);
    if (!room) {
      socket.emit('state', null);
      return { ok: false, error: 'noGameWithCode' };
    }
    if (game.hasPlayer(room, userId)) {
      attach(socket, room);
      return { ok: true, code };
    }
    const added = game.addHuman(room, userId, socket.data.user.name, playerExtras(userId));
    if (!added.ok) {
      socket.emit('state', null);
      return room.phase === 'finished' ? { ok: false, error: 'thatGameFinished' } : added;
    }
    leaveAllRooms(userId, room);
    attach(socket, room);
    changed(room);
    return { ok: true, code };
  }

  // One connection per browser tab: track the socket, register the shared events, then the game-specific ones.
  // Sweeping reaches `detach`, and through it every helper above, so it waits until they all exist: a module whose
  // saved games had gone cold would otherwise throw here and fail to load at all.
  sweep();
  const sweeper = setInterval(sweep, SWEEP_EVERY_MS);
  sweeper.unref();

  ctx.io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.data.code = null;
    if (!sockets.has(userId)) sockets.set(userId, new Set());
    sockets.get(userId).add(socket);

    // Returns the room this socket is currently looking at, or undefined.
    const roomOfSocket = () => rooms.get(socket.data.code);

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
      if (outcome.ok) changed(room);
      return outcome.ok ? { ok: true } : refused(outcome);
    };

    on('resume', ({ code }) => enter(socket, code));
    on('join', ({ code }) => (typeof code === 'string' && code.trim() ? enter(socket, code) : { ok: false, error: 'typeInviteCode' }));

    on('create', (payload) => {
      const mine = liveRoomOf(userId);
      if (mine) {
        attach(socket, mine);
        return { ok: false, error: 'alreadyInGameStart', params: { code: mine.code } };
      }
      let room;
      try {
        room = game.createRoom({
          code: ctx.codes.generate((c) => rooms.has(c)),
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
      leaveAllRooms(userId);
      rooms.set(room.code, room);
      attach(socket, room);
      save();
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
      leaveRoom(room, userId);
      return { ok: true };
    });

    // The host removes someone: the rules refuse a finished game, a missing seat, and the host themselves.
    on('kick', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const outcome = game.kick(room, userId, payload[kickKey], rng, now());
      if (!outcome.ok) return refused(outcome);
      detach(outcome.userId, room.code);
      changed(room);
      return { ok: true };
    });

    on('settings', (payload) => act((room) => game.setSettings(room, userId, pickSettings(payload))));
    on('addBot', ({ seat }) => act((room) => game.addBot(room, userId, seat)));
    on('removeBot', ({ seat }) => act((room) => game.removeBot(room, userId, seat, rng)));
    on('fillBots', (payload) => act((room) => game.fillWithBots(room, userId, payload.count)));
    on('start', () => act((room) => (startRule ?? game.start)(room, userId, rng, now())));
    on('again', () => act((room) => game.playAgain(room, userId)));

    registerEvents({ on, act, userId, socket, rng, now, roomOf: roomOfSocket, relay });

    socket.on('disconnect', () => {
      const set = sockets.get(userId);
      set?.delete(socket);
      if (set && !set.size) sockets.delete(userId);
      const room = roomOfSocket();
      if (room) push(room);
    });
  });

  for (const room of rooms.values()) schedule(room);

  return {
    rooms,
    dispose() {
      clearInterval(sweeper);
      for (const { timer } of timers.values()) clearTimeout(timer);
      timers.clear();
      saveNow();
    },
  };
}
