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
import { rosterLayout, withSlot } from './layout.js';
import { asHost, createMemberRules, defaultPlayers, fail, freeName, isBot, isHuman, nextGame, ok } from './members.js';

export { barFromRoom, defaultPlayers, isBarred, isBot, isHuman, nextGame } from './members.js';
export { withSlot } from './layout.js';

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
 * The player with this id, or undefined.
 *
 * @param {{ players: object[] }} room  not changed
 * @param {number | string} id  an account id, or a computer player's ('bot:<n>')
 * @returns {any} the player object, or undefined when nobody in the room has that id
 * Side effects: none.
 */
export const playerOf = (room, id) => room.players.find((p) => p.id === id);

/**
 * A function giving a player's name: the name saved with them, else `nameOf` (only rooms saved long ago lack names,
 * and somebody who has left the room has no player to hold one).
 *
 * @param {{ players: object[] }} room  the room whose players are searched
 * @param {(id: any) => string} nameOf  the fallback lookup, such as the account's display name
 * @returns {(id: number | string) => string} the name lookup
 * Side effects: none.
 */
export const namer = (room, nameOf) => (id) => playerOf(room, id)?.name ?? nameOf(id);

/**
 * Moves one field of a saved object to the name it goes by now, if it is still under the old one.  For a `migrate`
 * that has renamed something a saved room still calls by its old word.
 *
 * @param {object | null | undefined} holder  the object to change (a room, or anything saved inside one)
 * @param {string} was  the old field name
 * @param {string} now  the name it has today
 * @returns {void}
 * Side effects: writes `now` and deletes `was`.  Running it twice changes nothing more, and an object that already
 * holds `now` keeps what is there.
 */
export function renameField(holder, was, now) {
  if (!holder || holder[was] === undefined) return;
  if (holder[now] === undefined) holder[now] = holder[was];
  delete holder[was];
}

/**
 * The people in the room (accounts), as opposed to computer players.
 *
 * @param {object} room
 * @returns {object[]} the player objects, in join order
 */
export const humans = (room) => room.players.filter(isHuman);

/**
 * The rules for a phase that waits for everybody to close the scores before the game moves on: each person says they
 * are ready (computer players always are), the last of them moves it on, and the server may move it on without them
 * after a wait.  `room.ready` holds the ids of the people who have said so.
 *
 * Whatever comes after the room in a call - the random source, the clock, a name lookup - is handed straight on to
 * `finish`, so each game keeps the arguments its own turn needs.
 *
 * @param {object} config
 * @param {(room: any, ...rest: any[]) => boolean} config.finish  ends the turn on show and starts the next, or
 *   finishes the game; answers whether the game is now over.  It is what empties `room.ready`.
 * @param {string} [config.phase]  the phase that waits (default 'reveal')
 * @returns {{ unready: (room: any) => any[], ready: (room: any, id: number | string, ...rest: any[]) => any,
 *   forceNext: (room: any, ...rest: any[]) => any, waitingForReady: (room: any) => boolean }}
 *   `unready(room)` is the people still to close the scores; `ready` and `forceNext` answer
 *   { ok: true, finished } or a refusal (`notInGame`, `noScoresToClose`, `nothingToMoveOn`)
 * Side effects: none here; `ready` adds to room.ready, and both it and `forceNext` may call `finish`.
 */
export function createReadyRules({ finish, phase = 'reveal' }) {
  const unready = (room) => humans(room).filter((p) => !(room.ready ?? []).includes(p.id));
  const waitingForReady = (room) => room.phase === phase;
  const ready = (room, id, ...rest) => {
    if (!hasPlayer(room, id)) return fail('notInGame');
    if (room.phase !== phase) return fail('noScoresToClose');
    if (!room.ready.includes(id)) room.ready.push(id);
    return ok({ finished: unready(room).length === 0 ? finish(room, ...rest) : false });
  };
  const forceNext = (room, ...rest) => {
    if (room.phase !== phase) return fail('nothingToMoveOn');
    return ok({ finished: finish(room, ...rest) });
  };
  return { unready, ready, forceNext, waitingForReady };
}

/** What a room keeps through "play again" whatever the game: who it is, who is in it, and the numbers handed out in it. */
const KEPT_THROUGH_REPLAY = ['code', 'hostId', 'players', 'size', 'nextBot', 'nextSlot', 'gameSeq', 'createdAt', 'updatedAt'];

/**
 * "Play again" for a game that keeps a list of players: the host sends a finished game back to the lobby, with the
 * same code, people, and settings, ready for the next game among them (see `nextGame`).
 *
 * The room is put back as a room just made would be, by copying a `blank` one over it, so that a field a game adds
 * later is reset without anybody remembering to.  What must survive is named instead: the game's settings, and
 * anything the socket layer gave the room when it was made.  Whatever the room holds that a blank one does not
 * (the players a vote barred, say) is left alone.
 *
 * @param {any} room  the room to change
 * @param {number | string} userId  who is asking (must be the host)
 * @param {object} options
 * @param {any} options.blank  a room as the game's `createRoom` makes it
 * @param {string[]} options.keep  the fields of the room that the next game keeps: its settings
 * @param {(player: any) => object} options.freshPlayer  what each player starts the next game with (the score, the
 *   counters, anything else the game keeps on them); their id, name, slot, and the rest are untouched
 * @returns {{ ok: boolean, error?: string }} ok, or `hostOnly` for anybody else, or `notOver` while a game is being
 *   played or the room is already in the lobby
 * Side effects: advances room.gameSeq, resets the room and every player, and takes each computer player's AI and
 *   the note of whose place it was holding off it: in the lobby a computer player holds a place for nobody, and a
 *   new AI is dealt at the next start.
 */
export function backToLobby(room, userId, { blank, keep, freshPlayer }) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (!['finished', 'abandoned'].includes(room.phase)) return fail('notOver');
  nextGame(room); // the game just played keeps its scoreboard; this is the next one
  const kept = new Set([...KEPT_THROUGH_REPLAY, ...keep]);
  for (const [key, value] of Object.entries(blank)) if (!kept.has(key)) room[key] = value;
  Object.assign(room, { phase: 'lobby', history: [], recorded: false });
  for (const player of room.players) {
    Object.assign(player, freshPlayer(player));
    delete player.ai;
    delete player.stoodInFor;
  }
  return ok();
}

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
 *   computer player's id in its own fields (whose turn it is, their clues or guesses, the ready list; never the
 *   scoreboard history, which is written by slot) and drops anything else that only a computer player has.  The default does nothing.
 * @param {(room: object, oldId: number | string, bot: object, rng: () => number, now: number) => void} [config.takeOver]  runs after a
 *   computer player has taken the place of a person who left a game under way: `bot` is already in the list where the
 *   person was, with their score, counters and colour but the new id and name.  The game gives it an AI, renames the
 *   person's id in its own fields (whose turn it is, their clues or guesses, the ready list; never the
 *   scoreboard history, which is written by slot) and moves on if the game was only waiting for that person.  The default does nothing.
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
   * Null if this person is the host and the game is still in the lobby, otherwise the failure to return.
   *
   * Which failure depends on what they were trying to do, because the codes are in four locale files and each one
   * names the thing refused: adding a computer player, or removing one.  (Changing how many players the game is for
   * is an ordinary lobby setting, and `setSize` answers with the codes every other setting answers with.)
   *
   * @param {object} room
   * @param {number} userId
   * @param {'add' | 'remove'} what
   * @returns {{ ok: false, error: string } | null}
   * Side effects: none.
   */
  function lobbyHostOnly(room, userId, what) {
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

  return { newBot: rules.newBot, addHuman: rules.addHuman, removeHuman: rules.removeHuman, addBot, removeBot, fillWithBots: rules.fillWithBots, kick: rules.kick, setSize: rules.setSize, sizeOf: rules.sizeOf, lockSize: rules.lockSize };
}
