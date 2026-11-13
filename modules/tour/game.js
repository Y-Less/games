// The rules of a tour, with no sockets or files.  A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error, params? }, where `error` is a code under `errors.` in the
// game's locale file or the site's (see MODULES.md, Languages).
//
// A tour is not a game: it is a way of deciding which game to play next, and then the one after that.  You make a lobby
// as you would for anything else; starting it opens a vote between three games the people here could actually play, and
// a standing fourth choice to finish.  The winner is opened in its own module and everybody is sent to it; when it ends
// the vote comes round again with a fresh three.
//
// The three are drawn afresh every time and nothing is remembered between votes, so a game played an hour ago can come
// round again — the point is a varied evening, not a syllabus.
//
// Everything about *other* games arrives as a `catalogue`: an array of { id, name, minPlayers, maxPlayers } the server
// reads from ctx.games.list().  These rules never import another module, so they stay pure and a test can hand them any
// catalogue it likes.
//
// Depends on: shared/seats.js (fail, hostInLobby, ok), shared/roster.js (the lobby and player-list rules), and
// shared/messages.js (nothing the client shows is written in English here).
import { textFrom } from '../../shared/input.js';
import { fail, hostInLobby, ok } from '../../shared/seats.js';
import { createRosterRules, defaultPlayers, hasPlayer, humans, isBot, isHuman, migratePlayers, nextGame, seatOf, slotOf, withSlot } from '../../shared/roster.js';
import { END } from './end.js';

// A tour needs two people to be worth voting in; twelve is the most any game here seats, so it is the most a tour can
// hold without the lobby promising games it could never open.
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
/** How many a new tour is for, until the host says otherwise. */
export const DEFAULT_PLAYERS = defaultPlayers(MIN_PLAYERS, MAX_PLAYERS);
/** How many games a vote offers.  Fewer are offered when fewer suit the number of people here. */
export const CHOICES = 3;
export { END };
/** How long a vote stands before the clock settles it with whatever has been cast (ms). */
export const VOTE_MS = 60_000;
/** How long a tour waits for a game it opened before giving up on it and voting again (ms). */
export const GAME_MS = 6 * 60 * 60 * 1000;

/** Names for the computer players, in the order they are used. */
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kit', 'Lux'];
// Phases in which the tour is still going (the lobby included).
const LIVE = ['lobby', 'voting', 'opening', 'playing'];

export { hasPlayer, humans, isBot, isHuman, seatOf, slotOf };

/**
 * Is the tour still going (or still in the lobby)?
 * @param {object} room
 * @returns {boolean} false once it has finished
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);

/**
 * The bare player as this game keeps one.  A tour counts nothing, so a player is only who they are.
 * @param {object} room  unused; part of the shared makePlayer contract
 * @param {object} base  { kind: 'human' | 'bot', id, name? }
 * @returns {object} the player
 * Side effects: none.
 */
const makePlayer = (room, base) => ({ ...base });

/**
 * A new tour room, in the lobby, with the host in it.
 *
 * @param {object} args
 * @param {string} args.code  the invite code
 * @param {number} args.hostId  the host's account id
 * @param {string} [args.hostName]  their display name
 * @param {object} [args.settings]  none are accepted yet; taken for the shape every game's createRoom has
 * @param {number} args.now  the time to stamp it with
 * @returns {object} the room
 * Side effects: none outside the new room.
 */
export function createRoom({ code, hostId, hostName, settings = {}, now }) {
  const room = {
    code,
    hostId,
    phase: 'lobby',
    players: [],
    size: MAX_PLAYERS, // the most who may join; the host may set it lower, and starting settles it
    nextIdx: 0,
    nextBot: 1,
    choices: [], // the game ids on offer in the vote running now
    votes: {}, // slot -> a game id, or END
    until: 0, // when the vote running now stops counting
    current: null, // { game, code }: the game being played elsewhere, while one is
    chosen: null, // what the vote just settled on, while the server is opening it (a restart reads this)
    played: [], // [{ game, code }] every game this tour has played, oldest first
    trouble: null, // an error code from the last game that could not be opened, shown once
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
  room.players.push(withSlot(room, makePlayer(room, typeof hostName === 'string' ? { kind: 'human', id: hostId, name: hostName } : { kind: 'human', id: hostId })));
  return room;
}

/**
 * The lobby, joining, leaving and computer-player rules, from shared/roster.js.  A tour holds nothing that belongs to
 * a player, so somebody leaving and a computer player taking their place needs no hook either way.
 * Side effects: each rule it provides mutates the room's player list.
 */
const roster = createRosterRules({ isLive, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, botNames: BOT_NAMES, makePlayer });
export const { addHuman, removeHuman, addBot, removeBot, fillWithBots, kick, setSize, sizeOf, lockSize } = roster;

/**
 * A tour has no settings of its own: what is played is voted on, not chosen in the lobby.
 * @param {object} room  unused
 * @param {number} id  unused
 * @returns {{ ok: boolean, error?: string }} always a refusal
 * Side effects: none.
 */
export const setSettings = () => fail('noSettings');

/**
 * The games this many people could actually sit down to, in catalogue order.
 *
 * @param {{ id: string, name: string, minPlayers: number, maxPlayers: number }[]} catalogue  the other modules
 * @param {number} players  how many are in the tour
 * @returns {object[]} the ones that hold exactly this many
 * Side effects: none.
 */
export const playable = (catalogue, players) => catalogue.filter((game) => players >= game.minPlayers && players <= game.maxPlayers);

/**
 * Picks the games a vote offers: up to CHOICES of them, drawn at random from everything these people could play.
 *
 * Nothing is remembered between votes.  A game played earlier in the tour is as likely as any other, because the three
 * are the whole of the offer and leaving out what has been played would, in a short catalogue, make the last vote of an
 * evening a formality.
 *
 * @param {object[]} pool  what is playable (from `playable`)
 * @param {() => number} rng  random numbers (required: the server's, so a test can replay a tour)
 * @returns {string[]} the chosen ids, distinct, at most CHOICES of them
 * Side effects: none beyond advancing `rng`.
 */
export function drawChoices(pool, rng) {
  const left = [...pool];
  const chosen = [];
  while (chosen.length < CHOICES && left.length) chosen.push(left.splice(Math.floor(rng() * left.length), 1)[0].id);
  return chosen;
}

/**
 * Opens a vote: a fresh three, nobody having voted yet, and a clock.
 * @param {object} room  mutated
 * @param {object[]} catalogue  the other modules
 * @param {() => number} rng  random numbers
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: sets phase, choices, votes and until.
 */
function openVote(room, catalogue, rng, now) {
  room.phase = 'voting';
  room.choices = drawChoices(playable(catalogue, room.players.length), rng);
  room.votes = {};
  room.until = now + VOTE_MS;
  room.current = null;
  room.chosen = null;
}

/**
 * The host starts the tour: the lobby settles at whoever is here and the first vote opens.
 *
 * @param {object} room  mutated when it works
 * @param {number} userId  who is asking (must be the host)
 * @param {() => number} rng  random numbers
 * @param {number} now  the clock
 * @param {object[]} [catalogue]  the other modules, from ctx.games.list()
 * @returns {{ ok: boolean, error?: string, params?: object }}
 * Side effects: settles the size, then opens the first vote.
 */
export function start(room, userId, rng, now, catalogue = []) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  // Every refusal is answered before the lobby is settled, so a start that does not happen leaves it exactly as it was.
  if (room.players.length < MIN_PLAYERS) return fail('minPlayers', { min: MIN_PLAYERS });
  if (!humans(room).length) return fail('needPerson');
  if (!playable(catalogue, room.players.length).length) return fail('noGamesForThisMany', { count: room.players.length });
  lockSize(room);
  room.played = [];
  room.trouble = null;
  openVote(room, catalogue, rng, now);
  return ok();
}

/**
 * Somebody votes for one of the games on offer, or to finish.  Voting again changes your vote.
 *
 * @param {object} room  mutated when it works
 * @param {number | string} id  the player voting (an account id, or a computer player's id)
 * @param {unknown} choice  a game id from `room.choices`, or END
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: records the vote against the player's slot.
 */
export function vote(room, id, choice) {
  if (room.phase !== 'voting') return fail('notVoting');
  const slot = slotOf(room, id);
  if (slot === -1) return fail('notInThisTour');
  const wanted = textFrom(choice);
  if (wanted !== END && !room.choices.includes(wanted)) return fail('notOnOffer');
  room.votes[slot] = wanted;
  return ok();
}

/**
 * Has everybody in the tour voted?
 * @param {object} room
 * @returns {boolean}
 * Side effects: none.
 */
export const everybodyVoted = (room) => room.players.every((player) => room.votes[player.slot] !== undefined);

/**
 * Who won the vote: the choice with the most votes, ties broken at random.  A vote nobody answered is a vote for
 * carrying on, so it falls to the games rather than to finishing.
 *
 * @param {object} room  not changed
 * @param {() => number} rng  random numbers (required)
 * @returns {string} a game id, or END
 * Side effects: none beyond advancing `rng`.
 */
export function winnerOf(room, rng) {
  const cast = Object.values(room.votes);
  const options = [...room.choices, END];
  const tally = options.map((option) => ({ option, count: cast.filter((v) => v === option).length }));
  const most = Math.max(...tally.map((t) => t.count));
  // Nobody voted at all: the tour carries on with one of the games rather than ending by default.
  const leaders = most === 0 ? room.choices : tally.filter((t) => t.count === most).map((t) => t.option);
  return leaders[Math.floor(rng() * leaders.length)];
}

/**
 * Closes the vote and says what won.  The room moves to `opening` so that it cannot be voted on twice while the server
 * is busy opening the game; the server then calls `playing` or `finish`.
 *
 * @param {object} room  mutated
 * @param {() => number} rng  random numbers
 * @returns {{ ok: boolean, error?: string, choice?: string }} `choice` is a game id or END
 * Side effects: sets phase to 'opening' and clears the clock.
 */
export function settle(room, rng) {
  if (room.phase !== 'voting') return fail('notVoting');
  const choice = winnerOf(room, rng);
  room.phase = 'opening';
  room.chosen = choice; // kept on the room, so a restart between the vote and the opening knows what won
  room.until = 0;
  return ok({ choice });
}

/**
 * The server has opened the chosen game: everybody is on their way to it.
 *
 * @param {object} room  mutated
 * @param {string} game  the module id
 * @param {string} code  the new room's invite code
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets phase 'playing', `current`, and the clock the tour gives up on the game after.
 */
export function playing(room, game, code, now) {
  if (room.phase !== 'opening') return fail('notOpening');
  room.current = { game, code };
  room.played.push({ game, code });
  room.phase = 'playing';
  room.until = now + GAME_MS;
  room.trouble = null;
  room.chosen = null;
  // The vote is over and has been acted on.  Clearing it here rather than when the next one opens keeps a finished
  // vote from riding along in the view for as long as the game lasts, and from being mistaken for a running one.
  room.choices = [];
  room.votes = {};
  return ok();
}

/**
 * The chosen game would not open.  The tour says so and votes again rather than stopping: a game that refuses is the
 * site's problem, not a reason to end everybody's evening.
 *
 * @param {object} room  mutated
 * @param {string} error  the refusal's code, shown once
 * @param {object[]} catalogue  the other modules
 * @param {() => number} rng  random numbers
 * @param {number} now  the clock
 * @returns {{ ok: boolean }}
 * Side effects: opens a fresh vote and sets `trouble`.
 */
export function openingFailed(room, error, catalogue, rng, now) {
  openVote(room, catalogue, rng, now);
  room.trouble = error;
  return ok();
}

/**
 * The game the tour sent everybody to has ended (or the tour has waited long enough for it): back to the vote.
 *
 * @param {object} room  mutated
 * @param {object[]} catalogue  the other modules
 * @param {() => number} rng  random numbers
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: opens a fresh vote.
 */
export function gameOver(room, catalogue, rng, now) {
  if (room.phase !== 'playing') return fail('notPlaying');
  openVote(room, catalogue, rng, now);
  return ok();
}

/**
 * The tour is over, by vote.
 * @param {object} room  mutated
 * @returns {{ ok: boolean }}
 * Side effects: sets phase 'finished' and clears the vote.
 */
export function finish(room) {
  room.phase = 'finished';
  room.choices = [];
  room.votes = {};
  room.until = 0;
  room.current = null;
  return ok();
}

/**
 * The host takes a finished tour back to the lobby to run another.
 *
 * @param {object} room  mutated when it works
 * @param {number} userId  who is asking (must be the host)
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: resets the tour and advances the room's game counter.
 */
export function playAgain(room, userId) {
  if (userId !== room.hostId) return fail('hostOnlyAgain');
  if (room.phase !== 'finished') return fail('notFinished');
  nextGame(room);
  room.phase = 'lobby';
  room.played = [];
  room.choices = [];
  room.votes = {};
  room.until = 0;
  room.current = null;
  room.trouble = null;
  room.recorded = false;
  return ok();
}

/**
 * A tour records no statistics: it plays no game itself, and the games it opens each record their own.
 * @returns {object[]} always empty, which the site reads as nothing to record
 * Side effects: none.
 */
export const statsPlayers = () => [];

/**
 * Brings a saved tour up to date.
 * @param {object} room  the room as it was saved
 * @param {(id: number) => string} [nameOf]  looks a player's current display name up
 * @returns {object} the room
 * Side effects: mutates the room it is given.
 */
export function migrate(room, nameOf) {
  migratePlayers(room, nameOf, { minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS });
  room.choices ??= [];
  room.votes ??= {};
  room.played ??= [];
  room.until ??= 0;
  room.current ??= null;
  room.chosen ??= null;
  room.trouble ??= null;
  return room;
}

/**
 * What one person may see of a tour.  Everything here is public: a tour has no hidden hands, and a vote is open so
 * that people can argue about it.
 *
 * @param {object} room  not changed
 * @param {number} userId  who is looking
 * @param {object} [options]
 * @param {(id: number) => string} [options.nameOf]  a player's current display name
 * @param {(id: number) => boolean} [options.online]  whether a player is connected
 * @param {object[]} [options.catalogue]  the other modules, so the vote can show their names
 * @returns {object} the view
 * Side effects: none.
 */
export function viewFor(room, userId, { nameOf = String, online = () => true, catalogue = [] } = {}) {
  const me = slotOf(room, userId);
  // Only the id and the name: what a game holds and who wrote it is the menu's business, not the vote's.
  const named = (id) => ({ id, name: catalogue.find((game) => game.id === id)?.name ?? id });
  return {
    phase: room.phase,
    code: room.code,
    // `you` and `hostId` are account ids, not slots: that is what the shared lobby panel compares players by.
    you: userId,
    hostId: room.hostId,
    isHost: userId === room.hostId,
    size: sizeOf(room),
    min: MIN_PLAYERS,
    max: MAX_PLAYERS,
    fillTo: DEFAULT_PLAYERS,
    // How many games this many people could be offered.  The lobby says so before anybody commits to starting, and
    // the client never sees the catalogue itself.
    suitable: playable(catalogue, room.players.length).length,
    players: room.players.map((player) => ({
      slot: player.slot,
      id: player.id,
      userId: isHuman(player) ? player.id : null,
      name: isHuman(player) ? (nameOf(player.id) ?? player.name) : player.name,
      bot: isBot(player),
      online: isBot(player) || online(player.id),
      voted: room.votes[player.slot] !== undefined,
    })),
    // The vote: what is on offer, who has voted for what, and what you chose.
    choices: room.choices.map((id) => ({ ...named(id), votes: Object.values(room.votes).filter((v) => v === id).length })),
    endVotes: Object.values(room.votes).filter((v) => v === END).length,
    yourVote: room.votes[me] ?? null,
    until: room.phase === 'voting' ? room.until : 0,
    // The game being played now, and the ones this tour has already played.
    current: room.current ? { ...room.current, name: named(room.current.game).name } : null,
    played: room.played.map((entry) => ({ ...entry, name: named(entry.game).name })),
    trouble: room.trouble,
  };
}
