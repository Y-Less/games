// The site's own socket (the default namespace), for what is not part of one game: a person's pop-ups arrive here,
// wherever on the site they are.
import { parseCookies, SESSION_COOKIE } from './auth.js';

/**
 * Makes the default namespace refuse anyone not signed in, and puts each connection in the room `user:<id>`.
 * @param {import('socket.io').Server} io
 * @param {{ userForToken: (token: string | undefined) => object | null }} auth
 * @returns {void}
 * Side effects: adds a middleware and a connection handler to `io`.
 */
export function attachSiteSocket(io, auth) {
  io.use((socket, next) => {
    const user = auth.userForToken(parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]);
    if (!user) return next(new Error('Please sign in.'));
    socket.data.userId = user.id;
    next();
  });
  io.on('connection', (socket) => socket.join(`user:${socket.data.userId}`));
}
