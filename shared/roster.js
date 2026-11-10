// The lobby and leaving rules for games that keep a LIST of players instead of fixed seats (Just One, Wavelength,
// Tints and Hints, GTK, Trivium, Scribblers and Dixnt).  seats.js does the same job for games with numbered seats
// (Hearts, Cheat...); the two files speak the same vocabulary (addHuman, removeHuman, addBot, removeBot, fillWithBots, kick) so that shared/roomServer.js can drive
// either, and both hand a seat to a computer player when a person leaves a game that is under way, so that nobody's
// turns are lost.  Where the games differ is only how a room stores its people:
//
//   room.players[i]  a person { kind: 'human', id: <account id>, name } or a computer player
//                    { kind: 'bot', id: 'bot:<n>', name } (games add their own fields: score, colour, `ai`, counters...)
//                    in the order they joined.  There are no empty seats: the list grows in the lobby and only shrinks
//                    there; in a game a person who leaves is replaced, in place, by a computer player, and somebody
//                    arriving late takes a computer player's place the same way round.
//   room.hostId      the account id of the host
//   room.phase       'lobby' while people are arriving; anything else once the game has started
//   room.nextBot     the number the next computer player's id will use
//
// Every rule returns { ok: true, ... } or { ok: false, error } and (like all the rules) mutates the room it is given.
// This file imports only other shared files, because module tests copy `shared/*.js` flat into a temporary folder.
// Depends on: ./seats.js (bot names, host check, result helpers).
import { numberFrom } from './input.js';
import { rosterLayout, withSlot } from './layout.js';
import { asHost, createMemberRules, fail, freeName, hostInLobby, isBot, isHuman, ok } from './members.js';

export { barFromRoom, isBarred, isBot, isHuman, nextGame } from './members.js';
export { withSlot } from './layout.js';

/**
 * Renames one player's id wherever a room's scoreboard history refers to it (the `deltas` and `notes` of every round), so
 * that the totals still add up after a computer player has taken a person's place.  Games rename their own fields themselves.
 *
 * @param {{ history?: Array<{ deltas: object, notes: object }> }} room  the room to change
 * @param {number | string} oldId
 * @param {string} newId
 * @returns {void}
 * Side effects: mutates every round of `room.history`.
 */
/** The slot of whoever holds this id, or -1 if nobody does. */
export const slotOf = (room, id) => room.players.find((p) => p.id === id)?.slot ?? -1;

/**
 * The scoreboard's rounds as a view shows them: stored by slot, sent by id.
 *
 * The history is written by slot so that it never has to be rewritten, but the client has always been sent rounds
 * keyed by the player id it is drawing, and there is no reason to make sixteen clients learn a new word.  So the
 * translation happens here, in the one place, and the wire does not change at all.
 *
 * A slot whose player has gone — somebody who left a game that was already over, so no computer player stood in for
 * them — has no id to be sent under, and its entry is dropped.  That matches what the client did with such a row
 * before, which was to find no player for the id and leave it out of the table.
 *
 * @param {object} room  not changed
 * @returns {object[]} one entry per finished round, with `deltas` and `notes` keyed by player id
 * Side effects: none.
 */
export function historyView(room) {
  const idOf = new Map((room.players ?? []).map((p) => [p.slot, p.id]));
  const byId = (table) => Object.fromEntries(Object.entries(table ?? {}).flatMap(([slot, value]) => (idOf.has(slot) ? [[idOf.get(slot), value]] : [])));
  return (room.history ?? []).map((round) => ({ ...round, deltas: byId(round.deltas), notes: byId(round.notes) }));
}

export function renameInHistory(room, oldId, newId) {
  for (const round of room.history ?? []) {
    for (const table of [round.deltas, round.notes]) {
      if (table && Object.hasOwn(table, oldId)) {
        table[newId] = table[oldId];
        delete table[oldId];
      }
    }
  }
}

/**
 * The index of a person's place in the list, or -1 if they are not in the room.  (Games with a list have no fixed seats,
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
export const uniqueName = (room, wanted) => freeName(playerNames(room), wanted, (w, n) => `${w} (${n})`);

/** The names of everybody in the room (a person saved before names were kept may have none). */
const playerNames = (room) => room.players.filter((p) => typeof p.name === 'string').map((p) => p.name);

/**
 * Brings the player list of a SAVED room up to date, so that rooms written before the move to this file still load:
 * a player with `bot: true` becomes `kind: 'bot'`, every other one `kind: 'human'`, and a person who was saved without a
 * name (names used to be looked up from the account each time) is given one by `nameOf` if it can.
 *
 * Side effects: mutates every player of the room, and sets room.nextBot if it was missing.  Running it again changes nothing.
 *
 * @param {object} room
 * @param {(id: number) => (string | undefined)} [nameOf]  looks up an account's display name
 * @param {{ maxPlayers?: number }} [limits]  the game's limits, so a room saved before the host could choose how many
 *   players it is for is given the number it already had (see migrateSize)
 * @returns {object} the same room
 */
export function migratePlayers(room, nameOf = () => undefined, limits = {}) {
  room.nextBot ??= 1;
  for (const player of room.players ?? []) {
    if (player.kind !== 'human' && player.kind !== 'bot') player.kind = player.bot === true ? 'bot' : 'human';
    delete player.bot;
    if (player.kind === 'human' && typeof player.name !== 'string') {
      const name = nameOf(player.id);
      if (typeof name === 'string') player.name = name;
    }
  }
  migrateSlots(room);
  migrateSize(room, limits);
  return room;
}

/**
 * Gives a saved room the number of players it is for, which it always had — it just was not written down.
 *
 * A game that has started, or is over, had exactly as many players as are in its list: that is the number it was
 * played with, and a finished game's scoreboard then draws exactly as it always did.  A lobby is the one place where
 * that is the wrong answer, because people may still have been arriving: it keeps the whole game's worth of room it
 * had before, so nobody who could have joined it yesterday is turned away today.
 *
 * @param {object} room  the room to change
 * @param {{ maxPlayers?: number }} [limits]  the game's limits; without them nothing is done
 * @returns {void}
 * Side effects: sets `room.size` when it is missing.
 */
function migrateSize(room, { maxPlayers } = {}) {
  if (Number.isInteger(room.size) || !Number.isInteger(maxPlayers)) return;
  room.size = room.phase === 'lobby' ? maxPlayers : (room.players ?? []).length;
}

/**
 * Gives a saved room its slots, and rewrites a history that was written before they existed.
 *
 * A room saved by an older version keys its history by player id.  Here each player takes its place in the list as
 * its slot, and every round's `deltas` and `notes` are rewritten to match.  A player missing a slot is the marker,
 * so running this twice changes nothing — which matters, because the games assert that a saved room loads as it was.
 *
 * @param {object} room  the room to change
 * @returns {void}
 * Side effects: sets `slot` on every player, sets `room.nextSlot`, and rewrites the keys of every round of history.
 */
function migrateSlots(room) {
  const players = room.players ?? [];
  const hasSlot = (p) => typeof p.slot === 'string';
  if (players.some(hasSlot)) {
    // Some already have one, so this room's history is written by slot: leave those alone (renumbering them would
    // orphan the history that names them) and only hand one to anybody who somehow has none.
    room.nextSlot ??= players.reduce((next, p) => Math.max(next, Number(String(p.slot).slice(1)) + 1 || 0), 0);
    for (const player of players) if (!hasSlot(player)) withSlot(room, player);
    return;
  }
  if (!players.length) {
    room.nextSlot ??= 0;
    return;
  }
  const slotOfId = new Map();
  players.forEach((player, index) => {
    player.slot = `s${index}`;
    slotOfId.set(player.id, player.slot);
  });
  room.nextSlot = players.length;
  const bySlot = (table) => Object.fromEntries(Object.entries(table ?? {}).map(([id, value]) => [slotOfId.get(id) ?? slotOfId.get(Number(id)) ?? id, value]));
  for (const round of room.history ?? []) {
    round.deltas = bySlot(round.deltas);
    round.notes = bySlot(round.notes);
  }
}

/**
 * How many players "fill with computer players" makes up to: a comfortable table of four, or the nearest a game that
 * cannot hold four allows.  It is a quick start — most games are played by about four, whatever the most they allow
 * is — and not "as many as will fit", which in a game for twelve would be a surprise.
 *
 * @param {number} min  the fewest the game can be played with
 * @param {number} max  the most
 * @returns {number}
 */
export const defaultPlayers = (min, max) => Math.min(max, Math.max(min, 4));

/** The codes this family's clients already know.  The two families never used the same ones. */
const ROSTER_ERRORS = {
  barred: 'removedFromGame',
  full: 'gameFull',
  started: 'thatGameStarted',
  notInGame: 'notInGame',
  kickNotHost: 'hostOnlyRemove',
  kickTarget: 'playerNotInGame',
  gameOver: 'gameOverNobodyToRemove',
};

/**
 * Builds a list-game's lobby rules.
 *
 * Joining, leaving, being replaced and being put out are shared/members.js; what is below is what only a game with a
 * list of players has: a size the host may choose, and computer players that are appended rather than seated.
 *
 * @param {object} config
 * @param {(room: object) => boolean} config.isLive  true until the game is over (the lobby counts as live): leaving or
 *   removing someone from a room that is not live changes nothing
 * @param {number} config.minPlayers  how many players a game needs to start
 * @param {number} config.maxPlayers  how many players a room can hold
 * @param {number} [config.fillTo]  how many "fill with computer players" makes up to (default: a table of four)
 * @param {string[]} [config.botNames]  the names computer players get (default DEFAULT_BOT_NAMES)
 * @param {(room: object, base: { kind: string, id: number | string, name?: string }, extras?: object) => object} config.makePlayer
 *   turns the bare player into the game's own shape (adds the score, the counters, a marker colour...). `extras` is whatever
 *   the server passed for a person joining (for example their preferred colour); it is undefined for a computer player.
 *   It may read the room (to pick a colour nobody has) but must not add the player to it.
 * @param {(room: object, botId: string, person: object) => void} [config.handOver]  the mirror of takeOver: runs after
 *   somebody joining a game under way has taken a computer player's place.  `person` is already in the list where the
 *   computer player was, with its score, counters and colour but the joiner's id and name.  The game renames the
 *   computer player's id in its own fields (whose turn it is, their clues or guesses, the ready list; renameInHistory
 *   does the scoreboard history) and drops anything else that only a computer player has.  The default does nothing.
 * @param {(room: object, oldId: number | string, bot: object, rng: () => number, now: number) => void} [config.takeOver]  runs after a
 *   computer player has taken the place of a person who left a game under way: `bot` is already in the list where the
 *   person was, with their score, counters and colour but the new id and name.  The game gives it an AI, renames the
 *   person's id in its own fields (whose turn it is, their clues or guesses, the ready list; renameInHistory does the
 *   scoreboard history) and moves on if the game was only waiting for that person.  The default does nothing.
 * @returns {object} the rules: newBot, addHuman, removeHuman, addBot, removeBot, fillWithBots, kick, setSize, sizeOf, lockSize
 */
export function createRosterRules({ isLive, minPlayers, maxPlayers, fillTo = defaultPlayers(minPlayers, maxPlayers), botNames, makePlayer, takeOver, handOver }) {
  const rules = createMemberRules({
    layout: rosterLayout,
    errors: ROSTER_ERRORS,
    isLive,
    // A list has no seats to sit in, so "a game is under way" is simply "it has started and is not over".
    isMidGame: (room) => isLive(room) && room.phase !== 'lobby',
    minPlayers,
    maxPlayers,
    fillTo,
    botNames,
    makePlayer,
    takeOver,
    handOver,
    guardFill: (room, userId) => lobbyHostOnly(room, userId, 'add'),
    // Somebody who leaves a game that is over simply stays on the final standings, so nothing happened.
    leaveFinished: () => false,
  });

  /**
   * The most people this game will hold.  A room opens as big as the game allows, so nobody is turned away who could
   * have joined before; a host who wants to keep it smaller says so, and starting settles it for good.
   * @param {object} room  not changed
   * @returns {number}
   */
  const sizeOf = (room) => rules.capacity(room);

  /**
   * Null if this person is the host and the game is still in the lobby, otherwise the failure to return.
   *
   * Which failure depends on what they were trying to do, because the codes are in four locale files and each one
   * names the thing refused: adding a computer player, removing one, or changing how many players the game is for.
   * The last of those is an ordinary lobby setting, so it answers with the codes every other setting answers with.
   *
   * @param {object} room
   * @param {number} userId
   * @param {'add' | 'remove' | 'size'} what
   * @returns {{ ok: false, error: string } | null}
   * Side effects: none.
   */
  function lobbyHostOnly(room, userId, what) {
    if (what === 'size') return hostInLobby(room, userId);
    if (userId !== room.hostId) return fail(what === 'add' ? 'hostOnlyAddBots' : 'hostOnlyRemoveBots');
    if (room.phase !== 'lobby') return fail(what === 'add' ? 'botsLobbyOnly' : 'botsRemoveLobbyOnly');
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
    if (rules.isFull(room)) return fail('gameFull');
    const bot = rules.newBot(room);
    room.players.push(bot);
    return ok({ id: bot.id });
  }

  /**
   * Starting settles how many are playing: the room becomes exactly as big as the people and computer players in it.
   * A host who wants a place kept open for a friend fills it with a computer player first, and the friend takes it
   * over when they arrive.
   *
   * @param {object} room  the room to change
   * @returns {void}
   * Side effects: sets `room.size`.
   */
  function lockSize(room) {
    room.size = room.players.length;
  }

  /**
   * The host chooses how many players the game is for.  Lobby only, within the game's limits, and never fewer than are
   * already here (the host takes somebody out first).
   *
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (must be the host)
   * @param {number} size  how many players the game is for
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: sets `room.size` on success; nothing on failure.
   */
  function setSize(room, userId, size) {
    const problem = lobbyHostOnly(room, userId, 'size');
    if (problem) return problem;
    const wanted = Math.round(numberFrom(size));
    if (!Number.isInteger(wanted) || wanted < minPlayers || wanted > maxPlayers) return fail('playersRange', { min: minPlayers, max: maxPlayers });
    if (room.players.length > wanted) return fail('removeBeforeFewerPlayers');
    room.size = wanted;
    return ok();
  }

  /**
   * The host removes a computer player, in the lobby only: once the game is under way every player's turns are part of
   * the game, so a computer player stays (as in the seated games).
   *
   * @param {object} room
   * @param {number} userId
   * @param {string} slot  the slot the computer player holds ("s2")
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: splices room.players.
   */
  function removeBot(room, userId, slot) {
    const problem = asHost(room, userId);
    if (problem) return fail('hostOnlyRemoveBots');
    const index = rosterLayout.indexOf(room, slot);
    if (index === -1 || !isBot(room.players[index])) return fail('notAComputer');
    if (!isLive(room)) return fail('gameOverNobodyToRemove');
    const refused = lobbyHostOnly(room, userId, 'remove');
    if (refused) return refused;
    room.players.splice(index, 1);
    return ok();
  }

  return { newBot: rules.newBot, addHuman: rules.addHuman, removeHuman: rules.removeHuman, addBot, removeBot, fillWithBots: rules.fillWithBots, kick: rules.kick, setSize, sizeOf, lockSize };
}
