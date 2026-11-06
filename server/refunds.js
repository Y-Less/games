// Refund requests: checking what somebody wrote and keeping it.  Nothing reads these afterwards and nothing pays
// anybody back; the request is filed, and the page says how long customer support will take over it.
// Depends on: errors.js, shared/input.js (reading the field safely) and shared/refunds.js (the length rule).
import { AuthError } from './errors.js';
import { textFrom } from '../shared/input.js';
import { REFUND_MAXIMUM_CHARACTERS, REFUND_MINIMUM_WORDS, countWords } from '../shared/refunds.js';

/**
 * The refund operations on a database.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ submit: Function, countFor: Function }}
 * Side effects: none until a method is called.
 */
export function createRefunds(db) {
  return {
    /**
     * Files a refund request, once its writing is long enough.
     * @param {number} userId
     * @param {unknown} input  the writing, as the client sent it
     * @returns {{ id: number, words: number }}  the new request and how many words it held
     * @throws {AuthError} 400 when it is too short, or longer than the column is meant to hold
     * Side effects: inserts one refund_requests row.
     */
    submit(userId, input) {
      const text = textFrom(input).trim();
      const words = countWords(text);
      if (words < REFUND_MINIMUM_WORDS) throw new AuthError('refundTooShort', 400, { min: REFUND_MINIMUM_WORDS, n: words });
      if (text.length > REFUND_MAXIMUM_CHARACTERS) throw new AuthError('refundTooLong', 400, { max: REFUND_MAXIMUM_CHARACTERS });
      const { lastInsertRowid } = db.prepare('INSERT INTO refund_requests (user_id, words, text, created_at) VALUES (?, ?, ?, ?)').run(userId, words, text, Date.now());
      return { id: Number(lastInsertRowid), words };
    },

    /**
     * How many requests somebody has filed.
     * @param {number} userId
     * @returns {number}
     * Side effects: none.
     */
    countFor(userId) {
      return db.prepare('SELECT COUNT(*) AS n FROM refund_requests WHERE user_id = ?').get(userId).n;
    },
  };
}
