// Who is in a room, and what happens when that changes — written once, for both families of game.
//
// Games with numbered seats and games with a list of players had separate implementations of the same story, and the
// two drifted: the same ideas under different names, and a couple of real differences buried among the accidental
// ones.  The story itself is pinned by shared/members.test.js, and this is the single telling of it.  What the two
// families genuinely disagree about is how a place is addressed and what an empty one is, and that lives in
// shared/layout.js; what each *game* disagrees about it says in the hooks below.
//
// Every rule returns { ok: true, ... } or { ok: false, error }, and (like all the rules) mutates the room it is given.
// A place is named from outside by its slot ("s0", "s1"); see shared/layout.js.
//
// Depends on: shared/layout.js, shared/input.js.  shared/seats.js and shared/roster.js are the two families' front
// doors onto this file, and re-export the small helpers below so that sixteen games' imports did not have to move.
import { numberFrom } from './input.js';

/** Names computer players are given, in order, until they run out (then "Computer", "Computer 2", ...). */
export const DEFAULT_BOT_NAMES = ['Hazel', 'Otis', 'Mabel', 'Felix', 'Ivy', 'Rufus', 'Nell', 'Boris', 'Pearl', 'Hugo'];

/**
 * A failed rule.
 *
 * `error` is a code: a key under `errors.` in the game's or the site's locale file (src/locales/en.json), which the
 * client puts into words; `params` are the values the words need.  See shared/messages.js.
 *
 * @param {string} error  the code
 * @param {object} [params]  the values its words need
 * @returns {{ ok: false, error: string, params?: object }}
 */
export const fail = (error, params) => (params ? { ok: false, error, params } : { ok: false, error });

/**
 * A successful rule, with any extra facts about what happened.
 * @param {object} [extra]
 * @returns {{ ok: true } & Record<string, any>}
 */
export const ok = (extra = {}) => ({ ok: true, ...extra });

// These two say what they prove, not just what they answer: a person's id is an account id, which is a number, while a
// computer player's is the string "bot:<n>".  Saying so here is what lets the places that read an id off a member — the
// scoreboard, `online(id)` — know which of the two they are holding, instead of each one deciding for itself.

/**
 * Is this place held by a person?  (An empty seat is null, so this is false for it.)
 * @template T
 * @param {T} member
 * @returns {member is T & { kind: 'human', id: number }}
 */
export const isHuman = (member) => /** @type {any} */ (member)?.kind === 'human';

/**
 * Is this place held by a computer player?
 * @template T
 * @param {T} member
 * @returns {member is T & { kind: 'bot', id: string }}
 */
export const isBot = (member) => /** @type {any} */ (member)?.kind === 'bot';

/**
 * Shuts somebody out of a room for good.  Being put out by other people is not the same as leaving: the invitation
 * must not let them straight back in to take a computer player's place.  The computer player keeping their place warm
 * stops keeping it for them, so that somebody who can actually come back may have it.
 *
 * Both kinds of room are handled, so a game with removal rules of its own can use it as well.
 *
 * @param {{ barred?: number[], seats?: Array<object|null>, players?: object[] }} room  the room to change
 * @param {number} userId  the account being put out
 * @returns {void}
 * Side effects: adds to `room.barred` and clears any `stoodInFor` that named them.
 */
export function barFromRoom(room, userId) {
  room.barred ??= [];
  if (!room.barred.includes(userId)) room.barred.push(userId);
  for (const spot of room.seats ?? room.players ?? []) if (spot?.stoodInFor === userId) delete spot.stoodInFor;
}

/**
 * Has this person been put out of this room by other people?
 * @param {{ barred?: number[] }} room  not changed
 * @param {number} userId
 * @returns {boolean}
 * Side effects: none.
 */
export const isBarred = (room, userId) => Boolean(room.barred?.includes(userId));

/**
 * The room starts the next game.
 *
 * A room outlives the game being played in it: "play again" keeps the code, the settings and the people, and starts a
 * new game among them.  Numbering those games is what lets the one just played keep its scoreboard — the rounds are
 * filed under the game they belong to, so the next game's first round lands beside the last game's rather than on top
 * of it.  Before this, replaying deleted every round of the game just finished (shared/roomStore.js `write` deletes
 * from the first difference onwards, and an emptied history differs at the first round).
 *
 * The game's own reset — the phase, the scores, the deck, `history: []`, `recorded: false` — stays with the game that
 * knows what it has.  This is only the number.  `room.nextSlot` is deliberately *not* reset: the people carry on into
 * the next game, so their slots must carry on too, and somebody joining it must not be handed one already in use.
 *
 * @param {object} room  the room to change
 * @returns {void}
 * Side effects: advances `room.gameSeq` (a room that has never replayed had none, and was game 0).
 */
export function nextGame(room) {
  room.gameSeq = (room.gameSeq ?? 0) + 1;
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
 * Builds the rules for who is in a room: joining, leaving, being replaced and being put out.
 *
 * The two families reach this through `createSeatRules` and `createRosterRules`, which supply the `layout` and the
 * `errors` below; a game supplies only what is true of that game.
 *
 * @param {object} config
 * @param {object} config.layout  how places are addressed: seatLayout or rosterLayout (shared/layout.js)
 * @param {object} config.errors  the codes this family's clients already know, since the two were never the same:
 *   `barred`, `full`, `started`, `notInGame`, `kickNotHost`, `kickTarget`, and `gameOver`
 * @param {(room: object) => boolean} config.isLive  true until the game is over; the lobby counts as live
 * @param {(room: object) => boolean} config.isMidGame  true while a game is actually being played, when somebody who
 *   leaves is replaced by a computer player rather than simply going
 * @param {(room: object, userId: number) => (object | null)} config.guardFill  what stops somebody adding or filling
 *   computer players (the two families answer with different codes)
 * @param {(room: object, slot: string, leaving: object) => boolean} config.leaveFinished  what a place becomes when
 *   its holder leaves a game that is already over, and whether that counts as a change worth telling anybody about
 * @param {number} [config.maxPlayers]  the most the game allows, for families whose room size is not its seat count
 * @param {number} [config.minPlayers]  the fewest it can be played with
 * @param {number} [config.fillTo]  how many "fill with computer players" makes up to
 * @param {string[]} [config.botNames]  the names computer players get (default DEFAULT_BOT_NAMES)
 * @param {(room: object, base: object, extras?: object) => object} [config.makePlayer]  turns the bare member into the
 *   game's own shape (adds the score, the counters, a marker colour...).  Default: the bare member.
 * @param {(room: object, leaving: object, bot: object) => object} [config.replacement]  the member a leaver's place
 *   becomes.  Default: the family's (a fresh computer player for seats; the place as it stands for a list).
 * @param {(room: object, oldId: number|string, member: object, rng: () => number, now: number, seat: number) => void}
 *   [config.takeOver]  runs after a computer player has taken the place of a person who left a game under way.  The
 *   member is already in place; the game gives it an AI, renames the person's id in its own fields, and moves on if
 *   the game was only waiting for that person.
 * @param {(room: object, botId: string, person: object, bot: object, seat: number) => void} [config.handOver]  the
 *   mirror: runs after somebody joining a game under way has taken a computer player's place.
 * @param {(room: object, rng: () => number, now: number) => void} [config.afterRemoval]  runs after somebody has left
 *   and at least one person remains (they may have been the only one the game was waiting for)
 * @returns {object} the shared rules; each family adds the few of its own
 */
export function createMemberRules({
  layout,
  errors,
  isLive,
  isMidGame,
  guardFill,
  leaveFinished,
  minPlayers = 0,
  maxPlayers,
  fillTo,
  botNames = DEFAULT_BOT_NAMES,
  makePlayer = (room, base) => base,
  replacement = layout.replacement,
  takeOver = () => {},
  handOver = () => {},
  afterRemoval = () => {},
}) {
  /** Everybody in the room, people and computer players, however the family stores them. */
  const members = (room) => layout.list(room);
  /** The people, as opposed to the computer players. */
  const people = (room) => members(room).filter(isHuman);
  /** How many places this room has. */
  const capacity = (room) => layout.capacity(room, maxPlayers);
  /** Is there nowhere left to put anybody? */
  const isFull = (room) => members(room).length >= capacity(room);
  /** The names in use.  A member saved before names were kept may have none, and nor has one being renamed. */
  const names = (room) => members(room).filter((m) => typeof m.name === 'string').map((m) => m.name);
  /** A name nobody else here has (ignoring capital letters): "Ann" becomes "Ann (2)" if "ann" is taken. */
  const unique = (room, wanted) => freeName(names(room), wanted, (w, n) => `${w} (${n})`);

  /**
   * Makes the next computer player: the first unused name from the list, then "Computer", numbered if it clashes.
   * @param {object} room  the room (read to avoid clashing names)
   * @returns {object} the new computer player, not yet in a place
   * Side effects: uses up one number from `room.nextBot`, and one slot in the families that hand them out.
   */
  function newBot(room) {
    room.nextBot ??= 1;
    const base = { kind: 'bot', id: `bot:${room.nextBot++}`, name: nextBotName(names(room), botNames) };
    return layout.adopt(room, makePlayer(room, base));
  }

  /**
   * Puts a person in a free place.  Joining twice is harmless (they keep the place they have), and the game must
   * still be in the lobby for a newcomer — anybody later takes a computer player's place instead.
   * @param {object} room  the room to change
   * @param {number} userId  the joining account id
   * @param {string} [name]  the display name wanted (made unique here)
   * @param {object} [extras]  whatever the server knows about them that the game needs, handed to makePlayer
   * @returns {{ ok: boolean, seat?: number, tookOver?: string, error?: string }} where they are, or why not
   * Side effects: adds a member to the room.
   */
  function addHuman(room, userId, name, extras = {}) {
    if (isBarred(room, userId)) return fail(errors.barred);
    const mine = layout.slotOfId(room, userId);
    if (mine !== undefined) return ok({ seat: layout.indexOf(room, mine) });
    if (room.phase !== 'lobby') return sitInForBot(room, userId, name);
    if (isFull(room)) return fail(errors.full);
    const base = { kind: 'human', id: userId };
    if (typeof name === 'string') base.name = unique(room, name);
    const slot = layout.place(room, layout.adopt(room, makePlayer(room, base, extras)));
    if (slot === null) return fail(errors.full);
    return ok({ seat: layout.indexOf(room, slot) });
  }

  /**
   * Somebody arriving at a game already under way — a friend who was slow to open the invitation — takes a computer
   * player's place: its score, its cards, its place in the order, everything but its name and the AI that was playing
   * it.  It is the mirror of what happens when a person leaves, and it is why an invitation is still worth following
   * after the first hand has been dealt.
   *
   * There is nothing to take over in a game that is over (the caller says so instead), nor in one where every place
   * already holds a person, which is as full as a game can be.
   *
   * @param {object} room  the room to change
   * @param {number} userId  the joining account id
   * @param {string} [name]  the display name wanted (made unique here)
   * @returns {{ ok: boolean, seat?: number, tookOver?: string, error?: string }} the place taken and the name of the
   *   computer player that was in it, or why nothing could be taken
   * Side effects: replaces that place, and whatever `handOver` changes.
   */
  function sitInForBot(room, userId, name) {
    if (!isMidGame(room)) return fail(errors.started);
    const slot = slotToTake(room, userId);
    if (slot === undefined) return fail(errors.full);
    const bot = layout.at(room, slot);
    const person = { ...bot, kind: 'human', id: userId };
    delete person.ai; // the AI stops here: from now on the place plays for itself
    delete person.stoodInFor; // and it is nobody's stand-in: the person it was waiting for is sitting in it
    delete person.name; // out of the way, so the newcomer may use the name the computer player was going by
    layout.put(room, slot, person);
    person.name = typeof name === 'string' ? unique(room, name) : bot.name;
    const seat = layout.indexOf(room, slot);
    handOver(room, bot.id, person, bot, seat);
    return ok({ seat, tookOver: bot.name });
  }

  /**
   * The place a newcomer takes over.  Their own comes first: if the computer player keeping their place warm is still
   * there, somebody coming back after a dropped connection carries on where they left off, with their own cards and
   * their own score.  Failing that it is a place that is nobody's stand-in — one the host filled — so that the others
   * who might yet come back keep theirs.  Failing that, the first computer player there is.
   *
   * @param {object} room  not changed
   * @param {number} userId  the account arriving
   * @returns {string | undefined} the slot, or undefined when every place holds a person
   * Side effects: none.
   */
  function slotToTake(room, userId) {
    const bots = layout.bots(room);
    const held = (slot) => layout.at(room, slot).stoodInFor;
    return bots.find((slot) => held(slot) === userId) ?? bots.find((slot) => held(slot) === undefined) ?? bots[0];
  }

  /**
   * Takes somebody out, whoever asked.  In the lobby their place is freed.  In a game under way a computer player
   * takes it over, keeping their turn and their score, and remembers whose place it is so they get it back if they
   * come back.  Once the game is over the family decides (a seated game leaves a marker so the final scores still
   * name them; a list leaves them where they are and says nothing happened).  If they were the host, the next person
   * becomes host.
   *
   * @param {object} room  the room to change
   * @param {number} userId  the account leaving
   * @param {() => number} rng  random source, handed to `takeOver` and `afterRemoval`
   * @param {number} [now]  the clock, for games whose rules start a timer when somebody is replaced
   * @returns {{ ok: boolean, empty?: boolean, seat?: number, replaced?: boolean, changed?: boolean, error?: string }}
   *   `empty` is true when no person is left, so the caller should discard the room; `changed: false` means nothing
   *   happened, so the room is neither saved nor sent
   * Side effects: changes the room's members, may change `room.hostId`, `room.nextBot` and whatever the hooks change.
   */
  function takeOut(room, userId, rng, now = 0) {
    const slot = layout.slotOfId(room, userId);
    if (slot === undefined) return fail(errors.notInGame);
    const seat = layout.indexOf(room, slot); // where they are now: a list closes up behind somebody who leaves it
    const leaving = layout.at(room, slot);
    const midGame = isMidGame(room);
    if (!isLive(room)) {
      if (!leaveFinished(room, slot, leaving)) return ok({ empty: false, replaced: false, changed: false });
    } else if (midGame) {
      const bot = newBot(room);
      // The computer player remembers whose place it is keeping warm, so that they get it back if they come back.
      layout.put(room, slot, { ...replacement(room, leaving, bot), stoodInFor: userId });
      takeOver(room, userId, layout.at(room, slot), rng, now, seat);
    } else {
      layout.vacate(room, slot);
    }
    const left = people(room);
    if (!left.length) return ok({ empty: true, seat, replaced: midGame });
    if (room.hostId === userId) room.hostId = left[0].id;
    afterRemoval(room, rng, now);
    return ok({ empty: false, seat, replaced: midGame });
  }

  /**
   * A person leaves (or is sent home).  Computer players are not people, so this refuses one.
   * @param {object} room  the room to change
   * @param {number} userId  the account leaving
   * @param {() => number} rng
   * @param {number} [now]
   * @returns {{ ok: boolean, empty?: boolean, seat?: number, replaced?: boolean, changed?: boolean, error?: string }}
   * Side effects: as takeOut.
   */
  function removeHuman(room, userId, rng, now = 0) {
    const slot = layout.slotOfId(room, userId);
    if (slot === undefined || !isHuman(layout.at(room, slot))) return fail(errors.notInGame);
    return takeOut(room, userId, rng, now);
  }

  /**
   * The host fills the room with computer players, up to `target`.
   *
   * A seated game fills the table, because every seat is a seat at it.  A game with a list makes up a normal table of
   * players instead — most are played by about four whatever the most they allow is, and a "fill" that handed you
   * eleven computer players would be a surprise rather than a convenience.
   *
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (must be the host)
   * @param {number} [target]  how many players the room should have
   * @returns {{ ok: boolean, error?: string }}
   * Side effects: adds computer players; uses up one `room.nextBot` per bot.
   */
  function fillWithBots(room, userId, target = fillTo) {
    const refused = guardFill(room, userId);
    if (refused) return refused;
    const asked = Math.round(numberFrom(target)) || fillTo;
    const wanted = Number.isInteger(maxPlayers)
      ? Math.min(capacity(room), maxPlayers, Math.max(minPlayers, asked))
      : capacity(room);
    while (members(room).length < wanted) if (layout.place(room, newBot(room)) === null) break;
    return ok();
  }

  /**
   * The host removes another person, at any time before the game is over: in the lobby they go, and in a game a
   * computer player takes their place (as when somebody leaves).  A finished game has nobody to remove.  The result
   * names the person, so the server can send them home.
   * @param {object} room  the room to change
   * @param {number} hostId  who is asking (must be the host)
   * @param {string} slot  the slot of the person to remove ("s2")
   * @param {() => number} rng
   * @param {number} [now]
   * @returns {{ ok: boolean, userId?: number, replaced?: boolean, error?: string }}
   * Side effects: as takeOut, plus the removed account is barred from coming back.
   */
  function kick(room, hostId, slot, rng, now = 0) {
    if (room.hostId !== hostId) return fail(errors.kickNotHost);
    const target = layout.at(room, slot);
    if (!isHuman(target) || target.id === hostId) return fail(errors.kickTarget);
    if (!isLive(room)) return fail(errors.gameOver);
    const removed = takeOut(room, target.id, rng, now);
    if (!removed.ok) return removed;
    barFromRoom(room, target.id); // put out by somebody else, so the invitation does not let them back in
    return ok({ userId: target.id, replaced: Boolean(removed.replaced) });
  }

  return { newBot, addHuman, sitInForBot, removeHuman, takeOut, fillWithBots, kick, capacity, isFull, members, people, names, unique, slotToTake };
}
