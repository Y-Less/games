// The "Recent moves" log that several games keep on the room: a list of `{ seat, text }` lines (with any extra fields a game
// wants, such as Cribbage's points), oldest first, of which only the newest few are kept so a saved room stays small.

/** How many lines a room keeps. */
export const LOG_KEPT = 60;

/**
 * Adds a line to the room's log and drops the oldest lines beyond `limit`.
 * Side effects: mutates `room.log`.
 *
 * @param {{ log: object[] }} room
 * @param {object} entry  the line, e.g. `{ seat, text }`; it must not reveal anything hidden
 * @param {number} [limit]  how many lines to keep
 */
export function addMove(room, entry, limit = LOG_KEPT) {
  room.log.push(entry);
  if (room.log.length > limit) room.log.splice(0, room.log.length - limit);
}

/**
 * The newest lines of the log, for a view.
 *
 * @param {{ log: object[] }} room  not changed
 * @param {number} count  how many lines at most
 * @returns {object[]} a copy of the last `count` lines, oldest first
 */
export const recentMoves = (room, count) => room.log.slice(-count);
