// What can happen to a room, apart from anybody asking for it.
//
// The room server (shared/roomServer.js) is two things that kept being written as one: the socket protocol — twelve
// events, and what a client is allowed to say — and the life of a room underneath it, which the protocol speaks
// about.  This is the second of those.  Nothing here knows an event name or a socket's handshake; it knows rooms,
// who is looking at them, when they change, and when they are over.
//
// It owns the three parts that were pulled out before it, and is the only thing that talks to them:
//   - shared/roomStore.js      where rooms live between restarts, and the index of who is in which
//   - shared/socketRegistry.js which sockets each account has open, and which room each is looking at
//   - shared/scheduler.js      the timer behind a computer player's move or a pause between tricks
// and shared/voteKick.js's adapter, because a view carries the vote running in the room.
//
// Nothing here knows any rules either: everything a game decides is asked of `game`, and everything a family decides
// (where a place is, who the members are) is asked of `layout` and `members`.
// Depends on: the four shared parts above; the rules module, ctx and clock are injected.
import { createRoomStore } from './roomStore.js';
import { createScheduler } from './scheduler.js';
import { createSocketRegistry } from './socketRegistry.js';
import { createVoteKick } from './voteKick.js';
import { barFromRoom } from './members.js';

// Retention and timing: how long to keep a finished room, then an unfinished one (kept longer: players may return to a
// paused game), and how often to sweep for old rooms.  (How long a save is debounced is the store's business.)
const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const KEEP_OTHER_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * The life of this game's rooms: loading them, saving them, telling people about them, and forgetting them.
 *
 * @param {object} options  the pieces the room server was given, minus everything about the protocol
 * @param {object} options.ctx  the module context from the site (dataDir, codes, stats, log)
 * @param {object} options.game  the rules module
 * @param {(room: object) => object[]} options.members  everybody in a room, the way this family keeps them
 * @param {object} options.layout  how this family addresses a place (shared/layout.js)
 * @param {(room: object, userId: number, now: () => number) => object} options.viewOptions  extra arguments for viewFor
 * @param {(room: object) => void} [options.afterChange]  the game's own hook, run on every change
 * @param {(userId: number) => object} options.playerExtras  extra fields for somebody joining
 * @param {(room: object, rng: () => number, now: () => number, who: { online: (id: number) => boolean, relay: Function }) => ({ key?: string, wait: number, run: () => void } | null)} options.nextAction  what the server owes the room next
 * @param {(room: object) => object} [options.migrate]  brings a saved room up to date
 * @param {(room: object) => void} [options.onFinished]  told once when a game in this module ends, for something outside
 *   it that is waiting (a tour).  It runs beside the statistics, under the same `recorded` guard, and a throw is logged.
 * @param {() => number} options.rng  random source
 * @param {() => number} options.now  the clock
 * @returns {object} rooms, votes, and the operations the protocol performs on a room
 * Side effects: loads the saved rooms, starts the hourly sweep and each room's timer.
 */
export function createRoomLife({ ctx, game, members, layout, viewOptions, afterChange, playerExtras, nextAction, migrate, onFinished, rng, now }) {
  // Naming people by slot, and the vote that uses it (shared/voteKick.js).
  const votes = createVoteKick({ game, members, layout, now });
  // Where the rooms are kept between restarts (shared/roomStore.js); nothing here touches the file itself.
  const store = createRoomStore({ dataDir: ctx.dataDir, log: ctx.log, now, migrate, members, isHuman: (member) => Boolean(game.isHuman?.(member)) });
  const rooms = store.rooms; // the store owns the map; this file changes it only through store.put and store.remove
  const registry = createSocketRegistry(); // which sockets each account has open, and which room each is looking at
  // `changed` and `relay` are declared below, so the scheduler reaches them through wrappers rather than directly.
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
      const vote = votes.viewFor(room, seat.id); // only while one is running: a view nobody is being voted out of is untouched
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
   * Shows one socket the menu, and lets go of whatever room it was looking at.  For a socket that asked to enter a room
   * and could not: it may still have been pointed at a finished game, and a socket told it is at the menu must not go on
   * counting as there or being sent that room's changes.
   * @param {object} socket  the socket
   * @returns {void}
   * Side effects: clears `socket.data.code`, emits a null 'state' to it, and tells the room it left that somebody has gone.
   */
  function showMenu(socket) {
    const left = socket.data.code ? rooms.get(socket.data.code) : null;
    registry.attach(socket.data.user.id, socket, null);
    socket.emit('state', null);
    if (left) push(left);
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
    // Anybody outside this game waiting for it to be over is told here, and for the same reason the statistics are:
    // this is the one place a game is noticed to have ended, and `recorded` makes it the once.  A tour running a game
    // in another module is the caller this exists for; the watcher's own failure is not this room's problem.
    try {
      onFinished?.(room);
    } catch (error) {
      ctx.log('a watcher of finished games failed:', error);
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
    votes.tidy(room); // a vote about somebody who has gone, or one too few people are left for
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
   * Side effects: attaches the socket to a room, or shows it the menu and lets go of the room it was looking at; joining adds the person to the room, leaves other rooms, and calls `changed`.
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
      showMenu(socket);
      return { ok: true, code: null };
    }
    const room = rooms.get(code);
    if (!room) {
      showMenu(socket);
      return { ok: false, error: 'noGameWithCode' };
    }
    if (game.hasPlayer(room, userId)) {
      attach(socket, room);
      return { ok: true, code };
    }
    const added = game.addHuman(room, userId, socket.data.user.name, playerExtras(userId));
    if (!added.ok) {
      showMenu(socket);
      return room.phase === 'finished' ? { ok: false, error: 'thatGameFinished' } : added;
    }
    leaveAllRooms(userId, room);
    attach(socket, room);
    changed(room);
    return { ok: true, code };
  }

  // Sweeping reaches `detach`, and through it every helper above, so it waits until they all exist: a module whose
  // saved games had gone cold would otherwise throw here and fail to load at all.
  sweep();
  const sweeper = setInterval(sweep, SWEEP_EVERY_MS);
  sweeper.unref();
  for (const room of rooms.values()) scheduler.schedule(room);

  return {
    rooms,
    votes,
    /** Takes a new room into the store (the protocol makes it; this keeps it). */
    keep: (room) => store.put(room),
    /** Is this code already taken?  Asked while making one up. */
    taken: (code) => rooms.has(code),
    /** The room a socket is looking at, or undefined. */
    roomAt: (code) => rooms.get(code),
    /** Somebody has opened a connection, or closed one. */
    addSocket: (userId, socket) => registry.add(userId, socket),
    dropSocket: (userId, socket) => registry.drop(userId, socket),
    reschedule: (room) => scheduler.schedule(room),
    push,
    relay,
    changed,
    attach,
    detach,
    discard,
    leaveRoom,
    leaveAllRooms,
    putOutByVote,
    liveRoomOf,
    enter,
    dispose() {
      clearInterval(sweeper);
      scheduler.stop();
      store.close();
    },
  };
}
