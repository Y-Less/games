// Where a game's rooms are kept between restarts.  createRoomServer owns the rooms while the site is running; this owns
// the copy on disk, and nothing else in the shared layer touches it.
//
// The rooms live in <dataDir>/rooms.sqlite, one database per module (shared/roomDb.js has the tables and why there are
// two of them).  The site is still the source of truth: every room is held in memory and the database is written
// behind it, so no part of playing a game ever reads from disk.
//
// What this buys is that a move writes only what that move changed.  Before, every change rewrote every room in the
// module as one JSON file; now it writes one room's own column, and appends one row when a round finishes.  `put`
// marks a room as changed and `flush` works out what is actually different from the last thing written, which is what
// the `dirty` set was always for.
//
// A database that will not open is kept aside rather than started over, exactly as the damaged JSON file was: it holds
// everybody's games, and the next save would otherwise be the thing that threw away the only copy.
//
// Saved games from before this (a rooms.json file) are read once and written into the database, and the old file is
// renamed rather than deleted — it is the way back if this turns out to have been a bad idea.
//
// Depends on: node:fs, node:path, and ./roomDb.js.
import fs from 'node:fs';
import path from 'node:path';
import { openRoomDb, roomDbFile, statements, transaction } from './roomDb.js';

/** How long to wait after a change before writing, so a burst of moves costs one write. */
const SAVE_DEBOUNCE_MS = 100;

/**
 * The room as its own row holds it: everything except the rounds of its history, which have a table of their own.
 *
 * The empty list is kept when there was a list, because whether a room *has* a history is itself worth saving: Dixnt
 * and Tints and Hints both tell a room saved before histories existed from one whose history is empty, and show the
 * scores it already had as a single "earlier rounds" row.  Handing every room a `history: []` would quietly take that
 * telling-apart away.
 */
const stateOf = ({ history, ...rest }) => JSON.stringify(Array.isArray(history) ? { ...rest, history: [] } : rest);

/**
 * Which game of this room is being played.  A room outlives a game: "play again" keeps the code, the settings and the
 * people, and starts the next one.  A room saved before rooms held more than one game is that room's first game.
 * @param {{ gameSeq?: number }} room  not changed
 * @returns {number}
 */
const gameOf = (room) => room.gameSeq ?? 0;

/**
 * Opens a game's saved rooms.
 *
 * @param {object} options
 * @param {string} options.dataDir  the module's data folder; rooms.sqlite is made inside it
 * @param {(...args: any[]) => void} options.log  where failures are reported (never thrown: a site that cannot save is
 *   still a site people are playing on)
 * @param {() => number} options.now  the clock, injected so a test can make the names of copied-aside files predictable
 * @param {(room: object) => object} [options.migrate]  brings one saved room up to date as it is read
 * @param {(room: object) => Array<object | null>} [options.members]  the people and computer players of a room, used to
 *   index who is in which room (default: room.seats, which has null for an empty seat)
 * @param {(member: object) => boolean} [options.isHuman]  which of those members is a person (default: none, so the
 *   index stays empty and `roomsOf` finds nobody)
 * @returns {{ rooms: Map, load: Function, put: Function, remove: Function, roomsOf: Function, flush: Function, close: Function }}
 * Side effects: none until a method is called.
 */
export function createRoomStore({ dataDir, log, now, migrate, members = (room) => room.seats, isHuman = () => false }) {
  const rooms = new Map(); // code -> room, the copy this store writes from
  const dirty = new Set(); // codes changed since the last write
  const byUser = new Map(); // account id -> Set of room codes, so finding a person's rooms is not a scan of all of them
  const written = new Map(); // code -> what was last written for it, so a flush can write only the difference
  let db = null;
  let sql = null; // the prepared statements of the open database
  let timer = null;
  let closed = false; // once the site is stopping, the database is not opened again

  /**
   * Keeps a database that cannot be read out of harm's way, and leaves the folder ready for a new one.  The
   * write-ahead log and shared-memory files go with it, or SQLite would read them back over the fresh database.
   * @returns {string | null} the path of the copy, or null if it could not be made
   * Side effects: copies rooms.sqlite aside and deletes the three files of the damaged database; logs a failure.
   */
  function keepCorruptCopy() {
    const file = roomDbFile(dataDir);
    let target = `${file}.corrupt`;
    if (fs.existsSync(target)) target = `${file}.corrupt-${now()}`;
    try {
      fs.copyFileSync(file, target);
    } catch (error) {
      log('could not keep a copy of the damaged saved games:', error.message);
      return null;
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${file}${suffix}`, { force: true });
      } catch (error) {
        log('could not clear the damaged saved games away:', error.message);
      }
    }
    return target;
  }

  /**
   * The database, opened on first use.  If it cannot be opened it is kept aside and a new one is made, so the site
   * starts with no rooms rather than not starting.
   * @returns {import('node:sqlite').DatabaseSync | null} the database, or null if even a fresh one could not be made
   * Side effects: creates the folder and file, may copy a damaged database aside and log.
   */
  function database() {
    if (db) return db;
    // Stopping the site disposes the modules before it closes the sockets, and a socket closing can still ask for a
    // save.  Reopening the database for that would leave it open with nothing left to close it: the room is already
    // written, so there is nothing to do but say no.
    if (closed) return null;
    try {
      db = openRoomDb(dataDir);
      sql = statements(db);
      return db;
    } catch (error) {
      const copy = keepCorruptCopy();
      log(`the saved games are corrupt (${error.message}); starting with none${copy ? `, a copy is in ${copy}` : ''}`);
    }
    try {
      db = openRoomDb(dataDir);
      sql = statements(db);
      return db;
    } catch (error) {
      log('the saved games cannot be opened at all:', error.message);
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

  /**
   * Writes one room, and only the parts of it that are not already written.
   *
   * The history is compared round by round against what was last written for this room.  Normally it has grown by one
   * and that is one INSERT.  When a round has been rewritten in place, or the whole history emptied by "play again",
   * the rounds from the first difference onwards are deleted and written again — rare, and correct.
   *
   * @param {import('node:sqlite').DatabaseSync} handle  the open database
   * @param {object} room  the room as it now is
   * @returns {void}
   * Side effects: writes rows, and records what was written so the next flush can tell what changed.
   */
  function write(handle, room) {
    const state = stateOf(room);
    const game = gameOf(room);
    const entries = (room.history ?? []).map((entry) => JSON.stringify(entry));
    const last = written.get(room.code);
    // A new game under the same code starts its history afresh.  Nothing of the game before is compared against it —
    // the second game's first round may well read exactly like the first game's, and it is still a new round — and
    // nothing of it is deleted either, because its rounds are filed under its own number.
    const before = last && last.game === game ? last : { state: last?.state ?? null, entries: [] };

    if (state !== before.state) {
      sql('INSERT INTO rooms (code, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at').run(room.code, state, now());
    }

    let from = 0;
    while (from < entries.length && from < before.entries.length && entries[from] === before.entries[from]) from++;
    if (from < before.entries.length) sql('DELETE FROM room_history WHERE code = ? AND game_seq = ? AND seq >= ?').run(room.code, game, from);
    if (from < entries.length) {
      const insert = sql('INSERT INTO room_history (code, game_seq, seq, entry_json) VALUES (?, ?, ?, ?)');
      for (let seq = from; seq < entries.length; seq++) insert.run(room.code, game, seq, entries[seq]);
    }
    written.set(room.code, { state, entries, game });
  }

  /**
   * Forgets one room's rows.
   * @param {import('node:sqlite').DatabaseSync} handle  the open database
   * @param {string} code  the room code
   * @returns {void}
   * Side effects: deletes rows and what was recorded about them.
   */
  function erase(handle, code) {
    sql('DELETE FROM rooms WHERE code = ?').run(code);
    sql('DELETE FROM room_history WHERE code = ?').run(code);
    written.delete(code);
  }

  /**
   * Brings a rooms.json saved by an earlier version into the database, once.  The old file is renamed rather than
   * removed: it is the way back if this turns out to have been a mistake.
   * @param {import('node:sqlite').DatabaseSync} handle  the open database
   * @returns {void}
   * Side effects: reads rooms.json, writes rows, renames the file, and logs what it did.
   */
  function importJson(handle) {
    const file = path.join(dataDir, 'rooms.json');
    if (!fs.existsSync(file)) return;
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      // Kept under a name that says what happened, rather than left to be read and complained about at every start.
      // It holds everybody's games: whatever is wrong with it, it is not ours to throw away.
      let target = `${file}.corrupt`;
      if (fs.existsSync(target)) target = `${file}.corrupt-${now()}`;
      try {
        fs.renameSync(file, target);
        log(`the saved games are corrupt (${error.message}); starting with none, a copy is in ${target}`);
      } catch (problem) {
        log(`the saved games are corrupt (${error.message}) and could not be set aside: ${problem.message}`);
      }
      return;
    }
    const list = Array.isArray(saved) ? saved : [];
    try {
      transaction(handle, () => {
        for (const room of list) if (room?.code) write(handle, room);
      });
      fs.renameSync(file, `${file}.imported`);
      log(`${list.length} saved game(s) brought over from rooms.json`);
    } catch (error) {
      log('the saved games from the previous version could not be brought over:', error.message);
    }
  }

  return {
    // The rooms themselves, by code.  The store owns this map so that there is only one of them: createRoomServer reads
    // it directly and changes it only through put() and remove(), which keep the database and the index in step.
    rooms,

    /**
     * Reads the saved rooms.  An empty database is normal.  One room that cannot be brought up to date is logged and
     * skipped, so it does not take the others down with it.
     * @returns {object[]} the rooms, by code
     * Side effects: opens the database, may bring a rooms.json over, runs `migrate` on each room, may log.
     */
    load() {
      const handle = database();
      if (!handle) return [];
      importJson(handle);
      let rows;
      let history;
      try {
        rows = sql('SELECT code, state_json FROM rooms ORDER BY code').all();
        history = sql('SELECT code, game_seq, seq, entry_json FROM room_history ORDER BY code, game_seq, seq').all();
      } catch (error) {
        log('the saved games could not be read:', error.message);
        return [];
      }
      // Keyed by room *and* game: the rounds of the games played here before are kept, and the room comes back holding
      // the one being played now.
      const rounds = new Map();
      const key = (code, game) => `${code}\u0000${game}`;
      for (const row of history) {
        const at = key(row.code, row.game_seq);
        if (!rounds.has(at)) rounds.set(at, []);
        rounds.get(at).push(row.entry_json);
      }
      let damaged = 0;
      for (const row of rows) {
        try {
          const saved = JSON.parse(row.state_json);
          const game = gameOf(saved);
          const entries = rounds.get(key(row.code, game)) ?? [];
          // Only a room that had a history gets one back; see `stateOf` for why the difference is kept.
          if (Array.isArray(saved.history) || entries.length) saved.history = entries.map((entry) => JSON.parse(entry));
          // What is on disk, remembered before `migrate` has a chance to change the room: anything migrating alters is
          // then a difference the next write puts right.
          written.set(row.code, { state: row.state_json, entries, game });
          const room = migrate ? (migrate(saved) ?? saved) : saved;
          rooms.set(room.code, room);
          index(room);
        } catch (error) {
          damaged++;
          log(`could not load the saved game ${row?.code}:`, error.message);
        }
      }
      if (damaged) log(`${damaged} saved game(s) could not be loaded`);
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
     * Writes every room that has changed since the last time, as one transaction.  A failure is logged, never thrown.
     * @returns {void}
     * Side effects: clears any pending debounced write, writes to the database, may log.
     */
    flush() {
      clearTimeout(timer);
      timer = null;
      if (!dirty.size) return;
      const changed = [...dirty];
      dirty.clear();
      const handle = database();
      if (!handle) return;
      try {
        transaction(handle, () => {
          for (const code of changed) {
            const room = rooms.get(code);
            if (room) write(handle, room);
            else erase(handle, code);
          }
        });
      } catch (error) {
        log('could not save the games:', error.message);
      }
    },

    /**
     * Writes anything outstanding, stops the timer, and closes the database.
     * @returns {void}
     * Side effects: as `flush`, and the database is closed.
     */
    close() {
      this.flush();
      closed = true;
      try {
        db?.close();
      } catch (error) {
        log('could not close the saved games:', error.message);
      }
      db = null;
      sql = null;
    },
  };
}
