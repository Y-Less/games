// Sign-in routes: register, log in, log out, and who am I.
import { clearedCookie, sessionCookie } from '../auth.js';
import { handler, tokenOf } from './http.js';

/**
 * Registers POST /auth/register, /auth/login, /auth/logout and GET /me.
 * @param {import('express').Router} api  the router mounted at /api
 * @param {{ auth: object, achievements: object }} deps
 * @returns {void}
 * Side effects: adds routes; registering an account settles its achievements ("Welcome").
 */
export function registerAuthRoutes(api, { auth, achievements }) {
  /**
   * Sets the session cookie and replies with the user.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @param {{ user: object, token: string }} signedInUser
   * @returns {void}
   * Side effects: sets the Set-Cookie header and sends the reply.
   */
  const signedIn = (req, res, { user, token }) => {
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: req.secure }));
    res.json({ user });
  };

  api.post('/auth/register', handler(async (req, res) => {
    const { username, password, displayName } = req.body ?? {}; // isBot is deliberately not accepted from clients
    const registered = await auth.register({ username, password, displayName, ip: req.ip });
    achievements.settle(registered.user.id); // "Welcome" is waiting from the first moment
    signedIn(req, res, registered);
  }));
  api.post('/auth/login', handler(async (req, res) => signedIn(req, res, await auth.login({ ...(req.body ?? {}), ip: req.ip }))));
  api.post('/auth/logout', (req, res) => {
    auth.logout(tokenOf(req));
    res.setHeader('Set-Cookie', clearedCookie);
    res.json({ ok: true });
  });
  api.get('/me', (req, res) => res.json({ user: auth.userForToken(tokenOf(req)) }));
}
