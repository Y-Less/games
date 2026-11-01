// The "Recent moves" log that several games keep on the room: a list of `{ seat, text }` lines (with any extra fields a game
// wants, such as Cribbage's points), oldest first, of which only the newest few are kept so a saved room stays small.
// Depends on: nothing (pure, no imports).

/** How many lines a room keeps. */
export const LOG_KEPT = 60;

/**
 * Adds a line to the room's log and drops the oldest lines beyond `limit`.
 * @param {{ log: object[] }} room  the room whose log is appended to
 * @param {object} entry  the line, e.g. `{ seat, text }`; it must not reveal anything hidden
 * @param {number} [limit]  how many lines to keep (default LOG_KEPT)
 * @returns {void}
 * Side effects: mutates `room.log` (push, then trims the oldest entries).
 */
export function addMove(room, entry, limit = LOG_KEPT) {
  room.log.push(entry);
  if (room.log.length > limit) room.log.splice(0, room.log.length - limit);
}

/**
 * Returns the newest lines of the log, for a view.
 * @param {{ log: object[] }} room  the room whose log is read (not changed)
 * @param {number} count  how many lines at most
 * @returns {object[]} a copy of the last `count` lines, oldest first
 * Side effects: none.
 */
export const recentMoves = (room, count) => room.log.slice(-count);
