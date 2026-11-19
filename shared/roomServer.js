// The socket layer every seated game shares.  A game's server.js used to be a ~280 line copy of this file with a few
// words changed; now it states only what is different about the game (its settings, its own socket events, what the
// server has to do by itself next) and createRoomServer() does the rest:
//
//   - keeps the rooms in memory and saves them under ctx.dataDir (debounced, written atomically);
//   - throws away old rooms every hour;
//   - remembers which sockets each account has open and sends every person their own view of the room;
//   - joins, resumes, creates, leaves, and kicks, and the lobby events (settings, addBot, removeBot, fillBots, start, again);
//   - runs the game's "next thing the server does by itself" (a computer move, a pause between tricks...) on a timer;
//   - reports a finished game to the statistics once.
//
// Nothing here knows any rules.  The game's rules module (`game`) must provide the seat vocabulary described under
// `options.game` below; seats.js (also shared) implements most of it for games with numbered seats, and roster.js for games that keep a list of players (set options.members and options.layout for those).
//
// Randomness and the clock are injected (`options.rng`, `options.now`) so a test can make a server deterministic;
// the defaults (Math.random and Date.now) are chosen once, here, and nowhere else in the shared code or the rules.  The same
// `rng` and `now` reach the rules (start, removeHuman, kick), the game's own socket events (registerEvents gets `rng`),
// `nextAction(room, rng, now)` and so the computer players, so one seed replays a whole game.
// Depends on: node:fs and node:path only; the rules module, ctx and clock are injected through createRoomServer arguments.
import { refusalReply } from './messages.js';
import { createRoomLife } from './roomLife.js';
import { seatLayout } from './layout.js';
import { allOrNothing } from './settings.js';
import { MAX_ENTRANTS } from './tournament.js';
import { createTournamentRules } from './tournamentRoom.js';

/**
 * How long a computer player seems to think before it acts, as "min-max" milliseconds.  The pause is not for the
 * computer's sake — it decides in a millisecond or two — but so that a person can see what happened before the next
 * thing happens.
 */
export const THINKING = '600-1400';
/**
 * The same, for a game of cards.  A card game asks for far more moves than a board game does, and each one is
 * smaller: a hand of Hearts is fifty-two plays, where a game of Azulejo is a few dozen.  A pause long enough to
 * follow a move that rearranges a board is dead time fifty times over when the move is one card, so a card game's
 * computer players think for about half as long.
 */
export const CARD_THINKING = '300-700';

/**
 * Reads a "min-max" milliseconds range from the environment (the tests make computer players fast this way).
 *
 * @param {string} name       the environment variable, e.g. 'HEARTS_BOT_DELAY'
 * @param {string} fallback   the range used when it is unset or malformed, e.g. THINKING
 * @returns {{ min: number, max: number }} min is never negative and max is never below min
 * Side effects: none (reads process.env).
 */
export function readDelayRange(name, fallback) {
  const parse = (text) => String(text).split('-').map(Number);
  let [min, max] = parse(process.env[name] ?? fallback);
  const [fallbackMin, fallbackMax] = parse(fallback);
  if (!Number.isFinite(min) || min < 0) min = fallbackMin;
  if (!Number.isFinite(max)) max = Math.max(fallbackMax, min);
  return { min, max: Math.max(max, min) };
}

/**
 * Reads a single number of milliseconds from the environment.
 *
 * @param {string} name      the environment variable, e.g. 'HEARTS_TRICK_PAUSE'
 * @param {number} fallback  used when it is unset, not a number or negative
 * @returns {number}
 * Side effects: none (reads process.env).
 */
export function readDelayMs(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Picks how long a computer player should wait before acting.
 *
 * @param {{ min: number, max: number }} range  from readDelayRange
 * @param {() => number} rng                    a random number generator returning [0, 1) (required: pass the server's)
 * @returns {number} milliseconds
 * Side effects: none beyond advancing `rng` once.
 */
export function botWait(range, rng) {
  return range.min + rng() * (range.max - range.min);
}

/**
 * Keeps only the named keys of a payload that a client actually sent (a "settings" or "create" message).
 *
 * @param {object | undefined} payload  whatever the client sent
 * @param {string[]} keys               the settings the game accepts
 * @returns {object} a new object with just those keys, leaving out the undefined ones
 * Side effects: none.
 */
export function pickKeys(payload, keys) {
  const picked = {};
  for (const key of keys) if (payload && Object.hasOwn(payload, key) && payload[key] !== undefined) picked[key] = payload[key];
  return picked;
}

/**
 * A lookup of an account's display name, for a game that names people who have left a room, or whose rooms were
 * saved before names were kept with the players.
 *
 * @param {{ users?: { get: (id: any) => ({ displayName?: string } | null | undefined) } }} ctx  the module context
 * @returns {(id: any) => string} the display name, or 'Someone' for an account the site does not know
 * Side effects: none (each lookup reads the site's accounts).
 */
export const accountNames = (ctx) => (id) => ctx.users?.get(id)?.displayName ?? 'Someone';

/**
 * Turns a refused rule into a throw, for something the server does by itself (`nextAction`'s `run`): the room server
 * then logs it and tries again, rather than leaving the room waiting for ever on something that quietly did nothing.
 *
 * @param {{ ok: boolean, error?: string }} outcome  what the rule returned
 * @returns {void}
 * Side effects: throws on a refusal.
 */
export function insist(outcome) {
  if (!outcome.ok) throw new Error(outcome.error);
}

/**
 * A computer player's move, as `nextAction` schedules one.  A move that plays nothing is reported as a failure (it
 * would otherwise be asked for again for ever), so the room server's retry-with-a-pause takes over.
 *
 * @param {{ type: string, id: number | string }} action  what the rules said is pending, for the failure's words
 * @param {number} wait  how long the computer player seems to think, in milliseconds (see botWait)
 * @param {() => boolean} play  plays the move, answering whether one was played
 * @returns {{ wait: number, run: () => void }} what `nextAction` returns; a game that runs several clocks adds a `key`
 * Side effects: none itself; the returned run() plays the move and throws if nothing was played.
 */
export function botMove(action, wait, play) {
  return {
    wait,
    run() {
      if (!play()) throw new Error(`the computer move ${action.type} for ${action.id} was refused`);
    },
  };
}

/**
 * Something the server does by itself when a wait runs out, as `nextAction` schedules it: moving on from the scores
 * when somebody has not closed them, say.  The same `key` keeps its timer, so the wait is not started again by
 * whatever else changes the room meanwhile.
 *
 * @param {string} key  names this wait, e.g. `next:${room.turn}`
 * @param {number} wait  how long to wait, in milliseconds
 * @param {() => { ok: boolean, error?: string }} rule  the rule to run, which must not be refused (see insist)
 * @returns {{ key: string, wait: number, run: () => void }} what `nextAction` returns
 * Side effects: none itself; the returned run() runs the rule and throws if it was refused.
 */
export function afterWait(key, wait, rule) {
  return { key, wait, run: () => insist(rule()) };
}

/**
 * Whichever of several things the server owes a room is due first, as `nextAction` returns it: for a game that runs
 * several clocks off the one timer the room server gives it (a letter revealed, the end of a turn, a computer
 * player's move).  Doing it changes the room, which works the next one out again.
 *
 * @param {{ key: string, at: number, run: () => void }[]} due  each with the time it falls due, on the server's clock
 * @param {number} now  the time now
 * @returns {{ key: string, wait: number, run: () => void } | null} the first of them (the earliest listed, when two
 *   fall due together), waiting no less than nothing; null when nothing is due
 * Side effects: none.
 */
export function soonest(due, now) {
  if (!due.length) return null;
  const first = due.reduce((earliest, next) => (next.at < earliest.at ? next : earliest));
  return { key: first.key, wait: Math.max(0, first.at - now), run: first.run };
}

/**
 * A refusal as the client receives it: the rules' code and, when its words need them, the values to put in (see
 * shared/messages.js).  Without the values a sentence such as "You need at least {min} players." reaches the player with
 * the gap still in it.
 * @param {{ error?: string, params?: object }} outcome  what a rule returned, which the caller has already found to
 *   have failed — so it has an error, even though a rule result on its own only says it might
 * @returns {{ ok: false, error: string, params?: object }}
 * Side effects: none.
 */
const refused = (outcome) => ({ ok: false, error: /** @type {string} */ (outcome.error), ...(outcome.params ? { params: outcome.params } : {}) });

/**
 * Builds the server half of a seated game.
 *
 * Side effects: reads the saved rooms from disk now, starts an hourly sweep timer, registers a 'connection' handler on
 * ctx.io, and later writes the rooms to disk and sets timers for computer moves. dispose() undoes the timers.
 *
 * @param {object} ctx  the module context the site gives server.js (io, dataDir, log, codes, stats, ...)
 * @param {object} options
 * @param {object} options.game  the rules module.  It must export: createRoom({ code, hostId, hostName, settings, ...extra })
 *   (the one rule that throws instead of returning { ok: false }: the Error's message is shown to the person, so throw
 *   only what they should read, such as "Play to 61 or 121."),
 *   viewFor(room, userId, viewOptions), statsPlayers(room), isLive(room), isHuman(seat), hasPlayer(room, userId),
 *   seatOf(room, userId), addHuman(room, userId, name), removeHuman(room, userId, rng, now) (returns { ok, empty, ... };
 *   `changed: false` says the room was left as it was, so nothing is saved or sent),
 *   kick(room, hostId, seat, rng, now), setSettings(room, userId, settings), addBot(room, userId, seat),
 *   removeBot(room, userId, seat, rng), fillWithBots(room, userId), start(room, userId, rng, now), playAgain(room, userId).
 *   Every rule returns { ok: true, ... } or { ok: false, error }.
 * @param {(payload: object) => object} options.pickSettings  keeps only the settings the game accepts from a client message
 * @param {(room: object, rng: () => number, now: () => number, who: { online: (id: number) => boolean, relay: Function }) => ({ key?: string, wait: number, run: () => void } | null)} options.nextAction  what the server
 *   must do by itself next, if anything (given the server's `rng` and `now`, to hand to botWait and the computer players,
 *   `who.online` for rules that wait on somebody being there, and `who.relay` for a job that sends a stream of its own,
 *   as `registerEvents` gets): `wait` milliseconds from now it calls `run()` (a computer move, the end of a trick
 *   pause...).  If `key` is given and the same key is already waiting, the existing timer is kept instead of restarted.
 * @param {(h: object) => void} options.registerEvents  adds the game's own socket events.  It is called for every connection
 *   with { on, act, userId, socket, rng, now, roomOf, relay } (the server's random numbers and clock, for rules that need them): `on(event, handler)` wraps a handler (payload in, ack object out) with validation and
 *   error handling; `act(rule)` runs rule(room, seat) on the room this socket is in and tells everybody if it worked;
 *   `roomOf()` is the room this socket is looking at (undefined outside one); `relay(room, event, payload, { except })`
 *   sends an event straight to the room's people, for a stream no view can carry (the strokes of a drawing).
 * @param {(payload: object) => object} [options.createArgs]  extra arguments for game.createRoom beyond the settings
 * @param {(userId: number) => object} [options.playerExtras]  what the server knows about a person that the rules need when they
 *   take a place (for example their preferred marker colour).  It is merged into the game.createRoom arguments for the host
 *   and handed to game.addHuman as a fourth argument for everybody who joins.
 * @param {(room: object, userId: number, now: () => number) => object} [options.viewOptions]  extra options for game.viewFor (such as the current
 *   time, or something that depends on who is looking)
 * @param {(room: object) => object[]} [options.members]  the people and computer players of a room, each with `kind` and `id`
 *   (default: room.seats, which has null for an empty seat; the player-list games of shared/roster.js use room.players)
 * @param {{ slotOf: Function, indexOf: Function, at: Function }} [options.layout]  how this game's places are laid out
 *   (shared/layout.js): `seatLayout` for numbered seats (the default), `rosterLayout` for a list of players.  It is
 *   what turns the slot a client names into the member sitting in it.
 * @param {(room: object, userId: number) => object} [options.startRule]  replaces game.start for the 'start' event
 * @param {(room: object) => object} [options.migrate]  brings a saved room up to date when it is loaded
 * @param {(room: object) => void} [options.afterChange]  runs after every change to a room, before it is saved and sent to
 *   anybody (for something the game does once per change, such as handing out achievements).  A throw is logged and ignored.
 * @param {boolean} [options.tournament]  false for a game that may not be played as a tournament (the tour).  Every
 *   other room-based game has tournament mode without a word of its own: see shared/tournamentRoom.js.
 * @param {(room: object) => void} [options.onFinished]  told once when a game here ends, for something outside this module
 *   that is waiting on it (a tour).  A game does not pass this: it comes from the site as `ctx.onGameFinished`, so that
 *   every module is heard without any of their server.js files knowing anything about it.
 * @param {() => number} [options.rng]  random numbers for rules that need them (default Math.random, created once here)
 * @param {() => number} [options.now]  the clock in milliseconds (default Date.now, created once here)
 * @returns {{ dispose: () => void, rooms: Map<string, object>, openFor: Function, changed: Function, gamesOf: Function }}
 *   dispose() stops timers and saves; `rooms` is exposed for tests; `openFor` opens a started room for people who did
 *   not ask for it themselves (see below); `changed` saves and sends a room that something outside the protocol has
 *   altered; `gamesOf` is the games one person has on the go here, for the site's list of them
 */
export function createRoomServer(ctx, options) {
  const { game, pickSettings, nextAction, registerEvents, createArgs = () => ({}), viewOptions = () => ({}), playerExtras = () => ({}), afterChange, members = (room) => room.seats, layout = seatLayout, startRule, migrate, onFinished = ctx.onGameFinished, tournament = true, rng = Math.random, now = Date.now } = options;

  // How many this game itself is for, which a tournament's table must be inside.  It comes from the module's own
  // manifest; a hand-built context in a test has none, and is given the widest limits there are rather than nothing.
  const limits = { min: Number(ctx.meta?.minPlayers ?? 1), max: Number(ctx.meta?.maxPlayers ?? MAX_ENTRANTS) };
  // Tournament mode, which every room-based game has and none of them writes (shared/tournamentRoom.js).  It opens
  // its tables through this file's own `openFor` — the same door a tour uses to open a game in another module — and
  // reads them back out of the rooms this server keeps.  Both are reached through a function so that they are looked
  // up when a tournament asks, which is long after everything here has been built.
  const tournaments = createTournamentRules({
    game,
    members,
    layout,
    limits,
    rng,
    enabled: tournament !== false,
    openTable: (options) => openFor(options),
    roomOf: (code) => life.rooms.get(code),
    log: ctx.log,
  });

  // Everything that happens to a room, as against anybody asking for it: shared/roomLife.js owns the saved rooms, the
  // open sockets, the timers, and the vote running in a room.  What is left in this file is the protocol — the events
  // a client may send, what each of them is allowed to do, and what it is told back.
  const life = createRoomLife({ ctx, game, members, layout, viewOptions, afterChange, playerExtras, nextAction, migrate, onFinished, tournaments, rng, now });
  const { votes } = life;

  /**
   * Opens a room in this game for people who are not asking for it themselves, and starts it.  This is the `create`
   * event above with the socket taken out: another part of the site (a tour, which is choosing games on their behalf)
   * seats the people it already has and hands them the code to walk in with.
   *
   * Nobody is attached to it, because nobody is here yet; each person joins by code through `enter` in the ordinary
   * way, exactly as they would from an invitation.  Whoever cannot be seated is left out rather than refused: the
   * caller is given back who actually got in, since a game may hold fewer people than the caller has.
   *
   * @param {object} options
   * @param {number} options.hostId  whose room it is (the first person seated)
   * @param {string} options.hostName  their display name
   * @param {{ id: number, name: string }[]} [options.people]  everybody else to seat, in order
   * @param {number} [options.size]  how many places the game should have (bots fill the rest); the game's own default when left out
   * @param {object} [options.settings]  settings for the game, run through its own `pickSettings`
   * @param {{ code: string, round: number, players: number[] }} [options.inTournament]  the tournament this room is a
   *   table of, which is written on the room: it is what makes the table one of that evening's rather than a game of
   *   its own, and what keeps anybody who was not drawn to play at it from walking in with the code
   * @returns {{ ok: true, code: string, seated: number[] } | { ok: false, error: string, params?: object }}
   * Side effects: creates, saves, starts and schedules a room.  It never throws: a rules refusal comes back as `ok: false`.
   */
  function openFor({ hostId, hostName, people = [], size, settings = {}, inTournament }) {
    let room;
    try {
      room = game.createRoom({
        code: ctx.codes.generate((c) => life.taken(c)),
        hostId,
        hostName,
        settings: pickSettings(settings),
        now: now(),
        ...playerExtras(hostId),
        ...createArgs(settings),
      });
    } catch (error) {
      ctx.log('could not open a room for somebody else:', error.message);
      return refusalReply(error);
    }
    if (inTournament) room.inTournament = inTournament;
    const seated = [hostId];
    for (const person of people) {
      if (person.id === hostId) continue;
      if (game.addHuman(room, person.id, person.name, playerExtras(person.id)).ok) seated.push(person.id);
    }
    const filled = game.fillWithBots(room, hostId, size ?? seated.length);
    if (!filled.ok) return refused(filled);
    const started = (startRule ?? game.start)(room, hostId, rng, now());
    if (!started.ok) return refused(started);
    life.keep(room);
    life.changed(room);
    return { ok: true, code: room.code, seated };
  }

  /**
   * A lobby setting changes.  Tournament mode is the site's rather than the game's — every room-based game has it —
   * so it is taken out of the message here and the game is handed the rest, which its own `pickSettings` keeps the
   * known keys of.  A message carrying both is one change: a table the game refuses leaves tournament mode as it was.
   *
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (the host, in the lobby: the rules say so)
   * @param {object} payload  what the client sent
   * @returns {{ ok: boolean, error?: string, params?: object }}
   * Side effects: on success, changes the room's settings, and may resize it (see shared/tournamentRoom.js).
   */
  function changeSettings(room, userId, payload) {
    const { tournament: asked, ...rest } = payload;
    // The game's own settings are the ones chosen before tournament mode was switched on: its lobby is not on screen
    // afterwards, and every table is dealt with what it said then.  Switching the tournament off brings them back.
    const gameSettings = (mine) => (tournaments.settingOf(room) ? { ok: false, error: 'tournamentSettingsFirst' } : game.setSettings(room, userId, mine));
    if (asked === undefined) return gameSettings(pickSettings(rest));
    return allOrNothing(room, () => {
      const set = tournaments.setTable(room, userId, asked);
      if (!set.ok) return set;
      const mine = pickSettings(rest);
      // A message about nothing but the tournament is not handed to the game at all: a game with no settings of its
      // own refuses an empty one, and rightly.
      return Object.keys(mine).length ? gameSettings(mine) : { ok: true };
    });
  }

  // One connection per browser tab: track the socket, register the shared events, then the game-specific ones.
  ctx.io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    life.addSocket(userId, socket);

    // Returns the room this socket is currently looking at, or undefined.
    const roomOfSocket = () => life.roomAt(socket.data.code);

    /**
     * Registers a socket event.  The handler gets the payload (always a plain object, never an array or null) and returns
     * the ack object ({ ok: true } if it returns nothing); a throw is logged and the client gets a generic error.
     * @param {string} event  the socket event name
     * @param {(payload: object) => (object | undefined)} handler  the work to do
     * @returns {object} the socket (from socket.on)
     * Side effects: registers a listener on the socket; each call replies through the client ack callback and may log.
     */
    const on = (event, handler) =>
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          reply(handler(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) ?? { ok: true });
        } catch (error) {
          ctx.log(`${event} failed:`, error);
          reply({ ok: false, error: 'serverError' });
        }
      });

    /**
     * Runs a rule on the room this socket is in, then tells everyone if it worked.
     * The rule gets (room, seat); the client only ever sees { ok } or { ok: false, error }.
     * @param {(room: object, seat: number) => { ok: boolean, error?: string }} rule  the rule to run
     * @returns {{ ok: boolean, error?: string }} the ack for the client
     * Side effects: whatever the rule mutates; calls `changed(room)` on success.
     */
    const act = (rule) => {
      const room = roomOfSocket();
      const seat = room ? game.seatOf(room, userId) : -1;
      if (seat === -1) return { ok: false, error: 'notInAnyGame' };
      const outcome = rule(room, seat);
      if (outcome.ok) life.changed(room);
      return outcome.ok ? { ok: true } : refused(outcome);
    };

    /**
     * The same, for the game's own events.  Nothing of the game is being played in a room whose tournament is under
     * way — its games are at its tables — so a move sent to one is refused before any rule is asked about a room it
     * was never written for.
     * @param {(room: object, seat: number) => { ok: boolean, error?: string }} rule  the rule to run
     * @returns {{ ok: boolean, error?: string }} the ack for the client
     * Side effects: as `act`.
     */
    const playAct = (rule) => {
      const room = roomOfSocket();
      if (room && tournaments.isRunning(room)) return { ok: false, error: 'tournamentRunning' };
      return act(rule);
    };

    on('resume', ({ code }) => life.enter(socket, code));
    on('join', ({ code }) => (typeof code === 'string' && code.trim() ? life.enter(socket, code) : { ok: false, error: 'typeInviteCode' }));

    // Starting a game does not end the ones already going: somebody may be playing several at once, here and
    // elsewhere on the site (see `enter` in shared/roomLife.js).
    on('create', (payload) => {
      let room;
      try {
        room = game.createRoom({
          code: ctx.codes.generate((c) => life.taken(c)),
          hostId: userId,
          hostName: socket.data.user.name,
          settings: pickSettings(payload),
          now: now(),
          ...playerExtras(userId),
          ...createArgs(payload),
        });
      } catch (error) {
        ctx.log('create refused:', error.message); // a rules bug would surface here too, so keep a trace of it
        return refusalReply(error); // a refusal the rules threw keeps its code; anything else is a bug, and is a plain server error
      }
      life.keep(room);
      life.attach(socket, room);
      return { ok: true, code: room.code };
    });

    on('leave', () => {
      const room = roomOfSocket();
      if (!room) return { ok: true };
      if (!game.hasPlayer(room, userId)) {
        socket.data.code = null;
        socket.emit('state', null);
        return { ok: true };
      }
      life.leaveRoom(room, userId);
      return { ok: true };
    });

    // The host removes someone: the rules refuse a finished game, a missing seat, and the host themselves.
    on('kick', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      // A tournament under way is in a phase no game knows, so its own `kick` would say the game was over.  It is
      // also the one time removing somebody is urgent: a round waits on everybody saying they are ready, and the
      // host putting out whoever is never coming back is what gets it going again.
      const outcome = tournaments.isRunning(room) ? tournaments.putOut(room, userId, payload.slot, rng, now()) : game.kick(room, userId, payload.slot, rng, now());
      if (!outcome.ok) return refused(outcome);
      // Somebody put out of a tournament keeps the games they played, and is taken out of the ones still to come.
      tournaments.withdraw(room, outcome.userId);
      life.detach(outcome.userId, room.code);
      life.changed(room);
      return { ok: true };
    });

    // Anybody may ask for a player to be put out, and the others answer; the host still has `kick` for an outright one.
    on('voteKick', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const asked = votes.ask(room, userId, payload.slot);
      if (!asked.ok) return refused(asked);
      life.changed(room);
      return { ok: true };
    });

    on('voteAnswer', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const answered = votes.answer(room, userId, payload.agree === true);
      if (!answered.ok) return refused(answered);
      if (answered.target !== null) life.putOutByVote(room, answered.target);
      else life.changed(room);
      return { ok: true, passed: Boolean(answered.passed) };
    });

    on('voteDrop', () => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      const dropped = votes.drop(room, userId);
      if (!dropped.ok) return refused(dropped);
      life.changed(room);
      return { ok: true };
    });

    on('settings', (payload) => act((room) => changeSettings(room, userId, payload)));
    on('addBot', ({ seat }) => act((room) => tournaments.botsRefused(room) ?? game.addBot(room, userId, seat)));
    on('removeBot', ({ slot }) => act((room) => game.removeBot(room, userId, slot, rng)));
    on('fillBots', (payload) => act((room) => tournaments.botsRefused(room) ?? game.fillWithBots(room, userId, payload.count)));
    // Starting a tournament is not starting a game: it draws the evening up and the server opens the first round's
    // tables a moment later.
    on('start', () => act((room) => (tournaments.settingOf(room) ? tournaments.start(room, userId, now()) : (startRule ?? game.start)(room, userId, rng, now()))));
    on('again', () => act((room) => tournaments.againRefused(room) ?? game.playAgain(room, userId)));
    // Between rounds a tournament waits for everybody still in it to say they are ready, and opens the round itself
    // once the last of them has (shared/tournamentRoom.js).  `act` is no use: it asks the game for a seat, and a
    // tournament's people are not sitting at a table of it.
    // Named for the tournament rather than just `ready`: Cribbage has an event of its own by that name (the show
    // moves on when everybody is ready), and two handlers on one event would both run.
    on('tournamentReady', (payload) => {
      const room = roomOfSocket();
      if (!room) return { ok: false, error: 'notInAnyGame' };
      // Said from the table they have just finished as readily as from the tournament itself: that is where somebody
      // reading the last of the scores is sitting, and being sent back to another room to press a second button
      // would be a worse answer than simply hearing them.
      const held = tournaments.settingOf(room) ? room : tournaments.parentOf(room);
      if (!held) return { ok: false, error: 'notATournament' };
      const outcome = tournaments.setReady(held, userId, payload.ready !== false);
      if (!outcome.ok) return refused(outcome);
      life.changed(held);
      return { ok: true };
    });

    registerEvents({ on, act: playAct, userId, socket, rng, now, roomOf: roomOfSocket, relay: life.relay });

    socket.on('disconnect', () => {
      life.dropSocket(userId, socket);
      const room = roomOfSocket();
      // Somebody going is not a change to the room, but it can change what the server owes it next: a game that waits
      // on a player who has gone (a drawer who shut the tab) must be given the chance to set that timer now, rather
      // than only when something else happens to fire.  An unchanged `nextAction` keeps the timer it already has.
      if (room) {
        life.push(room);
        life.reschedule(room);
      }
    });
  });

  /**
   * One room as a line in the site's list of the games a person has on the go, or null when it is not one of them.
   *
   * Two kinds of room make a row, and they are told apart here rather than by the site:
   *   - a tournament, which says where the evening has got to and whether it is waiting on the reader;
   *   - an ordinary game, which says who else is at it, since what tells two games of the same thing apart is the
   *     people playing them.
   * A table of a tournament is neither: the tournament's own row is the way into it (`yourTable`), and a row of its
   * own would be the same game offered twice.
   *
   * @param {object} room  the room to describe
   * @param {number} userId  whose list it is
   * @returns {object | null}
   * Side effects: none.
   */
  function rowOf(room, userId) {
    const held = tournaments.rowFor(room, userId);
    if (held) return { ...held, kind: 'tournament' };
    // A tournament with no row (finished, or one this person has withdrawn from) is not an ordinary game either:
    // falling through would list its lobby as something to play.
    if (tournaments.settingOf(room) || tournaments.parentOf(room)) return null;
    if (!game.isLive(room)) return null;
    // Whoever left a game that was already over is still on its standings, marked `left`, and is no longer one of its
    // people: neither a row for them nor a name for anybody else (see `people` in shared/members.js).
    const here = (members(room) ?? []).filter((member) => member && !member.left);
    if (!here.some((member) => game.isHuman(member) && member.id === userId)) return null;
    return {
      kind: 'game',
      code: room.code,
      lobby: room.phase === 'lobby', // both families of game wait in a phase of that name, and start by leaving it
      others: here.filter((member) => member.id !== userId).map((member) => String(member.name ?? '')),
      updatedAt: room.updatedAt ?? 0,
    };
  }

  /**
   * The games this person has on the go, for the site's list of them (server/modules.js gathers every game's).  It is
   * read from the store's index of who is in which room, so it costs nothing to ask for and answers for somebody who
   * is not connected at all — which is the point, since a game is now something you come back to rather than
   * something you are in until it ends.
   *
   * @param {number} userId  whose games
   * @returns {object[]} one row each (see `rowOf` above), oldest news last
   * Side effects: none.
   */
  const gamesOf = (userId) =>
    life
      .roomsOf(userId)
      .flatMap((room) => rowOf(room, userId) ?? [])
      .sort((one, other) => other.updatedAt - one.updatedAt);

  // `changed` is here for something outside the protocol that has altered a room and must have it saved and sent: the
  // tour, whose rooms move on when a game in another module ends rather than when anybody sends anything.
  return { rooms: life.rooms, dispose: life.dispose, openFor, changed: life.changed, gamesOf };
}
