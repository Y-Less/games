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
import { DEFAULT_BOT_NAMES, asHost, barFromRoom, fail, freeName, isBarred, isBot, isHuman, nextBotName, ok } from './seats.js';

export { barFromRoom, isBarred, isBot, isHuman };

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
/**
 * Gives a new player its slot: the name the scoreboard's history calls them by, for as long as this game lasts.
 *
 * A player's place in `room.players` is not an identity — `removeBot` splices the list in the lobby, which renumbers
 * everybody after it — and nor is their id, because a person who leaves a game under way is replaced by a computer
 * player with a new one.  The slot is neither: it is handed out once, here, and it travels with the place through
 * every replacement, because both of those paths build the new member by spreading the old one.  That is what lets
 * the history be written once and never touched again.
 *
 * It is "s0", "s1", … rather than 0, 1, … on purpose.  Account ids are small numbers too, so a numeric slot and an id
 * are indistinguishable once either is a key of an object, and reading a history by the wrong one quietly finds the
 * wrong player's points instead of finding nothing.  Two bugs were written that way while this change was being made
 * — one of them in code, not just a test — and both would have been loud with a key that cannot be mistaken.
 *
 * @param {object} room    the room, whose counter is used up
 * @param {object} player  the player to give a slot to
 * @returns {object} the same player
 * Side effects: sets `player.slot` and advances `room.nextSlot`.
 */
export function withSlot(room, player) {
  room.nextSlot ??= 0;
  player.slot = `s${room.nextSlot++}`;
  return player;
}

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
  migrateSlots(room);
  return room;
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
 * Builds a list-game's lobby rules.
 *
 * @param {object} config
 * @param {(room: object) => boolean} config.isLive  true until the game is over (the lobby counts as live): leaving or
 *   removing someone from a room that is not live changes nothing
 * @param {number} config.minPlayers  how many players a game needs to start
 * @param {number} config.maxPlayers  how many players a room can hold
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
 * @returns {object} the rules: newBot, addHuman, removeHuman, addBot, removeBot, fillWithBots, kick
 */
export function createRosterRules({ isLive, minPlayers, maxPlayers, botNames = DEFAULT_BOT_NAMES, makePlayer, takeOver = () => {}, handOver = () => {} }) {
  /**
   * Makes the next computer player: the first unused name from the list, then "Computer", numbered if it clashes.
   *
   * Side effect: uses up one number from room.nextBot (and creates it if a saved room lacked it).
   *
   * @param {object} room
   * @returns {object} the new player (not yet in room.players)
   */
  function newBot(room) {
    room.nextBot ??= 1;
    return withSlot(room, makePlayer(room, { kind: 'bot', id: `bot:${room.nextBot++}`, name: nextBotName(playerNames(room), botNames) }));
  }

  /**
   * Adds a person to the end of the list.  Joining twice is harmless, and the game must still be in the lobby for a newcomer.
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
    if (isBarred(room, userId)) return fail('removedFromGame');
    if (hasPlayer(room, userId)) return ok({ seat: seatOf(room, userId) });
    if (room.phase !== 'lobby') return sitInForBot(room, userId, name);
    if (room.players.length >= maxPlayers) return fail('gameFull');
    const base = { kind: 'human', id: userId };
    if (typeof name === 'string') base.name = uniqueName(room, name);
    room.players.push(withSlot(room, makePlayer(room, base, extras)));
    return ok({ seat: room.players.length - 1 });
  }

  /**
   * Somebody arriving at a game already under way — a friend who was slow to open the invitation — takes the place of
   * the first computer player in the list: its score, its counters, its colour, everything but its name and the AI
   * that was playing it.  It is the mirror of what happens when a person leaves, and it is why an invitation is still
   * worth following after the first round has started.
   *
   * There is nothing to take over once the game is over (the caller says so instead), nor when every place already
   * holds a person, which is as full as a game can be.
   *
   * @param {object} room  the room to change
   * @param {number} userId  the joining account id
   * @param {string} [name]  the account's display name (made unique among the players)
   * @returns {{ ok: boolean, seat?: number, tookOver?: string, error?: string }} their place in the list and the name
   *   of the computer player that held it, or why nothing could be taken
   * Side effects: replaces one entry of room.players, and whatever `handOver` changes.
   */
  function sitInForBot(room, userId, name) {
    if (!isLive(room)) return fail('thatGameStarted');
    const index = placeToTake(room, userId);
    if (index === -1) return fail('gameFull');
    const bot = room.players[index];
    const person = { ...bot, kind: 'human', id: userId };
    delete person.ai; // the AI stops here: from now on the place plays for itself
    delete person.stoodInFor; // and it is nobody's stand-in: the person it was waiting for is standing in it
    delete person.name; // out of the way, so the newcomer may use the name the computer player was going by
    room.players[index] = person;
    if (typeof name === 'string') person.name = uniqueName(room, name);
    else person.name = bot.name;
    handOver(room, bot.id, person);
    return ok({ seat: index, tookOver: bot.name });
  }

  /**
   * The place a newcomer takes over.  Their own comes first: if the computer player keeping their place warm is still
   * there, somebody coming back after a dropped connection carries on where they left off, with their own score and
   * colour.  Failing that it is a place that is nobody's stand-in — one the host filled — so that the others who might
   * yet come back keep theirs.  Failing that, the first computer player in the list.
   *
   * @param {object} room  not changed
   * @param {number} userId  the account arriving
   * @returns {number} the index in the list, or -1 when every place holds a person
   * Side effects: none.
   */
  function placeToTake(room, userId) {
    const bots = room.players.flatMap((p, i) => (isBot(p) ? [i] : []));
    return bots.find((i) => room.players[i].stoodInFor === userId) ?? bots.find((i) => room.players[i].stoodInFor === undefined) ?? bots[0] ?? -1;
  }

  /**
   * Takes a person out of the list, whoever asked.  In the lobby they simply go.  In a game that is under way a computer
   * player takes their place (same slot, same score; see config.takeOver), so no turn is lost.  A game that is over is left
   * alone (they stay on the final standings) and the result says `changed: false`, so the room server does not treat it as
   * a change.  If they were the host the next person becomes host.
   *
   * Side effects: splices or replaces an entry of room.players, may change room.hostId and whatever takeOver changes.
   *
   * @param {object} room
   * @param {number} id  the account id
   * @param {() => number} rng
   * @param {number} [now]  the clock, for games whose rules start a timer when somebody is replaced
   * @returns {{ ok: boolean, empty?: boolean, replaced?: boolean, changed?: boolean, error?: string }} `empty` is true
   *   when no person is left, so the caller should discard the room; `replaced` says a computer player took their place;
   *   `changed: false` means nothing happened
   */
  function takeOut(room, id, rng, now = 0) {
    const index = seatOf(room, id);
    if (index === -1) return fail('notInGame');
    if (!isLive(room)) return ok({ empty: false, replaced: false, changed: false });
    let replaced = false;
    if (room.phase === 'lobby') room.players.splice(index, 1);
    else {
      const leaving = room.players[index];
      const { id: botId, name } = newBot(room); // just for the id and the name: the player keeps everything else
      // The computer player remembers whose place it is keeping warm, so that they get it back if they come back.
      room.players[index] = { ...leaving, kind: 'bot', id: botId, name, stoodInFor: id };
      takeOver(room, id, room.players[index], rng, now);
      replaced = true;
    }
    const people = humans(room);
    if (!people.length) return ok({ empty: true, replaced });
    if (room.hostId === id) room.hostId = people[0].id;
    return ok({ empty: false, replaced });
  }

  /**
   * A person leaves (or is removed by the host).  In the lobby they simply go; in a game a computer player takes their
   * place; after a game ends nothing changes (`changed: false`).
   *
   * @param {object} room
   * @param {number} userId
   * @param {() => number} rng
   * @returns {{ ok: boolean, empty?: boolean, replaced?: boolean, changed?: boolean, error?: string }}
   * Side effects: as takeOut.
   */
  function removeHuman(room, userId, rng, now = 0) {
    if (!isHuman(room.players[seatOf(room, userId)])) return fail('notInGame');
    return takeOut(room, userId, rng, now);
  }

  /**
   * Null if this person is the host and the game is still in the lobby, otherwise the failure to return.
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
    if (room.players.length >= maxPlayers) return fail('gameFull');
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
    const wanted = Math.min(maxPlayers, Math.max(minPlayers, Math.round(numberFrom(target)) || minPlayers));
    while (room.players.length < wanted) room.players.push(newBot(room));
    return ok();
  }

  /**
   * The host removes a computer player, in the lobby only: once the game is under way every player's turns are part of
   * the game, so a computer player stays (as in the seated games).
   *
   * @param {object} room
   * @param {number} userId
   * @param {string} botId  the computer player's id ('bot:<n>')
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: splices room.players.
   */
  function removeBot(room, userId, botId) {
    const problem = asHost(room, userId);
    if (problem) return fail('hostOnlyRemoveBots');
    const index = seatOf(room, botId);
    if (!isBot(room.players[index])) return fail('notAComputer');
    if (!isLive(room)) return fail('gameOverNobodyToRemove');
    const refused = lobbyHostOnly(room, userId, 'remove');
    if (refused) return refused;
    room.players.splice(index, 1);
    return ok();
  }

  /**
   * The host removes another person, at any time before the game is over: in the lobby they go, and in a game a computer
   * player takes their place (as when someone leaves).  A finished game has nobody to remove.  The result names the person
   * so the server can send them home.
   *
   * @param {object} room
   * @param {number} hostId
   * @param {number} targetId  the account id of the person to remove
   * @param {() => number} rng
   * @param {number} [now]  the clock, passed on to the game's takeOver
   * @returns {{ ok: boolean, userId?: number, replaced?: boolean, error?: string }}
   * Side effects: as takeOut.
   */
  function kick(room, hostId, targetId, rng, now = 0) {
    if (hostId !== room.hostId) return fail('hostOnlyRemove');
    const target = room.players.find((p) => p.id === targetId);
    if (!isHuman(target) || target.id === hostId) return fail('playerNotInGame');
    if (!isLive(room)) return fail('gameOverNobodyToRemove');
    const removed = takeOut(room, target.id, rng, now);
    if (!removed.ok) return removed;
    barFromRoom(room, target.id); // put out by somebody else, so the invitation does not let them back in
    return ok({ userId: target.id, replaced: removed.replaced });
  }

  return { newBot, addHuman, removeHuman, addBot, removeBot, fillWithBots, kick };
}
