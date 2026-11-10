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
import { createRoomStore } from './roomStore.js';
import { createScheduler } from './scheduler.js';
import { createSocketRegistry } from './socketRegistry.js';
import { refusalReply } from './messages.js';
import { barFromRoom } from './seats.js';
import { seatLayout } from './layout.js';
import { answerRemoval, askToRemove, dropVote, tidyVote, voteView } from './voteKick.js';

// Retention and timing: how long to keep a finished room, then an unfinished one (kept longer: players may return to a
// paused game), and how often to sweep for old rooms.  (How long a save is debounced is the store's business now.)
const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const KEEP_OTHER_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;


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

  // Everybody is named by their slot — "s0", "s1" — whichever family the game belongs to, so a removal and a vote about
  // one say the same thing in every game and the clients do not have to know which kind of game they are drawing.  The
  // layout is the only thing that differs: where a slot is in this game's room (shared/layout.js).  Votes themselves
  // are kept in account ids, which is what the rules remove by.
  /** Everybody in the room who is a person. */
  const peopleIn = (room) => (members(room) ?? []).filter((member) => game.isHuman?.(member));
  /** The account in that slot, or null when nobody is. */
  const accountNamed = (room, slot) => {
    const member = layout.at(room, slot);
    return game.isHuman?.(member) ? member.id : null;
  };
  /** The other way round: the slot that account is sitting in, or null. */
  const nameFor = (room, account) => {
    const list = members(room) ?? [];
    const index = list.findIndex((m) => game.isHuman?.(m) && m.id === account);
    return index === -1 ? null : layout.slotOf(list[index], index);
  };
  // Where the rooms are kept between restarts (shared/roomStore.js); this file never touches the file itself.
  const store = createRoomStore({ dataDir: ctx.dataDir, log: ctx.log, now, migrate, members, isHuman: (member) => Boolean(game.isHuman?.(member)) });
  const rooms = store.rooms; // the store owns the map; this file changes it only through store.put and store.remove
  const registry = createSocketRegistry(); // which sockets each account has open, and which room each is looking at
  // The timer behind a computer player's move or a pause between tricks (shared/scheduler.js).  `changed` is declared
  // below, so it is reached through a wrapper rather than passed directly.
  const scheduler = createScheduler({
    nextAction: (room) => nextAction(room, rng, now, { online: registry.online(room.code), relay }),
    current: (room) => rooms.get(room.code) === room,
    changed: (room) => changed(room),
    log: ctx.log,
  });

  store.load();

  /**
   * Forgets a room completely (its timer, its saved copy) and sends anybody still looking at it back to the menu.
   * @param {object} room  the room to drop
   * @returns {void}
   * Side effects: cancels its timer, forgets its failures, detaches its people's sockets, and drops it from the store.
   */
  function discard(room) {
    scheduler.cancel(room.code);
    scheduler.forget(room.code);
    for (const seat of members(room)) if (game.isHuman(seat)) detach(seat.id, room.code);
    store.remove(room.code);
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
  // Every room this person is in, from the store's index rather than by looking through all of them.
  const roomsOf = (userId) => store.roomsOf(userId).flatMap((code) => (rooms.has(code) ? [rooms.get(code)] : []));
  // Returns the unfinished room a person is in, or undefined: a person can be in only one at a time.  The index says
  // which rooms they are in; whether one is still being played is a rule, so that part is asked of the game.
  const liveRoomOf = (userId) => roomsOf(userId).find((room) => game.isLive(room));

  /**
   * Sends every connected person in the room their own view of it.
   * @param {object} room  the room to broadcast
   * @returns {void}
   * Side effects: emits a 'state' event on each human member's open sockets for this room.
   */
  function push(room) {
    // Worked out once for the whole room, not once per person: a view asks it about everybody, so building it inside
    // the loop made one broadcast cost a scan of every open socket for every player in the room.
    const online = registry.online(room.code);
    for (const seat of members(room)) {
      if (!game.isHuman(seat)) continue;
      const open = registry.openFor(seat.id, room.code);
      if (!open.length) continue; // nobody looking: no view to build
      const vote = voteFor(room, seat.id); // only while one is running: a view nobody is being voted out of is untouched
      // Built once per person rather than once per socket, so somebody with the game open in two tabs costs one view.
      const view = game.viewFor(room, seat.id, { online, ...viewOptions(room, seat.id, now) });
      const state = vote ? { ...view, vote } : view;
      for (const socket of open) socket.emit('state', state);
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
      for (const other of registry.openFor(member.id, room.code)) other.emit(event, payload);
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
    registry.attach(socket.data.user.id, socket, room.code);
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
    for (const socket of registry.detach(userId, code)) socket.emit('state', null);
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
    tidyVote(room, peopleIn(room), now()); // a vote about somebody who has gone, or one too few people are left for
    scheduler.forget(room.code);
    try {
      afterChange?.(room);
    } catch (error) {
      ctx.log('afterChange failed:', error);
    }
    recordIfFinished(room);
    store.put(room);
    push(room);
    scheduler.schedule(room);
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
   * The vote running in a room as one person is shown it, with the players named the way that game names them.
   * @param {object} room  not changed
   * @param {number} forId  the account being shown it
   * @returns {object | null} the vote, or null when none is running
   * Side effects: none.
   */
  function voteFor(room, forId) {
    const view = voteView(room, forId, peopleIn(room), now());
    return view && { ...view, target: nameFor(room, view.target), by: nameFor(room, view.by) };
  }

  /**
   * Puts somebody out because the room voted them out: a computer player takes their place as it does for anybody who
   * leaves, and they are barred, so the invitation does not let them straight back in.
   * @param {object} room  the room to change
   * @param {number} targetId  the account being put out
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: as `leaveRoom`, and bars them before the room is saved.
   */
  function putOutByVote(room, targetId) {
    const outcome = game.removeHuman(room, targetId, rng, now());
    if (!outcome.ok) return outcome;
    barFromRoom(room, targetId);
    detach(targetId, room.code);
    if (outcome.empty) discard(room);
    else changed(room);
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
    for (const old of roomsOf(userId)) if (old !== except) leaveRoom(old, userId);
  }

  /**
   * Puts a socket into a room: resumes the person's own live game, or joins the room with the given code.  With no code,
   * a person without a live game is shown the menu.
   * @param {object} socket  the connected socket (needs `data.user`)
   * @param {unknown} rawCode  the code as typed or pasted by the client; normalised here
   * @returns {{ ok: boolean, code?: string | null, error?: string, params?: object }} the ack for the client
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
    registry.add(userId, socket);

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
      store.put(room);
      attach(socket, room);
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
      const outcome = game.kick(room, userId, payload.slot, rng, now());
      if (!outcome.ok) return refused(outcome);
      detach(outcome.userId, room.code);
      changed(room);
      return { ok: true };
    });

    // Anybody may ask for a player to be put out, and the others answer; the host still has `kick` for an outright one.
    on('voteKick', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const target = accountNamed(room, payload.slot);
      if (target === null) return { ok: false, error: 'playerNotInGame' };
      const asked = askToRemove(room, userId, peopleIn(room), target, now());
      if (!asked.ok) return refused(asked);
      changed(room);
      return { ok: true };
    });

    on('voteAnswer', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const target = room.vote?.target ?? null;
      const answered = answerRemoval(room, userId, payload.agree === true, peopleIn(room), now());
      if (!answered.ok) return refused(answered);
      if (answered.passed && target !== null) putOutByVote(room, target);
      else changed(room);
      return { ok: true, passed: Boolean(answered.passed) };
    });

    on('voteDrop', () => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const dropped = dropVote(room, userId, now());
      if (!dropped.ok) return refused(dropped);
      changed(room);
      return { ok: true };
    });

    on('settings', (payload) => act((room) => game.setSettings(room, userId, pickSettings(payload))));
    on('addBot', ({ seat }) => act((room) => game.addBot(room, userId, seat)));
    on('removeBot', ({ slot }) => act((room) => game.removeBot(room, userId, slot, rng)));
    on('fillBots', (payload) => act((room) => game.fillWithBots(room, userId, payload.count)));
    on('start', () => act((room) => (startRule ?? game.start)(room, userId, rng, now())));
    on('again', () => act((room) => game.playAgain(room, userId)));

    registerEvents({ on, act, userId, socket, rng, now, roomOf: roomOfSocket, relay });

    socket.on('disconnect', () => {
      registry.drop(userId, socket);
      const room = roomOfSocket();
      // Somebody going is not a change to the room, but it can change what the server owes it next: a game that waits
      // on a player who has gone (a drawer who shut the tab) must be given the chance to set that timer now, rather
      // than only when something else happens to fire.  An unchanged `nextAction` keeps the timer it already has.
      if (room) {
        push(room);
        scheduler.schedule(room);
      }
    });
  });

  for (const room of rooms.values()) scheduler.schedule(room);

  return {
    rooms,
    dispose() {
      clearInterval(sweeper);
      scheduler.stop();
      store.close();
    },
  };
}
