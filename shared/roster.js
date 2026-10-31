// The lobby and leaving rules for games that keep a LIST of players instead of fixed seats: Just One, Wavelength and
// Tints and Hints. seats.js does the same job for games with numbered seats (Hearts, Cheat...); the two files speak the
// same vocabulary (addHuman, removeHuman, addBot, removeBot, fillWithBots, kick) so that shared/roomServer.js can drive
// either. Where the games differ is only how a room stores its people:
//
//   room.players[i]  a person { kind: 'human', id: <account id>, name } or a computer player
//                    { kind: 'bot', id: 'bot:<n>', name } (games add their own fields: score, colour, `ai`, counters...)
//                    in the order they joined. There are no empty seats: the list just grows and shrinks.
//   room.hostId      the account id of the host
//   room.phase       'lobby' while people are arriving; anything else once the game has started
//   room.nextBot     the number the next computer player's id will use
//
// Every rule returns { ok: true, ... } or { ok: false, error } and (like all the rules) mutates the room it is given.
// This file imports only other shared files, because module tests copy `shared/*.js` flat into a temporary folder.
import { DEFAULT_BOT_NAMES, asHost, fail, isBot, isHuman, ok } from './seats.js';

export { isBot, isHuman };

/**
 * The index of a person's place in the list, or -1 if they are not in the room. (Games with a list have no fixed seats,
 * so this is only "where do they appear in the join order"; it exists so roomServer's `act` can tell members from strangers.)
 *
 * @param {object} room
 * @param {number | string} id  an account id (or a computer player's id)
 * @returns {number}
 */
export const seatOf = (room, id) => room.players.findIndex((p) => p.id === id);

/**
 * Is this id somebody in the room (a person or a computer player)?
 *
 * @param {object} room
 * @param {number | string} id
 * @returns {boolean}
 */
export const hasPlayer = (room, id) => seatOf(room, id) !== -1;

/**
 * The people in the room (accounts), as opposed to computer players.
 *
 * @param {object} room
 * @returns {object[]} the player objects, in join order
 */
export const humans = (room) => room.players.filter(isHuman);

/**
 * A name nobody else in the room has (ignoring capital letters): "Ann" becomes "Ann (2)" if "ann" is taken.
 *
 * @param {object} room
 * @param {string} wanted  the name the person would like
 * @returns {string}
 */
export function uniqueName(room, wanted) {
  const used = new Set(room.players.filter((p) => typeof p.name === 'string').map((p) => p.name.toLowerCase()));
  let name = wanted;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${wanted} (${n})`;
  return name;
}

/**
 * Brings the player list of a SAVED room up to date, so that rooms written before the move to this file still load:
 * a player with `bot: true` becomes `kind: 'bot'`, every other one `kind: 'human'`, and a person who was saved without a
 * name (names used to be looked up from the account each time) is given one by `nameOf` if it can.
 *
 * Side effects: mutates every player of the room, and sets room.nextBot if it was missing. Running it again changes nothing.
 *
 * @param {object} room
 * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
 * @returns {object} the same room
 */
export function migratePlayers(room, nameOf = () => undefined) {
  room.nextBot ??= 1;
  for (const player of room.players ?? []) {
    if (player.kind !== 'human' && player.kind !== 'bot') player.kind = player.bot === true ? 'bot' : 'human';
    delete player.bot;
    if (player.kind === 'human' && typeof player.name !== 'string') {
      const name = nameOf(player.id);
      if (typeof name === 'string') player.name = name;
    }
  }
  return room;
}

/**
 * Builds a list-game's lobby rules.
 *
 * @param {object} config
 * @param {(room: object) => boolean} config.isLive  true until the game is over (the lobby counts as live): leaving or
 *   removing someone from a room that is not live changes nothing
 * @param {number} config.minPlayers  how many players a game needs (fewer left in a started game means it is abandoned)
 * @param {number} config.maxPlayers  how many players a room can hold
 * @param {string[]} [config.botNames]  the names computer players get (default DEFAULT_BOT_NAMES)
 * @param {(room: object, base: { kind: string, id: number | string, name?: string }, extras?: object) => object} config.makePlayer
 *   turns the bare player into the game's own shape (adds the score, the counters, a marker colour...). `extras` is whatever
 *   the server passed for a person joining (for example their preferred colour); it is undefined for a computer player.
 *   It may read the room (to pick a colour nobody has) but must not add the player to it.
 * @param {(room: object, left: { id: number | string, index: number }, rng: () => number) => object} [config.afterRemoval]
 *   runs after somebody has been taken out of a game that is under way, at least one person remains, and the host has
 *   already been handed on. It does the game's own tidying (their clues, their turn...) and returns what happened as
 *   { abandoned?, finished? }. The default does nothing.
 * @returns {object} the rules: newBot, addHuman, removeHuman, addBot, removeBot, fillWithBots, kick
 */
export function createRosterRules({ isLive, minPlayers, maxPlayers, botNames = DEFAULT_BOT_NAMES, makePlayer, afterRemoval = () => ({}) }) {
  /**
   * Makes the next computer player: the first unused name from the list, then "Computer", numbered if it clashes.
   *
   * Side effect: uses up one number from room.nextBot (and creates it if a saved room lacked it).
   *
   * @param {object} room
   * @returns {object} the new player (not yet in room.players)
   */
  function newBot(room) {
    const used = new Set(room.players.filter((p) => typeof p.name === 'string').map((p) => p.name));
    const base = botNames.find((n) => !used.has(n)) ?? 'Computer';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
    room.nextBot ??= 1;
    return makePlayer(room, { kind: 'bot', id: `bot:${room.nextBot++}`, name });
  }

  /**
   * Adds a person to the end of the list. Joining twice is harmless, and the game must still be in the lobby for a newcomer.
   *
   * Side effect: pushes the new player onto room.players.
   *
   * @param {object} room
   * @param {number} userId
   * @param {string} [name]    the account's display name (made unique among the players); left off if not given
   * @param {object} [extras]  whatever the server knows about them that the game needs, handed to makePlayer
   * @returns {{ ok: boolean, seat?: number, error?: string }} `seat` is their place in the join order
   */
  function addHuman(room, userId, name, extras = {}) {
    if (hasPlayer(room, userId)) return ok({ seat: seatOf(room, userId) });
    if (room.phase !== 'lobby') return fail('That game has already started.');
    if (room.players.length >= maxPlayers) return fail('That game is full.');
    const base = { kind: 'human', id: userId };
    if (typeof name === 'string') base.name = uniqueName(room, name);
    room.players.push(makePlayer(room, base, extras));
    return ok({ seat: room.players.length - 1 });
  }

  /**
   * Takes somebody (a person or a computer player) out of the list, whoever asked. A game that is over is left alone.
   * If they were the host the next person becomes host. Anything game-specific happens in config.afterRemoval.
   *
   * Side effects: splices room.players, may change room.hostId and whatever afterRemoval changes.
   *
   * @param {object} room
   * @param {number | string} id
   * @param {() => number} rng
   * @returns {{ ok: boolean, empty?: boolean, abandoned?: boolean, finished?: boolean, error?: string }} `empty` is true when
   *   no person is left, so the caller should discard the room
   */
  function takeOut(room, id, rng) {
    const index = seatOf(room, id);
    if (index === -1) return fail('You are not in this game.');
    const quiet = { empty: false, abandoned: false, finished: false };
    if (!isLive(room)) return ok(quiet);
    room.players.splice(index, 1);
    const people = humans(room);
    if (!people.length) return ok({ ...quiet, empty: true });
    if (room.hostId === id) room.hostId = people[0].id;
    if (room.phase === 'lobby') return ok(quiet);
    return ok({ ...quiet, ...afterRemoval(room, { id, index }, rng) });
  }

  /**
   * A person leaves (or is removed by the host). In the lobby they simply go; in a game the game's own afterRemoval decides
   * what happens next (the turn moves on, or the game is abandoned if too few are left). After a game ends nothing changes.
   *
   * @param {object} room
   * @param {number} userId
   * @param {() => number} [rng]
   * @returns {{ ok: boolean, empty?: boolean, abandoned?: boolean, finished?: boolean, error?: string }}
   */
  function removeHuman(room, userId, rng = Math.random) {
    if (!isHuman(room.players[seatOf(room, userId)])) return fail('You are not in this game.');
    return takeOut(room, userId, rng);
  }

  /**
   * Null if this person is the host and the game is still in the lobby, otherwise the failure to return.
   *
   * @param {object} room
   * @param {number} userId
   * @param {'add' | 'remove'} what
   * @returns {{ ok: false, error: string } | null}
   */
  function lobbyHostOnly(room, userId, what) {
    if (userId !== room.hostId) return fail(`Only the host can ${what} computer players.`);
    if (room.phase !== 'lobby') return fail(`Computer players can only be ${what === 'add' ? 'added' : 'removed'} in the lobby.`);
    return null;
  }

  /**
   * The host adds one computer player to the lobby.
   *
   * Side effect: pushes the computer player onto room.players.
   *
   * @param {object} room
   * @param {number} userId
   * @returns {{ ok: boolean, id?: string, error?: string }} `id` is the new computer player's id
   */
  function addBot(room, userId) {
    const refused = lobbyHostOnly(room, userId, 'add');
    if (refused) return refused;
    if (room.players.length >= maxPlayers) return fail('That game is full.');
    const bot = newBot(room);
    room.players.push(bot);
    return ok({ id: bot.id });
  }

  /**
   * The host fills the lobby with computer players until there are `target` players (default: enough to start).
   *
   * Side effect: pushes computer players onto room.players.
   *
   * @param {object} room
   * @param {number} userId
   * @param {number} [target]  how many players the room should have; kept between minPlayers and maxPlayers
   * @returns {{ ok: boolean, error?: string }}
   */
  function fillWithBots(room, userId, target = minPlayers) {
    const refused = lobbyHostOnly(room, userId, 'add');
    if (refused) return refused;
    const wanted = Math.min(maxPlayers, Math.max(minPlayers, Math.round(Number(target)) || minPlayers));
    while (room.players.length < wanted) room.players.push(newBot(room));
    return ok();
  }

  /**
   * The host removes a computer player. In the lobby it just goes; in a game under way the game carries on with fewer
   * players (see config.afterRemoval). A game that is over has nobody to remove.
   *
   * @param {object} room
   * @param {number} userId
   * @param {string} botId  the computer player's id ('bot:<n>')
   * @param {() => number} [rng]
   * @returns {{ ok: boolean, empty?: boolean, abandoned?: boolean, finished?: boolean, error?: string }}
   */
  function removeBot(room, userId, botId, rng = Math.random) {
    const problem = asHost(room, userId);
    if (problem) return fail('Only the host can remove computer players.');
    if (!isBot(room.players[seatOf(room, botId)])) return fail('That is not a computer player.');
    if (!isLive(room)) return fail('The game is over: there is nobody to remove.');
    return takeOut(room, botId, rng);
  }

  /**
   * The host removes another person, at any time before the game is over: in the lobby they go, and in a game the game
   * carries on without them (as when someone leaves). A finished game has nobody to remove. The result names the person
   * so the server can send them home.
   *
   * @param {object} room
   * @param {number} hostId
   * @param {number} targetId  the account id of the person to remove
   * @param {() => number} [rng]
   * @returns {{ ok: boolean, userId?: number, abandoned?: boolean, finished?: boolean, error?: string }}
   */
  function kick(room, hostId, targetId, rng = Math.random) {
    if (hostId !== room.hostId) return fail('Only the host can remove players.');
    const target = room.players.find((p) => p.id === targetId);
    if (!isHuman(target) || target.id === hostId) return fail('That player is not in the game.');
    if (!isLive(room)) return fail('The game is over: there is nobody to remove.');
    const removed = takeOut(room, target.id, rng);
    return removed.ok ? ok({ userId: target.id, abandoned: removed.abandoned, finished: removed.finished }) : removed;
  }

  return { newBot, addHuman, removeHuman, addBot, removeBot, fillWithBots, kick };
}
