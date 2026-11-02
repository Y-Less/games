// The last middleware: turns an error into a JSON reply.
import { AuthError } from '../errors.js';

/**
 * Replies to a failed request: an AuthError with its own status, code, and params, too large or malformed JSON with 413
 * or 400, anything else with a plain 500 (the error itself is logged, never sent).  Every `error` is a key under `errors.`
 * in the site's locale files: the client puts it into words (see shared/messages.js).
 * @param {import('express').Express} app
 * @returns {void}
 * Side effects: adds the error-handling middleware (register it last); logs unexpected errors.
 */
export function registerErrorHandler(app) {
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message, ...(error.params ? { params: error.params } : {}) });
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'tooLarge' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalidJson' });
    console.error(error);
    res.status(500).json({ error: 'serverError' });
  });
}
