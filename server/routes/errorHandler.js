// The last middleware: turns an error into a JSON reply.
import { AuthError } from '../errors.js';

/**
 * Replies to a failed request: an AuthError with its own status and message, too large or malformed JSON with 413 or 400,
 * anything else with a plain 500 (the error itself is logged, never sent).
 * @param {import('express').Express} app
 * @returns {void}
 * Side effects: adds the error-handling middleware (register it last); logs unexpected errors.
 */
export function registerErrorHandler(app) {
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large.' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'That was not valid JSON.' });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
}
