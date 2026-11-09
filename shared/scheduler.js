// The timer behind "what the server does next by itself": a computer player's move, the pause at the end of a trick, the
// moment a drawing's time runs out.  createRoomServer asks for one of these per module and calls `schedule(room)` after
// anything changes; the game decides what is due through its own `nextAction`.
//
// Nothing here knows any rules.  It knows only that a game may owe a room an action, that an action may throw, and that
// a room which keeps throwing should be left alone rather than retried for ever: after MAX_RETRIES failures in a row the
// room waits for a person to do something, and any change to it (see `forget`) starts the count afresh.
//
// Depends on: nothing (the clock, the random source and the rules all arrive as arguments).

/** How many times in a row a scheduled move may throw before the room is left alone, and the first wait (it doubles). */
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

/**
 * Builds the scheduler for one game.
 *
 * @param {object} options
 * @param {(room: object) => ({ key?: string, wait: number, run: () => void } | null)} options.nextAction  what the
 *   server owes this room, if anything.  `wait` milliseconds from now it calls `run()`.  If `key` is given and the same
 *   key is already waiting, the existing timer is kept rather than restarted.
 * @param {(room: object) => boolean} options.current  whether this room is still the one the server holds under its
 *   code: a timer that fires for a room that has since been discarded or replaced must do nothing
 * @param {(room: object) => void} options.changed  called after an action has run, so the server can save and tell everybody
 * @param {(...args: any[]) => void} options.log  where failures are reported
 * @returns {{ schedule: Function, cancel: Function, forget: Function, stop: Function }}
 * Side effects: none until a method is called; `schedule` then sets timers (unreferenced, so they never keep the
 *   process alive).
 */
export function createScheduler({ nextAction, current, changed, log }) {
  const timers = new Map(); // room code -> { timer, key } for the next thing the server does by itself
  const failures = new Map(); // room code -> how many scheduled moves have thrown in a row

  /**
   * Stops any pending timer for a room.
   * @param {string} code  the room code
   * @returns {void}
   * Side effects: clears the room's timer and removes it from the table.
   */
  function cancel(code) {
    clearTimeout(timers.get(code)?.timer);
    timers.delete(code);
  }

  /**
   * Tries scheduling again after a pause (used after a scheduled move threw).
   * @param {object} room  the room to reschedule
   * @param {number} wait  milliseconds to wait first
   * @returns {void}
   * Side effects: sets the room's timer, which later calls `schedule(room)` if the room is still the current one.
   */
  function retryLater(room, wait) {
    const timer = setTimeout(() => {
      timers.delete(room.code);
      if (current(room)) schedule(room);
    }, wait);
    timer.unref?.();
    timers.set(room.code, { timer, key: undefined });
  }

  /**
   * Notes that a scheduled move (or the work of finding it) threw: logs it and, for the first MAX_RETRIES failures in a
   * row, tries again after a pause that doubles each time.
   * @param {object} room  the room whose move failed
   * @param {string} what  what failed, for the log
   * @param {Error} error  the thrown error
   * @returns {void}
   * Side effects: logs, counts the failure for this room and may set a retry timer.
   */
  function failedMove(room, what, error) {
    const count = (failures.get(room.code) ?? 0) + 1;
    failures.set(room.code, count);
    log(`${what}:`, error);
    if (count <= MAX_RETRIES) retryLater(room, RETRY_BASE_MS * 2 ** (count - 1));
  }

  /**
   * Works out what the server owes this room next and sets the timer for it, replacing any earlier timer (unless the
   * action says its key is unchanged).  A throw — from the action, from working out what the action is, or from telling
   * everybody afterwards — is logged and retried rather than escaping from a timer, where nothing would catch it, or
   * leaving the room waiting for ever.
   * @param {object} room  the room to schedule for
   * @returns {void}
   * Side effects: cancels or sets the room's timer; when it fires it runs the game's action, which may change the room,
   *   and then calls `changed`.
   */
  function schedule(room) {
    let action;
    try {
      action = nextAction(room);
    } catch (error) {
      cancel(room.code);
      failedMove(room, 'could not work out the next move', error);
      return;
    }
    const waiting = timers.get(room.code);
    if (!action) {
      cancel(room.code);
      return;
    }
    if (action.key !== undefined && waiting?.key === action.key) return;
    cancel(room.code);
    const timer = setTimeout(() => {
      timers.delete(room.code);
      if (!current(room)) return;
      try {
        action.run();
        changed(room); // which also forgets earlier failures
      } catch (error) {
        failedMove(room, 'a scheduled move failed', error);
      }
    }, action.wait);
    timer.unref?.();
    timers.set(room.code, { timer, key: action.key });
  }

  return {
    schedule,
    cancel,

    /**
     * Forgets a room's run of failed moves, because somebody acted and it is worth trying for again.
     * @param {string} code  the room code
     * @returns {void}
     * Side effects: clears this room's failure count.
     */
    forget(code) {
      failures.delete(code);
    },

    /**
     * Stops every timer (the site is shutting down).
     * @returns {void}
     * Side effects: clears and forgets every timer.
     */
    stop() {
      for (const { timer } of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
