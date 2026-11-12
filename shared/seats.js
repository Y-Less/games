// The seated family's front door onto shared/members.js: Hearts, Cheat, Gaudi, Splendour, Azulejo, Rummikub, and
// Nomination Whist.  Everything about joining, leaving, being replaced and being put out is written once, in
// members.js, over the two layouts in layout.js; this file says what is true of a game with numbered seats, and
// re-exports the small helpers so that eight games' imports did not have to move.
//
// A room is a plain object saved as JSON.  The parts this family reads and writes:
//   room.seats[i]   null (empty, lobby only), a person { kind: 'human', id: <account id>, name },
//                   or a computer player { kind: 'bot', id: 'bot:<n>', name } (games add more fields, e.g. `ai`)
//   room.hostId     the account id of the host
//   room.phase      'lobby' while people are arriving; anything else once the game has started
//   room.nextBot    the number the next computer player's id will use
//
// Every rule returns { ok: true, ... } or { ok: false, error }, and (like all the rules) mutates the room it is given.
// A place is named from outside by its slot ("s0", "s1"), which here is the seat number; see shared/layout.js.
// Depends on: shared/members.js, shared/layout.js.
import { seatLayout } from './layout.js';
import { createMemberRules, defaultPlayers, fail, freeName, hostInLobby, isBot, isHuman, ok } from './members.js';

export { DEFAULT_BOT_NAMES, asHost, barFromRoom, defaultPlayers, fail, freeName, hostInLobby, isBarred, isBot, isHuman, nextBotName, nextGame, ok } from './members.js';

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
/** How many seats somebody is in: fewer than there are in the lobby, and all of them once the game has started. */
export const taken = (room) => room.seats.filter(Boolean).length;
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

/** The names of everybody at the table (people, computer players, and the markers of those who have gone). */
const seatNames = (room) => seatLayout.list(room).filter((s) => typeof s.name === 'string').map((s) => s.name);

/**
 * Finds a name nobody else at the table has (ignoring capital letters): "Ann" becomes "Ann (2)" if "ann" is taken.
 * @param {{ seats: Array<{ name: string } | null> }} room  the room whose seats are checked (not changed)
 * @param {string} wanted  the name the person would like
 * @returns {string} `wanted`, or `wanted` with " (n)" appended
 * Side effects: none.
 */
export const uniqueName = (room, wanted) => freeName(seatNames(room), wanted, (w, n) => `${w} (${n})`);

/** The codes this family's clients already know.  The two families never used the same ones. */
const SEAT_ERRORS = {
  barred: 'removedFromGame',
  full: 'gameFull',
  started: 'thatGameStarted',
  notInGame: 'notInGame',
  kickNotHost: 'hostOnly',
  kickTarget: 'nobodyElseInSeat',
  gameOver: 'gameOverNobodyToRemove',
};

/**
 * Builds a seated game's rules.
 *
 * @param {object} config
 * @param {(room: object) => boolean} config.isMidGame  true while a game is being played, when somebody who leaves is
 *   replaced by a computer player (otherwise their seat is simply freed)
 * @param {string[]} [config.botNames]  the names computer players get (default DEFAULT_BOT_NAMES)
 * @param {(room: object, oldId: number, bot: object, rng: () => number, now: number, seat: number) => void}
 *   [config.takeOver]  runs after a computer player has taken the seat of a person who left a game under way.  The
 *   computer player is already in the seat: give it an AI, write a log line, and tell the game if it was waiting for
 *   the person who has gone.
 * @param {(room: object, botId: string, person: object, bot: object, seat: number) => void} [config.handOver]  the
 *   mirror of takeOver: runs after somebody joining a game under way has taken a computer player's seat.  The person
 *   is already in it, holding everything the computer player had but its name and its `ai`.
 * @param {(room: object, leaving: object, bot: object) => object} [config.replacement]  what a seat becomes when its
 *   person leaves a game under way.  The default is the fresh computer player, because a seated game keeps its
 *   per-player state in arrays beside the seats; Cribbage keeps it on the seat and so says otherwise.
 * @param {(room: object, rng: () => number, now: number) => void} [config.afterRemoval]  runs after somebody has left
 *   and at least one person remains (for example, they may have been the only one the game was waiting for)
 * @param {(seat: object) => (object | null)} [config.finishedSeat]  what a seat becomes when its person leaves a finished
 *   game (default null; Nomination Whist keeps a { kind: 'gone', name } marker so the final scores still make sense)
 * @param {number} config.minPlayers  the fewest the game can be played with: the fewest seats the host may ask for,
 *   and what `start` needs before it settles the table
 * @param {number} config.maxPlayers  the most it allows: the size a lobby opens at, and the most the host may ask for
 * @param {number} [config.fillTo]  how many "fill with computer players" makes up to (default: a table of four, or the
 *   nearest this game allows)
 * @returns {object} the rules: newBot, addHuman, removeHuman, addBot, removeBot, fillWithBots, kick, setSize, sizeOf,
 *   lockSize
 */
export function createSeatRules({ isMidGame, botNames, takeOver, handOver, replacement, afterRemoval, finishedSeat = () => null, minPlayers, maxPlayers, fillTo = defaultPlayers(minPlayers, maxPlayers) }) {
  const rules = createMemberRules({
    layout: seatLayout,
    errors: SEAT_ERRORS,
    isLive: (room) => room.phase !== 'finished',
    isMidGame,
    minPlayers,
    maxPlayers,
    fillTo,
    botNames,
    takeOver,
    handOver,
    replacement,
    afterRemoval,
    guardFill: hostInLobby,
    // A seat keeps its number, so somebody who leaves a finished game leaves a marker in it rather than a hole: the
    // final scores still name them, and the table never has to cope with a gap.  That is a change worth sending.
    leaveFinished(room, slot, leaving) {
      seatLayout.put(room, slot, finishedSeat(leaving));
      return true;
    },
  });

  /**
   * The host puts a computer player in a seat (the first empty one if no seat is named).  Lobby only.
   *
   * This one stays a seated idea: there is no such thing as "that particular empty place" in a game with a list.
   *
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
    room.seats[index] = rules.newBot(room);
    return ok({ seat: index });
  }

  /**
   * The host takes a computer player out of a seat, leaving it empty.  Lobby only.
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (must be the host)
   * @param {string} slot  the slot holding the computer player ("s2")
   * @returns {{ ok: boolean, error?: string }} success, or why it failed
   * Side effects: sets `room.seats[seat]` to null.
   */
  function removeBot(room, userId, slot) {
    const problem = hostInLobby(room, userId);
    if (problem) return problem;
    if (!isBot(seatLayout.at(room, slot))) return fail('noBotInSeat');
    seatLayout.vacate(room, slot);
    return ok();
  }

  return { newBot: rules.newBot, addHuman: rules.addHuman, removeHuman: rules.removeHuman, addBot, removeBot, fillWithBots: rules.fillWithBots, kick: rules.kick, setSize: rules.setSize, sizeOf: rules.sizeOf, lockSize: rules.lockSize };
}
