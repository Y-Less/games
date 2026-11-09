// Which sockets each account has open, and which room each of those is looking at.  One person may have the same game
// open in several tabs, so everything here works on a set of sockets rather than one.
//
// A socket's `data.code` is the room it is looking at, or null for the menu; this file is the only place that writes it.
// Alongside that, the rooms are indexed the other way round — code to the accounts watching it — so that "is this
// person here?" is a lookup rather than a search through every open socket.  A view asks that about everybody in the
// room, on every change, which is why it is worth indexing.
//
// Nothing here knows any rules, or what a view contains: `openFor` hands the caller one person's sockets for a room and
// the caller decides what to send.
//
// Depends on: nothing (sockets arrive as arguments).

/**
 * Builds the registry for one game's namespace.
 *
 * @returns {{ add: Function, drop: Function, openFor: Function, online: Function, attach: Function, detach: Function }}
 * Side effects: none until a method is called.
 */
export function createSocketRegistry() {
  const sockets = new Map(); // account id -> the sockets that account has open
  const watchers = new Map(); // room code -> Map of account id -> how many of their sockets are looking at it

  /**
   * Counts one more of a person's sockets as looking at a room.
   * @param {number} userId  the account
   * @param {string | null} code  the room, or null for none
   * @returns {void}
   * Side effects: updates the room-to-accounts index.
   */
  function enter(userId, code) {
    if (code === null || code === undefined) return;
    if (!watchers.has(code)) watchers.set(code, new Map());
    const counts = watchers.get(code);
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
  }

  /**
   * Counts one fewer, forgetting the person once none of their sockets is on that room, and the room once nobody is.
   * @param {number} userId  the account
   * @param {string | null} code  the room, or null for none
   * @returns {void}
   * Side effects: updates the room-to-accounts index.
   */
  function leave(userId, code) {
    const counts = watchers.get(code);
    if (!counts) return;
    const left = (counts.get(userId) ?? 0) - 1;
    if (left > 0) counts.set(userId, left);
    else counts.delete(userId);
    if (!counts.size) watchers.delete(code);
  }

  /**
   * The sockets a person has open that are looking at the room with this code.
   * @param {number} id  the account id
   * @param {string} code  the room code
   * @returns {object[]} matching sockets (possibly none)
   * Side effects: none.
   */
  function openFor(id, code) {
    const open = [];
    for (const socket of sockets.get(id) ?? []) if (socket.data.code === code) open.push(socket);
    return open;
  }

  return {
    openFor,

    /**
     * Takes note of a newly connected socket, which starts out looking at no room.
     * @param {number} userId  the account behind it
     * @param {object} socket  the socket
     * @returns {void}
     * Side effects: sets `socket.data.code` to null and remembers the socket.
     */
    add(userId, socket) {
      socket.data.code = null;
      if (!sockets.has(userId)) sockets.set(userId, new Set());
      sockets.get(userId).add(socket);
    },

    /**
     * Forgets a socket that has disconnected.  Its `data.code` is left alone: the caller still asks which room it was
     * looking at, so that the room can be told somebody has gone.
     * @param {number} userId  the account behind it
     * @param {object} socket  the socket
     * @returns {void}
     * Side effects: forgets the socket, the account once its last socket has gone, and its place in the room index.
     */
    drop(userId, socket) {
      const open = sockets.get(userId);
      if (!open?.delete(socket)) return;
      if (!open.size) sockets.delete(userId);
      leave(userId, socket.data.code);
    },

    /**
     * A predicate for one room: "is this person connected to it?"  The rules are handed this so a view can show who is
     * away, and a game that waits on somebody being there may keep it and ask again later — so it reads the index as it
     * is asked, never a copy made when it was built.
     * @param {string} code  the room code
     * @returns {(id: number) => boolean}
     * Side effects: none.
     */
    online(code) {
      return (id) => Boolean(watchers.get(code)?.has(id));
    },

    /**
     * Points a socket at a room.
     * @param {number} userId  the account behind it
     * @param {object} socket  the socket
     * @param {string} code  the room's code
     * @returns {void}
     * Side effects: sets `socket.data.code` and moves it in the room index.
     */
    attach(userId, socket, code) {
      if (socket.data.code === code) return;
      leave(userId, socket.data.code);
      socket.data.code = code;
      enter(userId, code);
    },

    /**
     * Sends a person's sockets for one room back to the menu: they are no longer in it.
     * @param {number} userId  the account removed
     * @param {string} code  the room they left
     * @returns {object[]} the sockets that were looking at it, now pointed at no room
     * Side effects: clears `socket.data.code` on each and takes them out of the room index.
     */
    detach(userId, code) {
      const leaving = openFor(userId, code);
      for (const socket of leaving) {
        socket.data.code = null;
        leave(userId, code);
      }
      return leaving;
    },
  };
}
