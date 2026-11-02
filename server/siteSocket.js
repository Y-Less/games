// The site's own socket (the default namespace), for what is not part of one game: a person's pop-ups arrive here,
// wherever on the site they are. Every signed-in page holds one open, so it is also how the site knows who is online
// and for how long (server/presence.js).
// Depends on: ./auth.js (cookie parsing and the session cookie name) and socket.io.
import { parseCookies, SESSION_COOKIE } from './auth.js';

/**
 * Makes the default namespace refuse anyone not signed in, puts each connection in the room `user:<id>`, and keeps the
 * presence clock running while they are connected.
 * @param {import('socket.io').Server} io
 * @param {{ userForToken: (token: string | undefined) => object | null }} auth
 * @param {{ presence?: { arrive: Function, leave: Function }, onAway?: (userId: number) => void }} [options]
 *   onAway runs when somebody's last page closes, which is when their time on the site is worth looking at again
 * @returns {void}
 * Side effects: adds a middleware and a connection handler to `io`; the handler updates the presence clock.
 */
export function attachSiteSocket(io, auth, { presence, onAway = () => {} } = {}) {
  io.use((socket, next) => {
    const user = auth.userForToken(parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]);
    if (!user) return next(new Error('Please sign in.'));
    socket.data.userId = user.id;
    next();
  });
  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(`user:${userId}`);
    if (!presence) return;
    presence.arrive(userId);
    socket.on('disconnect', () => {
      // Only when their last page goes: somebody with two tabs open is still here.
      if (presence.leave(userId)) onAway(userId);
    });
  });
}
