// A tournament, held against a room.  shared/tournament.js is the arithmetic of one — who meets whom, and how they
// stand — and this is what that arithmetic does to a game's lobby.
//
// Tournament mode is a lobby setting like any other, and every room-based game has it without a word in its own
// server.js (the tour opts out: a tour of tournaments is nobody's evening).  With it on:
//
//   - the lobby holds as many as a tournament may, rather than as many as the game seats, because its people are not
//     going to sit at one table;
//   - computer players are not added to the lobby, because they belong to the tables, so many to each;
//   - `wouldPlay` (shared/seats.js) answers the size of a *table*, so a lobby that describes the deal describes the
//     deal of the game that will actually be played rather than one of twelve;
//   - starting opens a room for each table of the first round instead of dealing anything here.
//
// The room keeps `room.tournament`.  While it is being set up that is `{ on, humans, bots, was }`, where `was` is how
// many places the room held before, so that switching the setting off puts the lobby back exactly as it was.  From
// the start it also holds `rounds` (the whole evening, drawn up at once), which `round` and `opened` walk through,
// `tables` (the round being played) and `last` (the one before it), `standings`, the `names` of everybody taking
// part as they were when it started, and `due`, the long stop for a table nobody finishes.
//
// Each table is an ordinary started room of the game with `room.inTournament = { code, round, players }` on it: that
// is what makes it one of the evening's rather than a game of its own, and what keeps anybody who was not drawn to
// play at it from walking in with the code.
//
// Depends on: shared/tournament.js, shared/members.js, and shared/input.js.
import { numberFrom } from './input.js';
import { fail, hostInLobby, isHuman, ok } from './members.js';
import { MAX_ENTRANTS, MAX_TABLES, checkTable, defaultTable, ranking, recordTable, schedule, tableCount, tableSize } from './tournament.js';

/** More places than any game has, so that a game asked to fill a table of this many answers with the most it allows. */
const PROBE_PLACES = 64;
/** The phase a room is in while its tournament is being played.  No game has a phase of this name, and none is asked about it. */
export const TOURNAMENT_PHASE = 'tournament';
/** The fewest people a tournament is worth holding: one person has nobody to meet. */
export const MIN_ENTRANTS = 2;
/**
 * How long a round waits for a table nobody finishes.  A table whose room is gone is noticed at once (it pokes the
 * tournament as it goes), so this is only for one that is still there with nobody playing it: the evening goes on
 * without it rather than stopping for ever.
 */
export const ROUND_LIMIT_MS = 6 * 60 * 60 * 1000;

/**
 * The rules of a game that has no tournaments (the tour, and anything built without them): there is never a
 * tournament to be in, and asking for one is refused.
 */
export const NO_TOURNAMENTS = {
  enabled: false,
  settingOf: () => null,
  setTable: () => fail('tournamentNotHere'),
  botsRefused: () => null,
  blockFor: () => null,
  viewFor: () => null,
  start: () => fail('tournamentNotHere'),
  nextAction: () => null,
  parentOf: () => null,
  related: () => false,
  admits: () => true,
  withdraw: () => {},
  againRefused: () => null,
  isRunning: () => false,
  tableCodes: () => [],
};

/**
 * Builds a game's tournament rules.
 *
 * @param {object} config
 * @param {object} config.game  the rules module (`fillWithBots`, which the game's own table is measured with, and
 *   `removeBot`, which takes the lobby's computer players out)
 * @param {(room: object) => Array<object | null>} config.members  the people and computer players of a room
 * @param {object} config.layout  how this game's places are laid out (shared/layout.js)
 * @param {{ min: number, max: number }} config.limits  how many the game says in its manifest it is for, which is
 *   only a fallback: the numbers used are measured off the game's own rules (see `limitsOf`)
 * @param {() => number} config.rng  the server's random numbers, for the rules that want them
 * @param {(options: object) => { ok: boolean, code?: string, error?: string }} [config.openTable]  opens a started
 *   room in this same game for the people of one table (the room server's `openFor`)
 * @param {(code: string) => (object | undefined)} [config.roomOf]  a room of this game by its code
 * @param {(...args: any[]) => void} [config.log]  the module's logger, for a table that would not open
 * @param {boolean} [config.enabled]  false for a game that has no tournaments
 * @returns {object} the rules; see the return at the foot of this function
 */
export function createTournamentRules({ game, members, layout, limits, rng, openTable = () => fail('tournamentNotHere'), roomOf = () => undefined, log = () => {}, enabled = true }) {
  if (!enabled) return NO_TOURNAMENTS;

  /** What the game's own rules turned out to be for, once a lobby has been there to measure them against. */
  let measured = null;

  /** The tournament this room is, or null: a room with the setting switched off is not one. */
  const settingOf = (room) => (room?.tournament?.on ? room.tournament : null);
  /** Everybody taking part: the people in the room, computer players and empty places left out. */
  const entrants = (room) => members(room).filter((member) => isHuman(member));
  /** The setting as it stands, which for a room that has never been asked is the game's own first offer. */
  const tableOf = (room) => room.tournament ?? defaultTable(limitsOf(room));

  /**
   * A copy of this room with nobody in it but the host, and room for far more places than any game has, so that the
   * game's own `fillWithBots` can be asked a question without anybody being affected by the answer.
   * @param {object} room  the room to copy (not changed)
   * @returns {object} the copy
   * Side effects: none (rooms are plain data, which is what makes copying one safe: see shared/settings.js).
   */
  function bareCopy(room) {
    const copy = structuredClone(room);
    for (const member of [...layout.list(copy)]) {
      if (member.id === copy.hostId) continue;
      const slot = layout.slotOfId(copy, member.id);
      if (slot !== undefined) layout.vacate(copy, slot);
    }
    layout.resize(copy, PROBE_PLACES);
    return copy;
  }

  /**
   * How many players the game makes a table up to when it is asked for `wanted`, or null if it would not say.  Asking
   * for one gives the fewest it can be played with, asking for far too many gives the most it allows, and asking for
   * nothing at all gives a normal game of it — because that is exactly what `fillWithBots` clamps its argument to.
   * @param {object} room  a lobby of this game, with its host (not changed)
   * @param {number} [wanted]  the table to ask for, or nothing for a normal one
   * @returns {number | null}
   * Side effects: none (everything happens to a copy).
   */
  function measure(room, wanted) {
    try {
      const copy = bareCopy(room);
      if (!game.fillWithBots(copy, copy.hostId, wanted).ok) return null;
      return members(copy).filter(Boolean).length;
    } catch {
      return null; // a game whose rules will not answer keeps its manifest's numbers
    }
  }

  /**
   * What the game itself is for: the fewest at a table, the most, and how many a normal one holds.
   *
   * This is asked of the game's own rules rather than read from its manifest, because the two mean different things.
   * A manifest's `minPlayers` is the fewest *people* a game needs (several say one: one person and some computer
   * players is a game), where a tournament table must be a number of *players* the rules will actually deal to.  And
   * nothing in a manifest says what a normal table is at all — four at Hearts, two at Cribbage — which is the one
   * number the first tournament anybody sets up is built around.
   *
   * The answer is the same for every room in a game, so it is measured once, from the first lobby that needs it.
   *
   * @param {object} room  the room being asked about
   * @returns {{ min: number, max: number, fillTo?: number }}
   * Side effects: none to the room; remembers the answer for next time.
   */
  function limitsOf(room) {
    if (measured) return measured;
    if (room?.phase !== 'lobby' || room.hostId === undefined) return limits;
    const [min, max, fillTo] = [measure(room, 1), measure(room, PROBE_PLACES), measure(room, undefined)];
    if (!min || !max || !fillTo) return limits;
    measured = { min, max, fillTo };
    return measured;
  }

  /**
   * The host turns tournament mode on or off, or changes the table it will play at.
   *
   * Switching it on makes the lobby as big as a tournament may be and takes out the computer players somebody had
   * added, since each table gets its own.  Switching it off puts the lobby back to the size it was, which is refused
   * while more people are in it than that size holds — the host puts somebody out first, as they would to make any
   * other room smaller.  The rules never choose who goes.
   *
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (the host, in the lobby)
   * @param {object} input  `{ on, humans, bots }`, any of them left out to leave it as it is
   * @returns {{ ok: boolean, error?: string, params?: object }}
   * Side effects: sets `room.tournament`, and may resize the room and remove its computer players.
   */
  function setTable(room, userId, input) {
    const problem = hostInLobby(room, userId);
    if (problem) return problem;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('tournamentTable');
    const playable = limitsOf(room);
    const current = tableOf(room);
    const asked = (value, now) => (value === undefined ? now : Math.round(numberFrom(value)));
    const next = { on: input.on === undefined ? Boolean(current.on) : input.on === true, humans: asked(input.humans, current.humans), bots: asked(input.bots, current.bots) };
    const checked = checkTable(next, playable);
    if (!checked.ok) return checked;

    const people = entrants(room).length;
    if (next.on && !current.on) {
      // The places the room had are remembered rather than worked out again: a host who had made the table smaller
      // before switching tournament mode on gets that table back, not the whole game.
      next.was = layout.capacity(room, playable.max);
      for (const slot of layout.bots(room)) game.removeBot(room, userId, slot, rng);
      layout.resize(room, Math.max(MAX_ENTRANTS, people));
    } else if (!next.on && current.on) {
      const back = Number.isInteger(current.was) ? current.was : playable.max;
      if (people > back) return fail('tournamentCrowded', { max: back });
      layout.resize(room, back);
    } else if (current.was !== undefined) {
      next.was = current.was;
    }
    room.tournament = next;
    return ok();
  }

  /** Is this room a tournament with its tables being played? */
  const isRunning = (room) => Boolean(settingOf(room)) && room.phase === TOURNAMENT_PHASE;
  /** The tournament a table belongs to, or null (for the tournament itself, or an ordinary room). */
  const parentOf = (room) => (room?.inTournament ? (roomOf(room.inTournament.code) ?? null) : null);

  /**
   * Are these two rooms part of the same tournament — one its tables, or two of its tables?  Walking from a
   * tournament to the table it opened for you is not leaving one game for another, which is what everywhere else in
   * the room server assumes a second room must be.
   * @param {object} [one]  a room
   * @param {object} [other]  another
   * @returns {boolean}
   * Side effects: none.
   */
  function related(one, other) {
    if (!one || !other) return false;
    const tournamentOf = (room) => (settingOf(room) ? room.code : room.inTournament?.code);
    const [a, b] = [tournamentOf(one), tournamentOf(other)];
    return Boolean(a) && a === b;
  }

  /**
   * May this account walk into this room?  A tournament table is for the people drawn to play at it: anybody else
   * walking in with the code would be taking a computer player's place in somebody else's game, and would end up on
   * its score sheet.
   * @param {object} room  the room being entered
   * @param {number} userId  who is asking
   * @returns {boolean}
   * Side effects: none.
   */
  const admits = (room, userId) => !room?.inTournament || room.inTournament.players.includes(userId);

  /**
   * The host starts the tournament: the whole evening is drawn up here, and the first round's tables are opened by
   * the server a moment later (see `nextAction`), so that a restart in that moment opens them rather than losing them.
   *
   * @param {object} room  the room to change
   * @param {number} userId  who is asking (the host, in the lobby)
   * @param {number} at  the time now
   * @returns {{ ok: boolean, error?: string, params?: object }}
   * Side effects: on success sets `room.phase` and fills in `room.tournament`.
   */
  function start(room, userId, at) {
    const problem = hostInLobby(room, userId);
    if (problem) return problem;
    const table = settingOf(room);
    if (!table) return fail('notATournament');
    const people = entrants(room);
    if (people.length < MIN_ENTRANTS) return fail('tournamentNeedsPeople', { min: MIN_ENTRANTS });
    const tables = tableCount(people.length, table.humans);
    if (tables > MAX_TABLES) return fail('tournamentTooBig', { max: MAX_TABLES });
    room.tournament = {
      ...table,
      round: 0,
      opened: -1, // which round's tables have been opened: a round of nobody is still a round that has happened
      rounds: schedule(people.map((person) => person.id), table.humans),
      tables: [],
      last: [],
      standings: {},
      // Who is taking part, taken down now: somebody who leaves half way through is still on the standings, and the
      // tables yet to come are opened for people who may not be in the room to be asked their name.
      names: Object.fromEntries(people.map((person) => [person.id, person.name ?? ''])),
      due: at + ROUND_LIMIT_MS,
    };
    room.phase = TOURNAMENT_PHASE;
    return ok();
  }

  /**
   * Opens a room for each table of the round that is due, and starts it.  A table that will not open is noted and
   * counted as played, so that one game refusing cannot leave the evening waiting for it for ever.
   * @param {object} room  the tournament
   * @param {number} at  the time now
   * @returns {{ ok: true }}
   * Side effects: opens rooms in this game; sets `room.tournament.tables`, `opened`, and `due`.
   */
  function openRound(room, at) {
    const played = room.tournament;
    played.tables = (played.rounds[played.round] ?? []).map((ids) => {
      const people = ids.map((id) => ({ id, name: played.names[id] ?? '' }));
      const opened = openTable({
        hostId: people[0].id,
        hostName: people[0].name,
        people,
        size: tableSize(played),
        settings: room.settings ?? {},
        inTournament: { code: room.code, round: played.round, players: [...ids] },
      });
      if (opened.ok) return { code: opened.code, players: [...ids], done: false };
      log(`a tournament table would not open: ${opened.error}`);
      return { code: null, players: [...ids], done: true, failed: opened.error };
    });
    played.opened = played.round;
    played.due = at + ROUND_LIMIT_MS;
    return ok();
  }

  /** Has this table come to an end — finished, abandoned, or never opened at all? */
  function tableOver(table) {
    if (table.done) return true;
    const played = table.code ? roomOf(table.code) : null;
    return !played || played.phase === 'finished';
  }

  /**
   * Takes in the round that has finished and moves on to the next, or ends the tournament when there is none.
   * @param {object} room  the tournament
   * @param {number} at  the time now
   * @returns {{ ok: true }}
   * Side effects: counts each table into the standings, and changes the round or the phase.
   */
  function settle(room, at) {
    const played = room.tournament;
    for (const table of played.tables) {
      if (table.done) continue;
      const result = table.code ? roomOf(table.code) : null;
      if (result?.phase === 'finished') recordTable(played.standings, game.statsPlayers(result));
      else table.failed = result ? 'unfinished' : 'gone';
      table.done = true;
    }
    played.last = played.tables;
    played.round += 1;
    played.due = at + ROUND_LIMIT_MS;
    if (played.round >= played.rounds.length) room.phase = 'finished';
    else played.tables = [];
    return ok();
  }

  /**
   * What the server owes a tournament next: opening the round that is due, settling one whose tables have all
   * finished, or giving up on a table nobody is playing any more.
   *
   * The tables are not opened by whoever starts the tournament, nor the round settled by the table that ends it:
   * both happen here, so that a server which stopped in the middle of either picks it up again, and so that opening
   * half a dozen rooms is never nested inside the change that prompted it.
   *
   * @param {object} room  the room (not changed here)
   * @param {() => number} clock  the server's clock
   * @returns {{ key: string, wait: number, run: () => void } | null} null for a room that is not a running tournament
   * Side effects: none; the `run` it returns changes the room.
   */
  function nextAction(room, clock) {
    if (!isRunning(room)) return null;
    const played = room.tournament;
    if (played.opened !== played.round) return { key: `open:${played.round}`, wait: 0, run: () => openRound(room, clock()) };
    const over = played.tables.filter(tableOver).length;
    // The count of tables that are over is part of the key, because the wait depends on it: the last table finishing
    // turns hours of waiting into none, and a timer whose key had not changed would be left to run the hours out.
    if (over === played.tables.length) return { key: `settle:${played.round}:${over}`, wait: 0, run: () => settle(room, clock()) };
    return { key: `give-up:${played.round}:${over}`, wait: Math.max(0, played.due - clock()), run: () => settle(room, clock()) };
  }

  /**
   * Somebody has left the tournament, or been put out of it: they keep their place on the standings for the tables
   * they played, and are taken out of the ones still to come.  A table they would have been the only person at is
   * dropped; one they would have shared is played by whoever is left.
   *
   * The round being played is left alone — those rooms are open and their games are under way.
   *
   * @param {object} room  the tournament
   * @param {number} userId  who has gone
   * @returns {void}
   * Side effects: changes the rounds still to come.
   */
  function withdraw(room, userId) {
    const played = settingOf(room);
    if (!played?.rounds) return;
    const from = played.opened === played.round ? played.round + 1 : played.round;
    for (let round = from; round < played.rounds.length; round++) {
      played.rounds[round] = played.rounds[round].map((ids) => ids.filter((id) => id !== userId)).filter((ids) => ids.length);
    }
  }

  /**
   * Why this room may not be played again, or null.  Neither a tournament nor one of its tables may: the evening is
   * drawn up once and played once, and a table played twice would be counted twice.
   */
  const againRefused = (room) => (settingOf(room) || room?.inTournament ? fail('tournamentNoAgain') : null);

  /** The codes of the rooms this tournament has open or has just finished: who else must be told when it moves on. */
  const tableCodes = (room) => {
    const played = settingOf(room);
    return played ? [...(played.tables ?? []), ...(played.last ?? [])].flatMap((table) => (table.code ? [table.code] : [])) : [];
  };

  /**
   * Why a computer player may not be added, or null when one may.  They are not refused to be awkward: a tournament's
   * computer players sit at its tables, so many to each, and one sitting in the lobby would be a player with nowhere
   * to go.
   * @param {object} room  the room somebody is adding to
   * @returns {{ ok: false, error: string } | null}
   * Side effects: none.
   */
  const botsRefused = (room) => (settingOf(room) ? fail('tournamentNoBots') : null);

  /**
   * What a state of this room carries about its tournament, beside the game's own view: enough for the shared screens
   * to draw the lobby, which no game's own lobby can.
   *
   * A room that is neither a tournament nor in its lobby sends nothing at all, so that a game under way is not made to
   * carry a setting nobody can change in it.
   *
   * @param {object} room  the room being looked at
   * @param {number} userId  who is looking
   * @returns {object | null} `{ on, humans, bots, entrants, tables, limits }`
   * Side effects: none.
   */
  function blockFor(room, userId) {
    if (settingOf(room)) return tournamentBlock(room, userId, null);
    if (room.inTournament) {
      const held = parentOf(room);
      // A table whose tournament has been forgotten says only where it came from: the game itself is still playable,
      // and it is the only thing left to say about it.
      return held && settingOf(held) ? tournamentBlock(held, userId, room.code) : { on: true, parent: room.inTournament.code, lost: true, here: room.code };
    }
    if (room.phase !== 'lobby') return null;
    const playable = limitsOf(room);
    const table = tableOf(room);
    const people = entrants(room);
    return {
      on: false,
      humans: table.humans,
      bots: table.bots,
      size: tableSize(table),
      entrants: entrantViews(room, userId),
      // `tables` is this round's games wherever it appears, and is empty until there is a round; how many the whole
      // evening comes to is `tablesInAll`, which is the number a lobby shows before anybody starts it.
      tables: [],
      tablesInAll: tableCount(people.length, table.humans),
      limits: { min: playable.min, max: playable.max, maxEntrants: MAX_ENTRANTS },
    };
  }

  /**
   * Everybody taking part, as the shared screens draw them.  A person's slot is read off where they are in the
   * room's own list — the seat number in one family, the key they were given in the other — rather than looked up by
   * id, so that this holds for both and asks the layout for nothing it does not keep.
   * @param {object} room  the room (not changed)
   * @param {number} userId  who is looking
   * @returns {object[]}
   * Side effects: none.
   */
  const entrantViews = (room, userId) =>
    members(room).flatMap((member, index) => (isHuman(member) ? [{ id: member.id, name: member.name ?? '', slot: layout.slotOf(member, index), isHost: member.id === room.hostId, isMe: member.id === userId }] : []));

  /**
   * A tournament as everybody in it is shown it, whether they are looking at the tournament itself or sitting at one
   * of its tables.  It is the same block either way, so that one screen can draw the standings and one bar can offer
   * the way back, and `here` says which room the reader is actually in.
   *
   * @param {object} room  the tournament
   * @param {number} userId  who is looking
   * @param {string | null} here  the table they are at, or null when they are looking at the tournament
   * @returns {object}
   * Side effects: none.
   */
  function tournamentBlock(room, userId, here) {
    const played = room.tournament;
    const playable = limitsOf(room);
    // Everybody who entered, by the names taken down at the start: somebody who has left is still on the standings.
    const roster = played.names ? Object.entries(played.names).map(([id, name]) => ({ id: Number(id), name })) : entrants(room).map((person) => ({ id: person.id, name: person.name ?? '' }));
    const mine = (played.tables ?? []).find((table) => table.players.includes(userId));
    return {
      on: true,
      humans: played.humans,
      bots: played.bots,
      size: tableSize(played),
      phase: room.phase,
      parent: room.code,
      here,
      round: (played.round ?? 0) + 1,
      rounds: played.rounds?.length ?? 0,
      entrants: entrantViews(room, userId),
      standings: played.standings ? ranking(played.standings, roster) : [],
      tables: (played.tables ?? []).map((table) => tableView(table, played, userId)),
      last: (played.last ?? []).map((table) => tableView(table, played, userId)),
      // Where this person should be: the table they are drawn to play at this round, once it is open.
      yourTable: mine?.code ?? null,
      tablesInAll: played.rounds ? played.rounds.flat().length : 0,
      limits: { min: playable.min, max: playable.max, maxEntrants: MAX_ENTRANTS },
    };
  }

  /** One table of a round, with the names of whoever is playing at it. */
  const tableView = (table, played, userId) => ({
    code: table.code,
    done: Boolean(table.done),
    ...(table.failed ? { failed: table.failed } : {}),
    yours: table.players.includes(userId),
    players: table.players.map((id) => ({ id, name: played.names?.[id] ?? '' })),
  });

  /**
   * The whole state of a tournament room, drawn here rather than by the game.
   *
   * A tournament lobby holds more people than the game it is a tournament of will ever seat, and a game is entitled to
   * assume otherwise: three of them keep a hand or a tally beside each seat and read it back by seat number while
   * drawing the lobby, which an outsized room has nothing in.  So a room with tournament mode on is never handed to
   * `viewFor` at all — its people are not at a table of this game, and will not be until it opens one for them.
   *
   * @param {object} room  the room being looked at
   * @param {number} userId  who is looking
   * @returns {object | null} the state to send, or null when this room is not a tournament
   * Side effects: none.
   */
  function viewFor(room, userId) {
    if (!settingOf(room)) return null;
    return {
      code: room.code,
      phase: room.phase,
      you: userId,
      hostId: room.hostId,
      isHost: room.hostId === userId,
      settings: room.settings ?? {},
      tournament: blockFor(room, userId),
    };
  }

  return { enabled: true, settingOf, isRunning, setTable, botsRefused, blockFor, viewFor, start, nextAction, parentOf, related, admits, withdraw, againRefused, tableCodes };
}
