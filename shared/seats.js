// The seat and lobby rules every seated game shares: who is sitting where, how people and computer players join and
// leave, and what the host may do.  Hearts, Cheat, Gaudi, Splendour, Azulejo, Rummikub, and Nomination Whist each carried
// their own copy of this; they now build theirs from createSeatRules() and say only what differs.
//
// A room is a plain object saved as JSON.  The parts this file reads and writes:
//   room.seats[i]   null (empty, lobby only), a person { kind: 'human', id: <account id>, name },
//                   or a computer player { kind: 'bot', id: 'bot:<n>', name } (games add more fields, e.g. `ai`)
//   room.hostId     the account id of the host
//   room.phase      'lobby' while people are arriving; anything else once the game has started
//   room.nextBot    the number the next computer player's id will use
//
// Every rule returns { ok: true, ... } or { ok: false, error }, and (like all the rules) mutates the room it is given.
// Depends on: nothing (pure, no imports); the rules here are driven by shared/roomServer.js and each seated game's rules.js.

/** Names computer players are given, in order, until they run out (then "Computer", "Computer 2", ...). */
export const DEFAULT_BOT_NAMES = ['Hazel', 'Otis', 'Mabel', 'Felix', 'Ivy', 'Rufus', 'Nell', 'Boris', 'Pearl', 'Hugo'];

/** A failed rule. */
// `error` is a code: a key under `errors.` in the game's or the site's locale file (src/locales/en.json), which the client
// puts into words; `params` are the values the words need.  See shared/messages.js.
export const fail = (error, params) => (params ? { ok: false, error, params } : { ok: false, error });
/** A successful rule, with any extra facts about what happened. */
export const ok = (extra = {}) => ({ ok: true, ...extra });

/** Is this seat a person?  (An empty seat is null, so this is false for it.) */
export const isHuman = (seat) => seat?.kind === 'human';
/** Is this seat a computer player? */
export const isBot = (seat) => seat?.kind === 'bot';
/** The index of a person's seat, or -1 if they are not in the room. */
export const seatOf = (room, userId) => room.seats.findIndex((s) => isHuman(s) && s.id === userId);
/** Is this account sitting in the room? */
export const hasPlayer = (room, userId) => seatOf(room, userId) !== -1;
/** The indexes of every seat a person holds. */
export const humanSeats = (room) => room.seats.flatMap((s, i) => (isHuman(s) ? [i] : []));
/** The indexes of every seat a computer player holds. */
export const botSeats = (room) => room.seats.flatMap((s, i) => (isBot(s) ? [i] : []));
/** The index of the first empty seat, or -1 if the table is full. */
export const firstEmpty = (room) => room.seats.findIndex((s) => s === null);
/** A list of n empty seats. */
export const emptySeats = (n) => Array.from({ length: n }, () => null);

/** Is this seat the marker left by a person who left after the game ended?  (See goneSeat.) */
export const isGone = (seat) => seat?.kind === 'gone';
/**
 * The marker a person leaves behind when they leave a FINISHED game: their name stays on the final scores and the table
 * does not have to cope with a missing seat.  Pass it as `finishedSeat` to createSeatRules.  The marker is not a person
 * (isHuman is false, so it is never kicked, recorded, or waited for) and it is away.
 * @param {{ name: string }} leaving  the seat they are leaving
 * @returns {{ kind: 'gone', name: string }}
 */
export const goneSeat = (leaving) => ({ kind: 'gone', name: leaving.name });
/**
 * Frees the seats of people who left the finished game (for "play again": the next game starts in the lobby without them).
 * @param {{ seats: Array<object | null> }} room  the room to change
 * @returns {void}
 * Side effects: replaces every gone marker in `room.seats` with null.
 */
export function freeGoneSeats(room) {
  room.seats = room.seats.map((seat) => (isGone(seat) ? null : seat));
}

/** Null if this account is the host, otherwise the failure to return. */
export const asHost = (room, userId) => (room.hostId === userId ? null : fail('hostOnly'));
/** Null while the game is still in the lobby, otherwise the failure to return. */
const inLobby = (room) => (room.phase === 'lobby' ? null : fail('settingsBeforeStart'));
/** Both of the above: the first problem, or null if the host is changing the lobby. */
export const hostInLobby = (room, userId) => asHost(room, userId) ?? inLobby(room);

/**
 * The first of `wanted`, `numbered(wanted, 2)`, `numbered(wanted, 3)` ... that is not already used, ignoring capital letters.
 * Both people and computer players are named through this, so "hazel" and "Hazel" can never sit at one table.
 * @param {Iterable<string>} used  the names already taken
 * @param {string} wanted  the name asked for
 * @param {(wanted: string, n: number) => string} numbered  how to write the n-th variant, e.g. "Ann (2)" or "Computer 2"
 * @returns {string}
 * Side effects: none.
 */
export function freeName(used, wanted, numbered) {
  const taken = new Set([...used].map((n) => n.toLowerCase()));
  let name = wanted;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = numbered(wanted, n);
  return name;
}

/**
 * The name for the next computer player: the first unused name from the list, then "Computer", numbered if it clashes.
 * @param {Iterable<string>} used  the names already taken (people and computer players)
 * @param {string[]} botNames  the names to try first, in order
 * @returns {string}
 * Side effects: none.
 */
export function nextBotName(used, botNames) {
  const taken = new Set([...used].map((n) => n.toLowerCase()));
  const base = botNames.find((n) => !taken.has(n.toLowerCase())) ?? 'Computer';
  return freeName(used, base, (b, n) => `${b} ${n}`);
}

/**
 * Finds a name nobody else at the table has (ignoring capital letters): "Ann" becomes "Ann (2)" if "ann" is taken.
 * @param {{ seats: Array<{ name: string } | null> }} room  the room whose seats are checked (not changed)
 * @param {string} wanted  the name the person would like
 * @returns {string} `wanted`, or `wanted` with " (n)" appended
 * Side effects: none.
 */
export const uniqueName = (room, wanted) => freeName(seatNames(room), wanted, (w, n) => `${w} (${n})`);

/** The names of everybody at the table (people and computer players). */
const seatNames = (room) => room.seats.filter(Boolean).map((s) => s.name);

/**
 * Builds a game's seat rules.
 *
 * @param {object} config
 * @param {(room: object) => boolean} config.isMidGame  true while a game is being played, when somebody who leaves is
 *   replaced by a computer player (otherwise their seat is simply freed)
 * @param {string[]} [config.botNames]  the names computer players get (default DEFAULT_BOT_NAMES)
 * @param {(room: object, bot: object, seat: number, rng: () => number) => object} [config.takeOver]  called with the
 *   computer player about to replace a person who left; it may mutate the room (write a log line, record the bot's AI)
 *   and returns the seat object to store (add `ai`, say).  Default: the bot unchanged.
 * @param {(room: object, rng: () => number, now: number) => void} [config.afterRemoval]  runs after somebody has left and at least one
 *   person remains (for example, they may have been the only one the game was waiting for)
 * @param {(seat: object) => (object | null)} [config.finishedSeat]  what a seat becomes when its person leaves a finished
 *   game (default null; Nomination Whist keeps a { kind: 'gone', name } marker so the final scores still make sense)
 * @returns {object} the rules: newBot, addHuman, removeHuman, addBot, removeBot, fillWithBots, kick
 */
export function createSeatRules({ isMidGame, botNames = DEFAULT_BOT_NAMES, takeOver = (room, bot) => bot, afterRemoval = () => {}, finishedSeat = () => null }) {
  /**
   * Makes the next computer player: the first unused name from the list, then "Computer", numbered if it clashes.
   * @param {{ seats: Array<object|null>, nextBot: number }} room  the room (seats read to avoid clashing names)
   * @returns {{ kind: 'bot', id: string, name: string }} the new bot (not yet placed in a seat)
   * Side effects: increments `room.nextBot`.
   */
  function newBot(room) {
    return { kind: 'bot', id: `bot:${room.nextBot++}`, name: nextBotName(seatNames(room), botNames) };
  }

  /**
   * Seats a person in the first free seat.  Joining twice is harmless (they keep their seat), and the game must still be in
   * the lobby for a newcomer.
   * @param {object} room  the room to change
   * @param {number} userId  the joining account id
   * @param {string} name  the display name wanted (made unique at the table)
   * @returns {{ ok: boolean, seat?: number, error?: string }} the seat index, or why joining failed
   * Side effects: sets `room.seats[seat]` to a new human seat on success.
   */
  function addHuman(room, userId, name) {
    if (hasPlayer(room, userId)) return ok({ seat: seatOf(room, userId) });
    if (room.phase !== 'lobby') return fail('thatGameStarted');
    const seat = firstEmpty(room);
    if (seat === -1) return fail('gameFull');
    room.seats[seat] = { kind: 'human', id: userId, name: uniqueName(room, name) };
    return ok({ seat });
  }

  /**
   * Takes a person out.  In the lobby their seat is freed; mid-game a computer player takes it over; once the game is over
   * the seat is freed (or marked by `finishedSeat`).  If they were the host, the next person becomes host.
   * @param {object} room  the room to change
   * @param {number} userId  the account leaving
   * @param {() => number} rng  random source, handed to `takeOver` and `afterRemoval`
   * @param {number} now  current time in ms, handed to `afterRemoval`
   * @returns {{ ok: boolean, empty?: boolean, seat?: number, replaced?: boolean, error?: string }} `empty` is true when no
   *   person is left, so the caller should discard the room
   * Side effects: mutates `room.seats`, may change `room.hostId`, `room.nextBot` and whatever `takeOver`/`afterRemoval` change.
   */
  function removeHuman(room, userId, rng, now) {
    const seat = seatOf(room, userId);
    if (seat === -1) return fail('notInGame');
    const midGame = isMidGame(room);
    const leaving = room.seats[seat];
    if (midGame) room.seats[seat] = takeOver(room, newBot(room), seat, rng);
    else room.seats[seat] = room.phase === 'finished' ? finishedSeat(leaving) : null;
    const humans = humanSeats(room);
    if (!humans.length) return ok({ empty: true, seat });
    if (room.hostId === userId) room.hostId = room.seats[humans[0]].id;
    afterRemoval(room, rng, now);
    return ok({ empty: false, seat, replaced: midGame });
  }

  /**
   * The host puts a computer player in a seat (the first empty one if no seat is named).  Lobby only.
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (must be the host)
   * @param {number} [seat]  the seat index wanted, or undefined for the first empty seat
   * @returns {{ ok: boolean, seat?: number, error?: string }} the seat used, or why it failed
   * Side effects: sets `room.seats[seat]` to a new bot; increments `room.nextBot`.
   */
  function addBot(room, userId, seat) {
    const problem = hostInLobby(room, userId);
    if (problem) return problem;
    const index = seat === undefined ? firstEmpty(room) : seat;
    if (index === -1) return fail('everySeatTaken');
    if (!Number.isInteger(index) || index < 0 || index >= room.seats.length) return fail('noSuchSeat');
    if (room.seats[index]) return fail('seatTaken');
    room.seats[index] = newBot(room);
    return ok({ seat: index });
  }

  /**
   * The host takes a computer player out of a seat.  Lobby only.
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (must be the host)
   * @param {number} seat  the seat index holding the bot
   * @returns {{ ok: boolean, error?: string }} success, or why it failed
   * Side effects: sets `room.seats[seat]` to null.
   */
  function removeBot(room, userId, seat) {
    const problem = hostInLobby(room, userId);
    if (problem) return problem;
    if (!Number.isInteger(seat) || !isBot(room.seats[seat])) return fail('noBotInSeat');
    room.seats[seat] = null;
    return ok();
  }

  /**
   * The host fills every empty seat with a computer player.  Lobby only.
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (must be the host)
   * @returns {{ ok: boolean, error?: string }} success, or why it failed
   * Side effects: fills empty entries of `room.seats` with new bots; increments `room.nextBot` per bot.
   */
  function fillWithBots(room, userId) {
    const problem = hostInLobby(room, userId);
    if (problem) return problem;
    for (let i = 0; i < room.seats.length; i++) if (!room.seats[i]) room.seats[i] = newBot(room);
    return ok();
  }

  /**
   * The host removes another person, at any time before the game is over: in the lobby their seat is freed, and in a
   * game a computer player takes it over (as when someone leaves).  A finished game has nobody to remove.  The result names
   * the person so the server can send them home.
   * @param {object} room  the room to change
   * @param {number} hostId  who is asking (must be the host)
   * @param {number} seat  the seat index of the person to remove
   * @param {() => number} rng  random source, passed through to removeHuman
   * @param {number} now  current time in ms, passed through to removeHuman
   * @returns {{ ok: boolean, userId?: number, replaced?: boolean, error?: string }} who was removed, or why it failed
   * Side effects: as removeHuman (mutates `room.seats`, may change the host).
   */
  function kick(room, hostId, seat, rng, now) {
    const problem = asHost(room, hostId);
    if (problem) return problem;
    const target = Number.isInteger(seat) ? room.seats[seat] : null;
    if (!isHuman(target) || target.id === hostId) return fail('nobodyElseInSeat');
    if (room.phase === 'finished') return fail('gameOverNobodyToRemove');
    const removed = removeHuman(room, target.id, rng, now);
    return removed.ok ? ok({ userId: target.id, replaced: Boolean(removed.replaced) }) : removed;
  }

  return { newBot, addHuman, removeHuman, addBot, removeBot, fillWithBots, kick };
}
