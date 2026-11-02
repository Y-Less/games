// How long each person has been on the site. Every signed-in page holds the site's own socket open (see siteSocket.js),
// so "online" means "has at least one of those open": two tabs are one person, not two, and the clock runs once.
//
// The running total lives in users.online_seconds and is banked when the last socket of a person closes. What they have
// built up in the session they are in right now is added on the way out of `seconds`, so the figure a page shows and the
// value an achievement is measured against both count the time since they arrived.
//
// Depends on: nothing but the database handle.

/** The clock is injected so a test can move it without waiting. */
const SECOND = 1000;

/**
 * Tracks who is here and for how long.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: () => number }} [options]  now: the clock in milliseconds (default Date.now)
 * @returns {{ arrive: (userId: number) => void, leave: (userId: number) => boolean, seconds: (userId: number) => number,
 *   minutes: (userId: number) => number, here: () => number[], flush: () => void }}
 *   `leave` says whether that was their last socket; `here` lists who is online; `flush` banks everyone's open session
 * Side effects: none until a method is called; then reads and updates the users table.
 */
export function createPresence(db, { now = Date.now } = {}) {
  const open = new Map(); // user id -> { sockets, since } for everybody with at least one socket open
  const read = db.prepare('SELECT online_seconds AS seconds FROM users WHERE id = ?');
  const add = db.prepare('UPDATE users SET online_seconds = online_seconds + ? WHERE id = ?');

  /**
   * Banks the whole seconds of a person's open session and starts counting again from the remainder, so repeated
   * banking (a flush, then a disconnect) never loses or double-counts a second.
   * @param {number} userId
   * @returns {void}
   * Side effects: updates users.online_seconds and the person's `since`.
   */
  function bank(userId) {
    const session = open.get(userId);
    if (!session) return;
    const whole = Math.floor((now() - session.since) / SECOND);
    if (whole <= 0) return;
    add.run(whole, userId);
    session.since += whole * SECOND;
  }

  return {
    /**
     * A person opened a socket. Their clock starts on the first one.
     * @param {number} userId
     * @returns {void}
     * Side effects: remembers them as here.
     */
    arrive(userId) {
      const session = open.get(userId);
      if (session) session.sockets += 1;
      else open.set(userId, { sockets: 1, since: now() });
    },

    /**
     * A person closed a socket. On the last one their session is banked and their clock stops.
     * @param {number} userId
     * @returns {boolean} true when that was their last socket, so they are now away
     * Side effects: may update users.online_seconds.
     */
    leave(userId) {
      const session = open.get(userId);
      if (!session) return false;
      session.sockets -= 1;
      if (session.sockets > 0) return false;
      bank(userId);
      open.delete(userId);
      return true;
    },

    /**
     * How long a person has been on the site in total, counting the session they are in now.
     * @param {number} userId
     * @returns {number} whole seconds (0 for somebody with no account)
     * Side effects: none.
     */
    seconds(userId) {
      const stored = read.get(userId)?.seconds ?? 0;
      const session = open.get(userId);
      return stored + (session ? Math.floor((now() - session.since) / SECOND) : 0);
    },

    /**
     * The same total in whole minutes, which is what the achievement counts.
     * @param {number} userId
     * @returns {number}
     * Side effects: none.
     */
    minutes(userId) {
      return Math.floor(this.seconds(userId) / 60);
    },

    /** Who is online right now, as account ids. Side effects: none. */
    here: () => [...open.keys()],

    /**
     * Banks what everybody still here has built up, without sending them away: for shutting the site down, so a
     * restart does not throw away the session people are in.
     * @returns {void}
     * Side effects: updates users.online_seconds.
     */
    flush() {
      for (const userId of [...open.keys()]) bank(userId);
    },
  };
}
