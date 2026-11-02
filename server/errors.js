// The site's own error types.  A route turns one of these into a JSON reply with its status (see routes/errorHandler.js).

/** A refused request: `message` is shown to the person, `status` is the HTTP status code of the reply. */
export class AuthError extends Error {
  /**
   * @param {string} code  which refusal, as a key under `errors.` in the site's locale files (the client puts it into words)
   * @param {number} [status]  the HTTP status (400 by default)
   * @param {object} [params]  the values the text needs ({ min, max }, say)
   * @returns {AuthError}
   * Side effects: none.
   */
  constructor(code, status = 400, params) {
    super(code);
    this.status = status;
    this.params = params;
  }
}
