// The rules of Cribbage as pure functions over a plain, JSON-friendly room object (no sockets, no files).
// Seats are numbered in clockwise order from 0. The room has exactly `seats.length` seats (2 to 5), and each holds
//   null                                        an empty seat (lobby only),
//   { kind: 'human', id: <account id>, name }   a person,
//   { kind: 'bot', id: 'bot:<n>', name, ai }    a computer player (`replaced: true` when it took over from a person),
//   { kind: 'gone', id: null, name }            a person who left after the game ended (kept so the final scores make sense).
// Every occupied seat also carries this game's own fields: score, back (the back peg), ready, discarded and stats.
// The join / leave / kick / computer-player rules are the shared ones (shared/seats.js); this file adds what is
// particular to Cribbage. Functions that can fail return { ok: false, error }; the rest return { ok: true, ... }.
//
// Depends on shared/ (cards, ai, moveLog, scores, seats, tally), ./ai (computer players), ./scoring.js (counting) and ./tally.js.
import { fullDeck, isCard, rankOf, shuffle } from '../../shared/cards.js';
import { AIS } from './ai/index.js';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { addMove, recentMoves } from '../../shared/moveLog.js';
import { placements, seatScoreboardEntry } from '../../shared/scores.js';
import { botSeats, createSeatRules, emptySeats, fail, hasPlayer, hostInLobby, humanSeats, isBot, isHuman, ok, seatOf, asHost } from '../../shared/seats.js';
import { bump, extrasOf, statsRows } from '../../shared/tally.js';
import { HEELS_POINTS, pipValue, scoreHand, scorePlay } from './scoring.js';
import { newTally, STAT_KEYS, tallyDeal, tallyDiscard, tallyShown } from './tally.js';

export const TARGETS = [61, 121];
export const MIN_SEATS = 2;
export const MAX_SEATS = 5;
export const DEFAULT_SEATS = 2;
export const MAX_NAME_LENGTH = 24;
/** Names the shared seat rules hand out to computer players. */
export const BOT_NAMES = ['Robin', 'Sam', 'Jo', 'Max', 'Kit', 'Lee', 'Pat', 'Ash', 'Bea', 'Fen'];
/** A winner "skunks" an opponent who finishes below this (by target score): a statistic only, it changes no points. */
export const SKUNK_LINE = { 61: 31, 121: 91 };
/** How many lines of the move log are kept (the view shows fewer). */
const LOG_LIMIT = 60;

export { hasPlayer, humanSeats, isBot, isHuman, seatOf };

/**
 * Cards each player is dealt, how many of them go to the box, and how many extra cards the deck adds to the box.
 * With five players the dealer is dealt only four cards and adds nothing to the box: the others' discards make it.
 *
 * @param {number} players      how many seats there are (2 to 5)
 * @param {boolean} [isDealer]  whether the player in question is the dealer (matters with five players)
 * @returns {{ dealt: number, discards: number, extraToCrib: number }}
 * Side effects: none.
 */
export const dealRules = (players, isDealer = false) => {
  const dealerLight = players === 5 && isDealer;
  return { dealt: players === 2 ? 6 : dealerLight ? 4 : 5, discards: players === 2 ? 2 : dealerLight ? 0 : 1, extraToCrib: players === 3 ? 1 : 0 };
};

/** Rank order for sorting hands (ace low, as in runs). */
const PIPS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
/** Sort comparator: rank first, then suit letter so the order is stable and predictable. */
const byRank = (a, b) => PIPS.indexOf(rankOf(a)) - PIPS.indexOf(rankOf(b)) || a.slice(-1).localeCompare(b.slice(-1));
/**
 * A copy of the cards in rank order (suits break ties).
 *
 * @param {string[]} cards  card codes; not changed
 * @returns {string[]} the sorted copy
 * Side effects: none.
 */
export const sortCards = (cards) => [...cards].sort(byRank);

/** The message for a seat count outside MIN_SEATS to MAX_SEATS. */
const seatsProblem = `A game has ${MIN_SEATS} to ${MAX_SEATS} seats.`;

/**
 * The fields every occupied seat carries for this game, all at their starting values.
 *
 * @returns {{ score: number, back: number, ready: boolean, discarded: boolean, stats: object }} a fresh object each call
 * Side effects: none.
 */
const gameFields = () => ({ score: 0, back: 0, ready: false, discarded: false, stats: newTally() });

/**
 * A seat with this game's fields added if it does not have them yet (a seat the shared rules just made).
 *
 * @param {object | null} seat
 * @returns {object | null} the same seat if it already has them, otherwise a new object
 * Side effects: none (the seat is not changed).
 */
const withGameFields = (seat) => (seat && seat.score === undefined ? { ...gameFields(), ...seat } : seat);

/**
 * Tidies a name a person typed: whitespace collapsed, trimmed, cut to MAX_NAME_LENGTH, "Player" if nothing is left.
 *
 * @param {unknown} raw
 * @returns {string}
 * Side effects: none.
 */
const cleanName = (raw) => String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) || 'Player';

/**
 * A name nobody else at the table has (ignoring capital letters), never longer than MAX_NAME_LENGTH: "Ann" becomes
 * "Ann (2)" if "ann" is taken, and a long name is shortened to make room for the number.
 *
 * @param {object} room
 * @param {unknown} raw  what the person typed
 * @returns {string}
 * @returns {string} a name unique at the table
 * Side effects: none.
 */
function fitName(room, raw) {
  const base = cleanName(raw);
  // Case-insensitive, so "ann" cannot sit beside "Ann".
  const taken = (name) => room.seats.some((s) => s && s.name.toLowerCase() === name.toLowerCase());
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? '' : ` (${n})`;
    const name = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken(name)) return name;
  }
  return base;
}

/**
 * Creates a room in the lobby with its host seated.
 *
 * @param {object} args
 * @param {string} args.code        the invite code
 * @param {number} args.hostId      the host's account id
 * @param {string} args.hostName    the host's display name
 * @param {{ target?: number, seats?: number }} [args.settings]  how far to play (61 or 121) and how many seats (2 to 5)
 * @param {number} args.now       the clock, in milliseconds
 * @returns {object} the new room
 * @throws {Error} with a message for the person if a setting is not allowed
 * Side effects: none outside the room it builds.
 */
export function createRoom({ code, hostId, hostName, settings = {}, now }) {
  const { target = 121, seats: count = DEFAULT_SEATS } = settings;
  if (!TARGETS.includes(target)) throw new Error('Play to 61 or 121.');
  if (!Number.isInteger(count) || count < MIN_SEATS || count > MAX_SEATS) throw new Error(seatsProblem);
  return {
    code,
    hostId,
    target,
    phase: 'lobby',
    seats: [{ kind: 'human', id: hostId, name: cleanName(hostName), ...gameFields() }, ...emptySeats(count - 1)],
    nextBot: 1,
    dealer: 0,
    handNo: 0,
    deck: [],
    hands: [],
    kept: [],
    crib: [],
    starter: null,
    play: null,
    show: null,
    log: [],
    history: [],
    handDeltas: {},
    winner: null,
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Is the game still going (or yet to start)? A finished game is not resumed and is thrown away sooner.
 *
 * @param {object} room
 * @returns {boolean}
 * Side effects: none.
 */
export const isLive = (room) => room.phase !== 'finished';

/**
 * Brings a room saved in the old shape up to date when the server loads it. The old shape had seats as a packed list of
 * { userId, bot, botId, left, ... } (no empty seats), `seatCount` and `botsMade`. Rooms already in the new shape are
 * returned untouched, so this is safe to run on every load.
 *
 * Side effects: mutates and returns the room it is given.
 *
 * @param {object} room  a room as read from rooms.json
 * @returns {object} the same room, in the current shape
 */
export function migrate(room) {
  const old = room.seatCount !== undefined || room.botsMade !== undefined || room.seats.some((s) => s && s.kind === undefined);
  if (!old) return room;
  room.seats = room.seats.map((s) => {
    if (!s || s.kind) return s;
    const { userId, bot, botId, left, ...rest } = s;
    if (left) return { ...rest, kind: 'gone', id: null };
    if (bot) return { ...rest, kind: 'bot', id: botId ?? `bot:${(room.botsMade ?? 0) + 1}` };
    return { ...rest, kind: 'human', id: userId };
  });
  const count = Math.min(MAX_SEATS, Math.max(MIN_SEATS, room.seatCount ?? room.seats.length));
  while (room.seats.length < count) room.seats.push(null);
  room.nextBot ??= (room.botsMade ?? 0) + 1;
  delete room.seatCount;
  delete room.botsMade;
  return room;
}

// ---- seats and settings ----

/**
 * The seat rules (join, leave, kick, computer players) are the shared ones. In Cribbage a person who leaves in the
 * middle of a game is replaced by a computer player that keeps their name, pegs and cards and gets an AI of its own;
 * a person who leaves after the game is kept as a 'gone' marker so the scores still make sense; and if they were the
 * only person the show was waiting for, the next hand is dealt.
 * Side effects: none at definition; the returned rules mutate the room they are given.
 */
const seats = createSeatRules({
  isMidGame: (room) => ['discard', 'play', 'show'].includes(room.phase),
  botNames: BOT_NAMES,
  // The computer player keeps everything about the seat except who is sitting in it.
  takeOver: (room, bot, seat, rng) => ({ ...room.seats[seat], kind: 'bot', id: bot.id, replaced: true, ai: pickAI(AIS, rng).id }),
  finishedSeat: (seat) => ({ ...seat, kind: 'gone', id: null }),
  afterRemoval: (room, rng) => advanceIfReady(room, rng),
});
export const { removeHuman, removeBot, kick } = seats;

/**
 * Seats a person (see the shared addHuman) and gives their seat this game's fields.
 *
 * Side effects: may fill an empty seat in the room.
 *
 * @param {object} room
 * @param {number} userId  the account id
 * @param {string} name    the name they would like
 * @returns {{ ok: boolean, seat?: number, error?: string }}
 */
export function addHuman(room, userId, name) {
  const added = seats.addHuman(room, userId, fitName(room, name));
  if (added.ok) room.seats[added.seat] = withGameFields(room.seats[added.seat]);
  return added;
}

/**
 * The host puts a computer player in a seat (see the shared addBot); it is given this game's fields.
 *
 * Side effects: may fill an empty seat in the room.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {number} [seat]  the seat to use (default: the first empty one)
 * @returns {{ ok: boolean, seat?: number, error?: string }}
 */
export function addBot(room, userId, seat) {
  const added = seats.addBot(room, userId, seat);
  if (added.ok) room.seats[added.seat] = withGameFields(room.seats[added.seat]);
  return added;
}

/**
 * The host fills every empty seat with a computer player, each given this game's fields.
 *
 * Side effects: fills the empty seats of the room.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @returns {{ ok: boolean, error?: string }}
 */
export function fillWithBots(room, userId) {
  const filled = seats.fillWithBots(room, userId);
  if (filled.ok) room.seats = room.seats.map(withGameFields);
  return filled;
}

/**
 * The host changes how far to play and/or how many seats there are. Lobby only.
 *
 * Side effects: may change the room's target and grow or shrink its seats (shrinking closes up gaps if it has to).
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {{ target?: number, seats?: number }} settings  whatever the client sent
 * @returns {{ ok: boolean, error?: string }}
 */
export function setSettings(room, userId, { target, seats: count } = {}) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (target !== undefined && !TARGETS.includes(target)) return fail('Play to 61 or 121.');
  if (count !== undefined) {
    if (!Number.isInteger(count) || count < MIN_SEATS || count > MAX_SEATS) return fail(seatsProblem);
    if (count < room.seats.filter(Boolean).length) return fail('Remove a player first: that would leave too few seats.');
    if (count < room.seats.length && room.seats.slice(count).some(Boolean)) room.seats = room.seats.filter(Boolean);
    room.seats = [...room.seats.slice(0, count), ...emptySeats(Math.max(0, count - room.seats.length))];
  }
  if (target !== undefined) room.target = target;
  return ok();
}

// ---- scoring and the log ----

/**
 * Adds a line to the room's log (the "Recent moves" box), keeping only the latest LOG_LIMIT lines.
 *
 * Side effects: appends to room.log and may trim it.
 *
 * @param {object} room
 * @param {number} seat    who the line is about
 * @param {string} text    what happened
 * @param {number} [points]  points scored by it (0 for none)
 * @returns {void}
 */
function log(room, seat, text, points = 0) {
  addMove(room, { seat, text, points }, LOG_LIMIT);
}

/**
 * Closes the hand's entry in the history: what each seat scored in it (pegging, heels, hands and box).
 *
 * Side effects: appends to room.history and clears room.handDeltas.
 *
 * @param {object} room
 * @returns {void}
 */
function commitHand(room) {
  room.history.push({ label: `Hand ${room.handNo}`, deltas: room.handDeltas });
  room.handDeltas = {};
}

/**
 * Ends the game with this seat as the winner.
 *
 * Side effects: sets the phase to 'finished', records the winner, clears the play and closes the hand's history entry.
 *
 * @param {object} room
 * @param {number} seat  the winning seat
 * @returns {void}
 */
function finish(room, seat) {
  room.phase = 'finished';
  room.winner = seat;
  room.play = null;
  commitHand(room);
}

/**
 * Pegs points for a seat. The back peg moves to where the front peg was; the game ends the moment the target is
 * reached, and any remaining entries are not scored.
 *
 * Side effects: changes the seat's score, back peg and tally, the hand's deltas and the log, and may finish the game.
 *
 * @param {object} room
 * @param {number} seat  who scores
 * @param {{ label: string, points: number }[]} entries  what they score, in order
 * @param {{ pegging?: boolean, quiet?: boolean }} [options]  `pegging` counts the points as pegged in the play; `quiet` leaves them out of the log
 * @returns {void}
 */
function award(room, seat, entries, { pegging = false, quiet = false } = {}) {
  const s = room.seats[seat];
  s.back = s.score;
  for (const entry of entries) {
    if (room.phase === 'finished' || entry.points <= 0) continue;
    const before = s.score;
    s.score = Math.min(room.target, s.score + entry.points);
    room.handDeltas[seat] = (room.handDeltas[seat] ?? 0) + s.score - before;
    if (pegging) bump(s.stats, 'pegPoints', entry.points);
    if (!quiet) log(room, seat, `${s.name}: ${entry.label.toLowerCase()} for ${entry.points}`, entry.points);
    if (s.score >= room.target) finish(room, seat);
  }
}

// ---- dealing ----

/**
 * Deals a new hand: shuffles, deals each seat its cards, sets the box aside and starts the discard phase.
 *
 * Side effects: replaces the deck, hands, box and per-hand state, bumps room.handNo and every seat's handsPlayed tally,
 * and resets each seat's ready / discarded flags. Uses rng for the shuffle.
 *
 * @param {object} room
 * @param {() => number} rng
 * @returns {void}
 */
function deal(room, rng) {
  const { extraToCrib } = dealRules(room.seats.length);
  room.deck = shuffle(fullDeck(), rng);
  room.hands = room.seats.map((_, i) => sortCards(room.deck.splice(0, dealRules(room.seats.length, i === room.dealer).dealt)));
  room.crib = room.deck.splice(0, extraToCrib);
  room.kept = [];
  room.starter = null;
  room.play = null;
  room.show = null;
  room.log = [];
  room.handDeltas = {};
  room.handNo++;
  room.phase = 'discard';
  for (const s of room.seats) {
    s.ready = false;
    // A seat with nothing to discard (the dealer at five players) counts as already done, so the phase does not wait for it.
    s.discarded = dealRules(room.seats.length, room.seats.indexOf(s) === room.dealer).discards === 0; // nothing to discard
    bump(s.stats, 'handsPlayed');
  }
}

/**
 * The host starts the game: every seat must be filled and at least one must be a person. The pegs go back to the start,
 * a dealer is chosen at random, the first hand is dealt and each computer player picks its AI.
 *
 * Side effects: mutates the room (deals, assigns AIs); uses rng for the dealer, the shuffle and the AIs.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 */
export function start(room, userId, rng) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('Fill every seat first (add computer players if you like).');
  if (!humanSeats(room).length) return fail('At least one person must play.');
  for (const s of room.seats) Object.assign(s, { score: 0, back: 0 });
  room.winner = null;
  room.handNo = 0;
  room.history = [];
  room.handDeltas = {};
  room.dealer = Math.floor(rng() * room.seats.length);
  deal(room, rng);
  assignBotAIs(room, rng);
  return ok();
}

/**
 * Every computer player picks the AI it will play this game with (kept on the seat, so it survives a restart).
 *
 * Side effects: sets `ai` on the computer players' seats and removes it from everyone else's.
 *
 * @param {object} room
 * @param {() => number} rng  the game's random numbers
 * @returns {void}
 */
function assignBotAIs(room, rng) {
  const bots = botSeats(room);
  const chosen = assignAIs(AIS, bots, rng);
  room.seats.forEach((s, i) => {
    if (isBot(s)) s.ai = chosen[i];
    else delete s.ai;
  });
}

/**
 * From the finished game back to the lobby ("play again"), with the same people and computer players in the same seats.
 * People who had already left the finished game are gone, so their seats are empty.
 *
 * Side effects: resets the room (pegs, tallies, hands, history) and puts it back in the lobby.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @returns {{ ok: boolean, error?: string }}
 */
export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over yet.');
  room.seats = room.seats.map((s) => (isHuman(s) || isBot(s) ? s : null));
  for (const s of room.seats.filter(Boolean)) {
    Object.assign(s, gameFields());
    delete s.ai;
  }
  Object.assign(room, { phase: 'lobby', winner: null, recorded: false, hands: [], kept: [], crib: [], deck: [], starter: null, play: null, show: null, log: [], history: [], handDeltas: {}, handNo: 0 });
  return ok();
}

/**
 * A seat puts its discards into the box. When every seat has discarded, the starter is cut and the play begins.
 *
 * Side effects: moves the cards from the hand to the box, updates the tally, and may begin the play (using rng for the cut).
 *
 * @param {object} room
 * @param {number} seat      who is discarding
 * @param {string[]} cards   the cards to give to the box
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 */
export function discard(room, seat, cards, rng) {
  if (room.phase !== 'discard') return fail('It is not time to discard.');
  const s = room.seats[seat];
  const { discards } = dealRules(room.seats.length, seat === room.dealer);
  if (s.discarded) return fail('You have already discarded.');
  if (!Array.isArray(cards) || cards.length !== discards) return fail(`Choose ${discards} card${discards === 1 ? '' : 's'} for the box.`);
  if (!cards.every(isCard) || new Set(cards).size !== cards.length || !cards.every((c) => room.hands[seat].includes(c))) return fail('Those cards are not in your hand.');
  room.hands[seat] = room.hands[seat].filter((c) => !cards.includes(c));
  room.crib.push(...cards);
  tallyDiscard(s.stats, cards, seat === room.dealer);
  s.discarded = true;
  if (room.seats.every((x) => x.discarded)) beginPlay(room, rng);
  return ok();
}

/**
 * Cuts the starter and starts the play (pegging). Turning up a jack scores two for the dealer ("his heels").
 *
 * Side effects: sorts the box, snapshots the kept hands, takes the starter from the deck, sets the phase to 'play' and may score.
 *
 * @param {object} room
 * @param {() => number} rng  chooses where the deck is cut
 * @returns {void}
 */
function beginPlay(room, rng) {
  room.crib = sortCards(room.crib);
  room.kept = room.hands.map((h) => [...h]);
  room.starter = room.deck.splice(Math.floor(rng() * room.deck.length), 1)[0];
  room.phase = 'play';
  room.play = { count: 0, sequence: [], turn: (room.dealer + 1) % room.seats.length, last: null, said: [], previous: [] };
  if (rankOf(room.starter) === 'J') award(room, room.dealer, [{ label: 'His heels', points: HEELS_POINTS }]);
}

// ---- the play (pegging) ----

/**
 * Does this seat still hold any cards in the play?
 *
 * @param {object} room  not changed
 * @param {number} seat  the seat to check
 * @returns {boolean} true when it has at least one card
 * Side effects: none.
 */
const hasCards = (room, seat) => room.hands[seat].length > 0;

/**
 * The cards a seat could play now without taking the count over 31.
 *
 * @param {object} room
 * @param {number} seat
 * @returns {string[]} empty outside the play
 * Side effects: none.
 */
export const playableCards = (room, seat) => (room.play ? room.hands[seat].filter((c) => room.play.count + pipValue(c) <= 31) : []);

/**
 * Starts a new count: the cards played so far are remembered as "previous" and the count goes back to zero.
 *
 * Side effects: mutates room.play.
 *
 * @param {object} room
 * @returns {void}
 */
function resetSequence(room) {
  const p = room.play;
  p.previous = p.sequence.map((x) => x.card);
  Object.assign(p, { count: 0, sequence: [], said: [], last: null });
}

/**
 * A seat plays a card in the pegging. It is scored, and the turn passes on (or the play or game ends).
 *
 * Side effects: moves the card from the hand to the sequence, scores points, and may end the play or the game.
 *
 * @param {object} room
 * @param {number} seat    who is playing
 * @param {string} card    the card to play
 * @returns {{ ok: boolean, error?: string }}
 */
export function playCard(room, seat, card) {
  if (room.phase !== 'play') return fail('It is not time to play a card.');
  const p = room.play;
  if (p.turn !== seat) return fail('It is not your turn.');
  if (!isCard(card) || !room.hands[seat].includes(card)) return fail('That card is not in your hand.');
  if (p.count + pipValue(card) > 31) return fail('That would take the count over 31.');
  room.hands[seat] = room.hands[seat].filter((c) => c !== card);
  p.sequence.push({ seat, card });
  p.count += pipValue(card);
  p.last = seat;
  award(room, seat, scorePlay(p.sequence.map((x) => x.card)).items, { pegging: true });
  if (room.phase !== 'finished') afterPlay(room, seat);
  return ok();
}

/**
 * Decides who plays next after `from` played: a player with no playable card says go, and the play ends when due.
 *
 * Side effects: changes the turn, logs "go", scores go / last card, resets the count, and may start the show.
 *
 * @param {object} room
 * @param {number} from  the seat that has just played
 * @returns {void}
 */
function afterPlay(room, from) {
  const p = room.play;
  const n = room.seats.length;

  // Thirty-one already scored its two in playCard, and nobody gets a go for it: just start a new count.
  if (p.count === 31) {
    resetSequence(room);
  } else {
    for (let k = 1; k <= n; k++) {
      const seat = (from + k) % n;
      if (!hasCards(room, seat)) continue;
      if (playableCards(room, seat).length) {
        p.turn = seat;
        return;
      }
      if (!p.said.includes(seat) && seat !== p.last) {
        p.said.push(seat);
        log(room, seat, `${room.seats[seat].name}: go`);
      }
    }
    // Nobody can play: the last to play pegs one for go, or for the last card if every hand is now empty.
    const anyLeft = room.seats.some((_, seat) => hasCards(room, seat));
    award(room, p.last, [{ label: anyLeft ? 'Go' : 'Last card', points: 1 }], { pegging: true });
    if (room.phase === 'finished') return;
    resetSequence(room);
  }
  // After a new count, play resumes with the next seat that has cards; if none has, the play is over.
  for (let k = 1; k <= n; k++) {
    const seat = (from + k) % n;
    if (hasCards(room, seat)) {
      p.turn = seat;
      return;
    }
  }
  startShow(room);
}

// ---- the show ----

/**
 * Counts every hand, then the box, in the order the rules give (left of the dealer first, the dealer's box last).
 *
 * Side effects: sets the phase to 'show', fills room.show, scores each hand, updates tallies and may finish the game.
 *
 * @param {object} room
 * @returns {void}
 */
function startShow(room) {
  const n = room.seats.length;
  const order = Array.from({ length: n }, (_, k) => ({ kind: 'hand', seat: (room.dealer + 1 + k) % n }));
  order.push({ kind: 'crib', seat: room.dealer });
  room.phase = 'show';
  room.play = null;
  room.show = { entries: [] };
  for (const { kind, seat } of order) {
    const cards = kind === 'crib' ? room.crib : room.kept[seat];
    const { total, items } = scoreHand(cards, room.starter, { crib: kind === 'crib' });
    const heels = seat === room.dealer && rankOf(room.starter) === 'J' ? HEELS_POINTS : 0; // the dealer's heels come with their hand and box
    tallyShown(room.seats[seat].stats, kind, { total, items }, heels);
    award(room, seat, [{ label: kind, points: total }], { quiet: true });
    room.show.entries.push({ kind, seat, cards, items, total, after: room.seats[seat].score });
    if (room.phase === 'finished') return;
  }
  tallyDeal(room.seats[room.dealer].stats, room.handDeltas[room.dealer] ?? 0); // only the dealer has a box to score nothing in
  commitHand(room);
}

/**
 * Deals the next hand once every person has said they are ready (computer players, and people who have gone, never wait).
 *
 * Side effects: when everyone is ready, moves the deal on by one seat and deals (using rng).
 *
 * @param {object} room
 * @param {() => number} rng
 * @returns {void}
 */
function advanceIfReady(room, rng) {
  if (room.phase !== 'show' || !room.seats.every((s) => !isHuman(s) || s.ready)) return;
  room.dealer = (room.dealer + 1) % room.seats.length;
  deal(room, rng);
}

/**
 * A person has finished looking at the show and is ready for the next hand.
 *
 * Side effects: marks the seat ready and deals the next hand if that was the last person to wait for.
 *
 * @param {object} room
 * @param {number} seat  who is ready
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 */
export function ready(room, seat, rng) {
  if (room.phase !== 'show') return fail('There is nothing to be ready for.');
  room.seats[seat].ready = true;
  advanceIfReady(room, rng);
  return ok();
}

// ---- computer players ----

/**
 * The computer player who has something to do now, if any.
 *
 * @param {object} room
 * @returns {{ seat: number, kind: 'discard' | 'play', key: string } | null} `key` names the move and stays the same while
 *   unrelated things happen (a person discarding, say), so the server's timer for it is not restarted by them
 * Side effects: none.
 */
export function pendingBot(room) {
  if (room.phase === 'discard') {
    const seat = room.seats.findIndex((s) => isBot(s) && !s.discarded);
    return seat === -1 ? null : { seat, kind: 'discard', key: `discard:${seat}:${room.handNo}` };
  }
  if (room.phase === 'play' && isBot(room.seats[room.play.turn])) return { seat: room.play.turn, kind: 'play', key: `play:${room.play.turn}:${room.handNo}:${room.hands.flat().length}` };
  return null;
}

/**
 * The AI a computer player plays with; rooms saved before AIs existed fall back to the first one.
 *
 * @param {object} room
 * @param {number} seat
 * @returns {object} an entry of AIS
 * Side effects: none.
 */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat].ai);

/**
 * Everything an AI may know when choosing what to discard: plain data about its own hand and the table.
 * The hand is a copy, so an AI cannot change the room by accident.
 *
 * @param {object} room
 * @param {number} seat
 * @param {() => number} rng
 * @returns {object}
 * Side effects: none.
 */
function discardContext(room, seat, rng) {
  const { discards } = dealRules(room.seats.length, seat === room.dealer);
  return { hand: [...room.hands[seat]], discardCount: discards, isDealer: seat === room.dealer, players: room.seats.length, me: seat, scores: room.seats.map((s) => s.score), target: room.target, rng };
}

/**
 * The same for a card to play: the count, the cards played so far, and how many each player still holds.
 *
 * @param {object} room
 * @param {number} seat
 * @param {() => number} rng
 * @returns {object}
 * Side effects: none.
 */
function playContext(room, seat, rng) {
  const p = room.play;
  const played = room.kept.flatMap((kept, i) => kept.filter((c) => !room.hands[i].includes(c)));
  return {
    hand: [...room.hands[seat]],
    count: p.count,
    sequence: p.sequence.map((x) => x.card),
    played,
    starter: room.starter,
    players: room.seats.length,
    me: seat,
    isDealer: seat === room.dealer,
    cardsLeft: room.hands.map((h) => h.length),
    scores: room.seats.map((s) => s.score),
    target: room.target,
    rng,
  };
}

/**
 * Asks an AI for its choice, and falls back to the standard AI (then to `lastResort`) if it throws or answers illegally,
 * so a faulty AI can never leave the game waiting for a move that does not come.
 *
 * @template T
 * @param {object} room
 * @param {number} seat
 * @param {(ai: object) => T} choose    asks one AI for its choice
 * @param {(choice: unknown) => boolean} isValid  whether a choice is legal
 * @param {() => T} lastResort          a choice that is always legal
 * @returns {T}
 * Side effects: whatever `choose` does (it consumes rng); the room is not changed here.
 */
function chooseSafely(room, seat, choose, isValid, lastResort) {
  for (const ai of [aiOf(room, seat), AIS[0]]) {
    try {
      const choice = choose(ai);
      if (isValid(choice)) return choice;
    } catch {
      // Try the next AI.
    }
  }
  return lastResort();
}

/**
 * Makes the pending computer player's move. An AI that answers illegally (or throws) is overruled by the standard one,
 * and if that fails too a plain legal move is made instead.
 *
 * Side effects: plays or discards for the computer player (see discard and playCard).
 *
 * @param {object} room
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 */
export function botMove(room, rng) {
  const pending = pendingBot(room);
  if (!pending) return fail('No computer player has a move.');
  const { seat, kind } = pending;
  if (kind === 'discard') {
    const context = discardContext(room, seat, rng);
    const valid = (cards) => Array.isArray(cards) && cards.length === context.discardCount && new Set(cards).size === cards.length && cards.every((c) => context.hand.includes(c));
    const cards = chooseSafely(room, seat, (ai) => ai.discard(discardContext(room, seat, rng)), valid, () => context.hand.slice(0, context.discardCount));
    return discard(room, seat, cards, rng);
  }
  const legal = playableCards(room, seat);
  const card = chooseSafely(room, seat, (ai) => ai.play(playContext(room, seat, rng)), (c) => legal.includes(c), () => legal[0]);
  return playCard(room, seat, card);
}

// ---- views and statistics ----

/**
 * The finishing place of every seat (1 = best), in seat order.
 *
 * @param {object} room
 * @returns {number[]}
 * Side effects: none.
 */
const seatPlacements = (room) => Object.values(placements(Object.fromEntries(room.seats.map((s, i) => [i, s.score]))));

/**
 * The only things about an AI a player may be shown.
 *
 * @param {{ id: string, name: string }} ai
 * @returns {{ id: string, name: string }}
 * Side effects: none.
 */
const aiSummary = ({ id, name }) => ({ id, name });

/**
 * One occupied seat as the table shows it to everybody (hands stay hidden, so only how many cards).
 *
 * @param {object} room  not changed
 * @param {number} i  the seat's index
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object}
 * Side effects: none.
 */
function seatView(room, i, online) {
  const s = room.seats[i];
  const live = room.phase === 'discard' || room.phase === 'play';
  return {
    seat: i,
    name: s.name,
    bot: isBot(s),
    replaced: Boolean(s.replaced),
    ai: isBot(s) && room.phase !== 'lobby' ? aiSummary(aiOf(room, i)) : null,
    host: isHuman(s) && s.id === room.hostId,
    online: isBot(s) || (isHuman(s) && online(s.id)),
    left: s.kind === 'gone',
    score: s.score,
    back: s.back,
    cards: live ? room.hands[i].length : 0,
    discarded: room.phase === 'discard' ? s.discarded : false,
    ready: room.phase === 'show' ? !isHuman(s) || s.ready : false,
  };
}

/**
 * The viewer's hand and the cards on the table: the crib and deck sizes (never their contents), the starter, the play so far
 * and the scoring being shown.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {object} `hand`, `need`, `cribCount`, `deckCount`, `starter`, `play` and `show`
 * Side effects: none.
 */
function handView(room, me) {
  const live = room.phase === 'discard' || room.phase === 'play';
  const p = room.play;
  return {
    hand: live && me !== -1 ? room.hands[me] : [],
    need: room.phase === 'discard' && me !== -1 && !room.seats[me].discarded ? dealRules(room.seats.length, me === room.dealer).discards : 0,
    cribCount: live || room.phase === 'show' ? room.crib.length : 0,
    deckCount: live ? room.deck.length : 0,
    starter: room.starter,
    play: p ? { count: p.count, sequence: p.sequence, previous: p.previous, turn: p.turn, playable: p.turn === me ? playableCards(room, me) : [] } : null,
    show: room.show,
  };
}

/**
 * The standard scoreboard (shared/scores.js): the players, the deals scored so far and the target.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online
 * @returns {object}
 * Side effects: none.
 */
function scoreboardView(room, me, online) {
  const player = (s, i) => seatScoreboardEntry(s, i, { score: s.score, me, current: room.phase === 'play' && room.play?.turn === i, online });
  return {
    players: room.seats.flatMap((s, i) => (s ? [player(s, i)] : [])),
    rounds: room.history,
    lowIsBetter: false,
    target: room.target,
  };
}

/**
 * What one person may see. Other players' hands and discards stay hidden until the show. In the lobby an empty seat is
 * null; once the game has started every seat is filled (or, after the game, marked as left).
 *
 * @param {object} room
 * @param {number} userId  the account looking
 * @param {{ online?: (id: number) => boolean }} [options]  says who is connected
 * @returns {object} the view sent to that person
 * Side effects: none.
 */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  return {
    code: room.code,
    phase: room.phase,
    target: room.target,
    seatCount: room.seats.length,
    you: me,
    isHost: room.hostId === userId,
    handNo: room.handNo,
    dealer: room.phase === 'lobby' ? null : room.dealer,
    limits: { targets: TARGETS, minSeats: MIN_SEATS, maxSeats: MAX_SEATS },
    skunkLine: SKUNK_LINE[room.target],
    seats: room.seats.map((s, i) => (s ? seatView(room, i, online) : null)),
    ...handView(room, me),
    log: recentMoves(room, 40),
    winner: room.winner,
    placements: room.phase === 'finished' ? seatPlacements(room) : null,
    scoreboard: scoreboardView(room, me, online),
  };
}

/**
 * The result of a finished game for ctx.stats.record: people only (computer players, replaced people and people who
 * have left are not recorded).
 *
 * @param {object} room  a finished room
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}
 * Side effects: none.
 */
export function statsPlayers(room) {
  const skunked = room.seats.some((s, i) => i !== room.winner && s.score < SKUNK_LINE[room.target]);
  const places = seatPlacements(room);
  return statsRows(room.seats, (s, i) => ({
    outcome: i === room.winner ? 'win' : 'loss',
    placement: places[i],
    score: Math.min(s.score, room.target),
    extras: { ...extrasOf(s.stats, STAT_KEYS), skunks: i === room.winner && skunked ? 1 : 0 },
  }));
}
