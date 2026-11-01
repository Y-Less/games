// Small helpers every route file uses: reading the session cookie, requiring a signed-in user, and passing async errors on.
import { parseCookies, SESSION_COOKIE } from '../auth.js';

/**
 * The session token in a request's cookies.
 * @param {import('express').Request} req
 * @returns {string | undefined}
 * Side effects: none.
 */
export const tokenOf = (req) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

/**
 * Makes the middleware that refuses requests from nobody signed in.
 * @param {{ userForToken: (token: string | undefined) => object | null }} auth
 * @returns {import('express').RequestHandler}  replies 401 { error: 'Please sign in.' }, or sets `req.user` and goes on
 * Side effects: none until it runs; then sets req.user or sends the 401.
 */
export const makeRequireUser = (auth) => (req, res, next) => {
  const user = auth.userForToken(tokenOf(req));
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  req.user = user;
  next();
};

/**
 * Wraps an async route so that a throw reaches the error handler.
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<void> | void} fn
 * @returns {import('express').RequestHandler}
 * Side effects: none until it runs.
 */
export const handler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};
