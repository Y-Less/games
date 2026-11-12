// The site's own socket, and who is listening to it.  The server's default namespace is how it reaches a person
// wherever they are on the site rather than inside one game (server/siteSocket.js puts every connection in `user:<id>`
// and emits to that), so there must be exactly one of these per page however many things want to hear from it.
//
// It was the achievement feed's socket, opened and closed by it alone.  A second listener wanted it — a tour, which
// has to tell its players to come back when the game they were sent to has ended — so the connection is kept here and
// both subscribe.  Whoever is listening does not open it: the page does that once, when somebody signs in.
//
// Depends on: socket.io-client only.
import { io } from 'socket.io-client';

/** The one site socket while a player is signed in, else null. */
let socket = null;
/** event name -> the handlers waiting for it, whether or not the socket is open yet. */
const listeners = new Map();

/**
 * Listens for something the server sends on the site's socket.  It may be called before the socket is open; the
 * handler is attached as soon as it is.
 *
 * @param {string} event  the event name ('connect' included)
 * @param {Function} handler  called with whatever the server sent
 * @returns {() => void} stops listening
 * Side effects: remembers the handler, and attaches it to the socket if one is open.
 */
export function onSite(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  socket?.on(event, handler);
  return () => {
    listeners.get(event)?.delete(handler);
    socket?.off?.(event, handler);
  };
}

/**
 * Opens the site socket if it is not open already, and attaches everybody waiting.
 *
 * @param {() => import('socket.io-client').Socket} [connect]  makes the socket (replaceable in tests)
 * @returns {import('socket.io-client').Socket} the socket, new or the one already open
 * Side effects: may open a connection and register every remembered handler on it.
 */
export function startSite(connect = io) {
  if (socket) return socket;
  socket = connect();
  for (const [event, handlers] of listeners) for (const handler of handlers) socket.on(event, handler);
  return socket;
}

/**
 * Closes the site socket (the player has signed out).  The handlers are kept, so signing in again brings them back
 * without anybody having to subscribe a second time.
 *
 * @returns {void}
 * Side effects: closes the connection.
 */
export function stopSite() {
  socket?.close();
  socket = null;
}

/**
 * The socket now, for a test that wants to look.
 * @returns {import('socket.io-client').Socket | null}
 * Side effects: none.
 */
export const siteSocket = () => socket;
