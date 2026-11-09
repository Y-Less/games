// Where a game's rooms are kept between restarts.  createRoomServer owns the rooms while the site is running; this owns
// the copy on disk, and nothing else in the shared layer touches the file.
//
// The format is one JSON array of rooms in <dataDir>/rooms.json, written atomically (a temporary file renamed over the
// real one, so a crash mid-write leaves the old file whole) and debounced, so many changes in a moment cost one write.
// A file that cannot be read is copied aside rather than overwritten: it holds everybody's games, and the next save
// would otherwise throw away the only copy.
//
// `put` takes one room and `dirty` remembers it until the next write.  Today every write still rewrites the whole file,
// so the dirty set buys nothing yet; it is here because the interface is what a per-room store needs, and swapping this
// implementation for one is then a change to this file alone (see the SQLite plan).
//
// Depends on: node:fs and node:path only.
import fs from 'node:fs';
import path from 'node:path';

/** How long to wait after a change before writing, so a burst of moves costs one write. */
const SAVE_DEBOUNCE_MS = 100;

/**
 * Opens a game's saved rooms.
 *
 * @param {object} options
 * @param {string} options.dataDir  the module's data folder; rooms.json is made inside it
 * @param {(...args: any[]) => void} options.log  where failures are reported (never thrown: a site that cannot save is
 *   still a site people are playing on)
 * @param {() => number} options.now  the clock, injected so a test can make the names of copied-aside files predictable
 * @param {(room: object) => object} [options.migrate]  brings one saved room up to date as it is read
 * @param {(room: object) => Array<object | null>} [options.members]  the people and computer players of a room, used to
 *   index who is in which room (default: room.seats, which has null for an empty seat)
 * @param {(member: object) => boolean} [options.isHuman]  which of those members is a person (default: none, so the
 *   index stays empty and `roomsOf` finds nobody)
 * @returns {{ load: Function, put: Function, remove: Function, roomsOf: Function, flush: Function, close: Function }}
 * Side effects: none until a method is called.
 */
export function createRoomStore({ dataDir, log, now, migrate, members = (room) => room.seats, isHuman = () => false }) {
  const file = path.join(dataDir, 'rooms.json');
  const rooms = new Map(); // code -> room, the copy this store writes from
  const dirty = new Set(); // codes changed since the last write
  const byUser = new Map(); // account id -> Set of room codes, so finding a person's rooms is not a scan of all of them
  let timer = null;

  /**
   * Keeps a damaged rooms file out of harm's way: copies it to rooms.json.corrupt (or, if that already exists,
   * rooms.json.corrupt-<time>) so that the next save does not overwrite the only copy of everybody's games.
   * @returns {string | null} the path of the copy, or null if it could not be made
   * Side effects: writes a file next to rooms.json; logs a failure.
   */
  function keepCorruptCopy() {
    let target = `${file}.corrupt`;
    if (fs.existsSync(target)) target = `${file}.corrupt-${now()}`;
    try {
      fs.copyFileSync(file, target);
      return target;
    } catch (error) {
      log('could not keep a copy of the damaged saved games:', error.message);
      return null;
    }
  }

  /**
   * Notes which people are in a room, so `roomsOf` never has to look through every room.
   * @param {object} room  the room to index
   * @returns {void}
   * Side effects: updates the account-to-rooms index.
   */
  function index(room) {
    unindex(room.code);
    for (const member of members(room) ?? []) {
      if (!isHuman(member)) continue;
      if (!byUser.has(member.id)) byUser.set(member.id, new Set());
      byUser.get(member.id).add(room.code);
    }
  }

  /**
   * Forgets a room in the index.
   * @param {string} code  the room code
   * @returns {void}
   * Side effects: updates the account-to-rooms index.
   */
  function unindex(code) {
    for (const [id, codes] of byUser) {
      if (!codes.delete(code)) continue;
      if (!codes.size) byUser.delete(id);
    }
  }

  return {
    // The rooms themselves, by code.  The store owns this map so that there is only one of them: createRoomServer reads
    // it directly and changes it only through put() and remove(), which keep the file and the index in step.
    rooms,

    /**
     * Reads the saved rooms.  A missing file is normal.  A file that cannot be read or parsed is logged and the rooms
     * start empty, with a copy kept beside it.  One room that cannot be brought up to date is logged and skipped, so it
     * does not take the others down with it.
     * @returns {object[]} the rooms, in the order they were saved
     * Side effects: reads the file, runs `migrate` on each room, may copy the file aside and log.
     */
    load() {
      let saved;
      try {
        saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        const copy = keepCorruptCopy();
        log(`the saved games are corrupt (${error.message}); starting with none${copy ? `, a copy is in ${copy}` : ''}`);
        return [];
      }
      let damaged = 0;
      for (const entry of Array.isArray(saved) ? saved : []) {
        try {
          const room = migrate ? (migrate(entry) ?? entry) : entry;
          rooms.set(room.code, room);
          index(room);
        } catch (error) {
          damaged++;
          log(`could not load the saved game ${entry?.code}:`, error.message);
        }
      }
      if (damaged) log(`${damaged} saved game(s) could not be loaded; a copy of the file is in ${keepCorruptCopy()}`);
      return [...rooms.values()];
    },

    /**
     * Takes in a room that has changed (or is new) and asks for a save soon.
     * @param {object} room  the room as it now is
     * @returns {void}
     * Side effects: updates the index and schedules a write (the timer is unreferenced, so it never keeps the process alive).
     */
    put(room) {
      rooms.set(room.code, room);
      index(room);
      dirty.add(room.code);
      timer ??= setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
      timer.unref?.();
    },

    /**
     * Forgets a room for good.
     * @param {string} code  the room code
     * @returns {void}
     * Side effects: as `put`, but removing.
     */
    remove(code) {
      rooms.delete(code);
      unindex(code);
      dirty.add(code);
      timer ??= setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
      timer.unref?.();
    },

    /**
     * The codes of the rooms an account is in, from the index rather than by looking through every room.
     * @param {number} userId  the account
     * @returns {string[]} the room codes (possibly none)
     * Side effects: none.
     */
    roomsOf(userId) {
      return [...(byUser.get(userId) ?? [])];
    },

    /**
     * Writes every room now, atomically.  A failure is logged, never thrown.
     * @returns {void}
     * Side effects: clears any pending debounced write, writes rooms.json, may log.
     */
    flush() {
      clearTimeout(timer);
      timer = null;
      dirty.clear();
      try {
        fs.writeFileSync(`${file}.tmp`, JSON.stringify([...rooms.values()]));
        fs.renameSync(`${file}.tmp`, file);
      } catch (error) {
        log('could not save the games:', error.message);
      }
    },

    /**
     * Writes anything outstanding and stops the timer.
     * @returns {void}
     * Side effects: as `flush`.
     */
    close() {
      this.flush();
    },
  };
}
