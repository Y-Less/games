// The site's own error types. A route turns one of these into a JSON reply with its status (see routes/errorHandler.js).

/** A refused request: `message` is shown to the person, `status` is the HTTP status code of the reply. */
export class AuthError extends Error {
  /**
   * @param {string} message  what the person is told
   * @param {number} [status]  the HTTP status (400 by default)
   * @returns {AuthError}
   * Side effects: none.
   */
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
