// The rules of Zurubang as pure functions over a plain, JSON-friendly room object (no sockets, no files, no clock).
// The game is for exactly two, so the room has two numbered seats, 0 and 1, each holding
//   null                                        an empty seat (lobby only),
//   { kind: 'human', id: <account id>, name }   a person,
//   { kind: 'bot', id: 'bot:<n>', name, ai }    a computer player (`replaced: true` when it took over from a person),
//   { kind: 'gone', id: null, name }            a person who left after the game ended.
// Each occupied seat also carries this game's own fields: score, ready, and stats.  The cards are kept in arrays
// beside the seats (`room.hands`), the way a seated game does, so a seat changing hands renames nothing.
//
// The join / leave / kick / computer-player rules are the shared ones (shared/seats.js); one fight on the battlefield
// is ./duel.js; this file is everything between.  Functions that can fail return { ok: false, error }; the rest return
// { ok: true, ... }.  Nothing here is a sentence: a refusal is a code under `errors.`, and anything the client shows
// is a message from shared/messages.js.
//
// Depends on shared/ (ai, input, layout, messages, moveLog, scores, seats, tally) and ./cards.js, ./duel.js, ./ai.
import { numberFrom, textFrom } from '../../shared/input.js';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { msg } from '../../shared/messages.js';
import { addMove, recentMoves } from '../../shared/moveLog.js';
import { placements, seatScoreboardEntry } from '../../shared/scores.js';
import { asHost, botSeats, createSeatRules, emptySeats, fail, hostInLobby, humanSeats, isBot, isGone, isHuman, nextGame, ok, seatOf, taken, wouldPlay } from '../../shared/seats.js';
import { bump, extrasOf, freshTally, peak, statsRows } from '../../shared/tally.js';
import { BACK_ELEMENT, CARDS, cardOf, fullDeck, isCard } from './cards.js';
import { POSITIONS, drawCard, fightAt, other, pickUp } from './duel.js';
import { AIS } from './ai/index.js';

/** The scores a game can be played to; 30 is the rulebook's. */
export const TARGETS = [20, 30, 50];
export const DEFAULT_TARGET = 30;
/** A game of Zurubang is for exactly two. */
export const SEATS = 2;
/** Cards in a hand, and so cards each player places in a duel. */
export const HAND_SIZE = 5;
/** The deck is split into this many stacks to draw from. */
export const STACK_COUNT = 3;
/** What a challenge the other player will not answer is worth. */
export const DECLINE_POINTS = 5;
/** What throwing the whole hand away gives the other player. */
export const DUMP_POINTS = 1;
/** What the two special hands are worth on top of a won duel. */
export const RAINBOW_BONUS = 2;
export const FIVE_OF_A_KIND_BONUS = 4;
export const MAX_NAME_LENGTH = 24;
/** Names the shared seat rules hand out to computer players. */
export const BOT_NAMES = ['Zuri', 'Bangor', 'Krabarka', 'Wumpi', 'Firgol', 'Mugog', 'Inuin', 'Terrachi'];
/**
 * How many cards a side places in each burst.  The player who starts puts down one, and from then on the two of them
 * alternate two at a time, which leaves the second player placing the tenth and last card with no choice left about
 * it.  That is the whole advantage of starting, and the rulebook's pictures are where it comes from.
 */
export const BURSTS = [1, 2, 2, 2, 2, 1];
/** The numbers this game reports about a player when a game ends. */
export const STAT_KEYS = ['duelsWon', 'duelsFought', 'pairsWon', 'bestDuel', 'declined', 'refused', 'dumped', 'rainbowWins', 'fiveOfAKindWins', 'suddenDeaths', 'zurubangWins', 'cleanSweeps', 'destroyed'];
/** How many lines of the move log are kept. */
const LOG_LIMIT = 60;

export { hasPlayer, humanSeats, isBot, isHuman, seatOf } from '../../shared/seats.js';
export { other } from './duel.js';

/** The phases a duel passes through, in order, for anybody reading a view. */
export const DUEL_PHASES = ['challenged', 'starter', 'placing', 'revealing', 'sudden', 'duelOver'];

// ---- the room ----

/** The fields every occupied seat carries for this game, at their starting values. */
const gameFields = () => ({ score: 0, ready: false, stats: freshTally(STAT_KEYS) });

/** A seat with this game's fields added if the shared rules have just made it without them. */
const withGameFields = (seat) => (seat && seat.score === undefined ? { ...gameFields(), ...seat } : seat);

/** Tidies a name a person typed, and never lets it be empty. */
const cleanName = (raw) => textFrom(raw).trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) || 'Player';

/**
 * A new room, in its lobby, with the host in seat 0.
 *
 * @param {object} args
 * @param {string} args.code      the invite code
 * @param {number} args.hostId    the host's account id
 * @param {string} args.hostName  the host's name
 * @param {object} [args.settings]  the settings the host asked for; a bad one throws, as createRoom must
 * @param {number} args.now       the clock
 * @returns {object} the room
 * Side effects: none.
 */
export function createRoom({ code, hostId, hostName, settings = {}, now }) {
  const { target = DEFAULT_TARGET } = settings;
  if (!TARGETS.includes(target)) throw new Error(`Play to ${TARGETS.join(', ')}.`);
  return {
    code,
    hostId,
    target,
    phase: 'lobby',
    seats: [{ kind: 'human', id: hostId, name: cleanName(hostName), ...gameFields() }, ...emptySeats(SEATS - 1)],
    nextBot: 1,
    hands: [[], []],
    stacks: [],
    graveyard: [],
    turn: 0,
    marker: 0,
    duelNo: 0,
    duel: null,
    log: [],
    history: [],
    winner: null,
    recorded: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Is the game still going (or yet to start)?  A finished game is not resumed and is thrown away sooner. */
export const isLive = (room) => room.phase !== 'finished';

/**
 * Brings a saved room up to date when the server loads it.  There is nothing older than the first shape yet, so this
 * only fills in fields a room might be missing and drops log lines that are not messages.
 *
 * @param {object} room  a room as it was read back
 * @returns {object} the same room, in the current shape
 * Side effects: changes the room it is given.
 */
export function migrate(room) {
  if (Array.isArray(room.log) && room.log.some((line) => typeof line?.key !== 'string')) room.log = room.log.filter((line) => typeof line?.key === 'string');
  room.history ??= [];
  room.hands ??= [[], []];
  room.stacks ??= [];
  room.graveyard ??= [];
  room.duelNo ??= 0;
  room.marker ??= 0;
  return room;
}

// ---- seats and settings ----

/**
 * The seat rules are the shared ones.  A person who leaves a game under way is replaced by a computer player that
 * keeps their name, their score, and their counters; a person who leaves a finished one leaves a marker, so that the
 * final scores still name them.  The cards are in arrays beside the seats, so nothing of this renames anything.
 */
const seats = createSeatRules({
  isMidGame: (room) => room.phase !== 'lobby' && room.phase !== 'finished',
  minPlayers: SEATS,
  maxPlayers: SEATS,
  fillTo: SEATS,
  botNames: BOT_NAMES,
  replacement: (room, leaving, bot) => ({ ...leaving, kind: 'bot', id: bot.id }),
  takeOver: (room, oldId, bot, rng) => {
    bot.replaced = true;
    bot.ai = pickAI(AIS, rng).id;
  },
  handOver: (room, botId, person) => {
    delete person.replaced;
    delete person.ai;
  },
  finishedSeat: (seat) => ({ ...seat, kind: 'gone', id: null }),
});
export const { removeHuman, removeBot, kick, sizeOf } = seats;

/**
 * Seats a person (see the shared addHuman) and gives their seat this game's fields.
 *
 * The name is only tidied here, never made unique: the shared rules do that, and they know the one case this file
 * could not — somebody walking back into a game is taking over the computer player that has been keeping their chair
 * warm under their own name, so "bob" is free for them again and "bob (2)" would be absurd.
 */
export function addHuman(room, userId, name) {
  const added = seats.addHuman(room, userId, cleanName(name));
  if (added.ok) room.seats[added.seat] = withGameFields(room.seats[added.seat]);
  return added;
}

/** The host puts a computer player in a seat (see the shared addBot), with this game's fields. */
export function addBot(room, userId, seat) {
  const added = seats.addBot(room, userId, seat);
  if (added.ok) room.seats[added.seat] = withGameFields(room.seats[added.seat]);
  return added;
}

/** The host fills the empty seat with a computer player (see the shared fillWithBots). */
export function fillWithBots(room, userId) {
  const filled = seats.fillWithBots(room, userId);
  if (filled.ok) room.seats = room.seats.map(withGameFields);
  return filled;
}

/**
 * The host changes a setting in the lobby.  A setting the host gets wrong is refused and nothing changes.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {{ target?: number }} settings
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: may change room.target.
 */
export function setSettings(room, userId, settings = {}) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (settings.target !== undefined) {
    const target = numberFrom(settings.target);
    if (!TARGETS.includes(target)) return fail('badTarget', { targets: TARGETS.join(', ') });
    room.target = target;
  }
  return ok();
}

// ---- starting, and starting again ----

/**
 * Deals a game: five cards each, and the rest split into three stacks.
 *
 * @param {object} room
 * @param {() => number} rng
 * @returns {void}
 * Side effects: fills room.hands, room.stacks, and room.graveyard.
 */
function deal(room, rng) {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  room.hands = [deck.splice(0, HAND_SIZE), deck.splice(0, HAND_SIZE)];
  room.stacks = Array.from({ length: STACK_COUNT }, () => []);
  deck.forEach((card, i) => room.stacks[i % STACK_COUNT].push(card));
  room.graveyard = [];
}

/**
 * The host starts the game.  Every refusal is answered before the table is settled, so that a start which does not
 * happen leaves the lobby exactly as it was.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: settles the seats, deals, gives the computer players their AIs, and begins the first turn.
 */
export function start(room, userId, rng) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (taken(room) < SEATS) return fail('minPlayers', { min: SEATS });
  if (!humanSeats(room).length) return fail('needPerson');
  seats.lockSize(room);
  for (const seat of room.seats) Object.assign(seat, gameFields());
  room.winner = null;
  room.duelNo = 0;
  room.duel = null;
  room.history = [];
  room.log = [];
  deal(room, rng);
  // The rulebook lets the owner of the game say who starts; with nobody holding the box, the cards decide.
  room.turn = Math.floor(rng() * SEATS);
  room.marker = room.turn;
  room.phase = 'turn';
  assignBotAIs(room, rng);
  addMove(room, msg('log.started', { name: room.seats[room.turn].name }), LOG_LIMIT);
  return ok();
}

/** Every computer player picks the AI it plays this game with, kept on the seat so it survives a restart. */
function assignBotAIs(room, rng) {
  const chosen = assignAIs(AIS, botSeats(room), rng);
  room.seats.forEach((seat, i) => {
    if (isBot(seat)) seat.ai = chosen[i];
    else delete seat.ai;
  });
}

/**
 * From the finished game back to the lobby, with the same people in the same seats.
 *
 * @param {object} room
 * @param {number} userId  who is asking (must be the host)
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: resets the room and puts it back in its lobby.
 */
export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('notOver');
  nextGame(room); // the game just played keeps its scoreboard; this is the next one
  room.seats = room.seats.map((seat) => (isHuman(seat) || isBot(seat) ? seat : null));
  for (const seat of room.seats.filter(Boolean)) {
    Object.assign(seat, gameFields());
    delete seat.ai;
  }
  Object.assign(room, { phase: 'lobby', winner: null, recorded: false, hands: [[], []], stacks: [], graveyard: [], duel: null, duelNo: 0, turn: 0, marker: 0, log: [], history: [] });
  return ok();
}

// ---- points ----

/**
 * Gives a seat points, writes the reason into the scoreboard's history, and ends the game if that took them home.
 *
 * @param {object} room
 * @param {Record<number, number>} deltas  what each seat has just scored
 * @param {object} label    the message naming the row in the all-rounds table
 * @param {object} [notes]  per-seat notes for that row
 * @returns {void}
 * Side effects: changes the seats' scores, adds a row to the history, and may finish the game.
 */
function score(room, deltas, label, notes) {
  for (const [seat, points] of Object.entries(deltas)) room.seats[seat].score += points;
  room.history.push({ label, deltas, ...(notes ? { notes } : {}) });
  const home = room.seats.findIndex((seat) => seat.score >= room.target);
  if (home !== -1) finish(room, home);
}

/**
 * Ends the game.  Whatever is on the battlefield stays there: a duel that took somebody home is the last thing the
 * two of them will want to look at, and a card left standing is a card still somewhere rather than nowhere.
 *
 * @param {object} room  @param {number} seat  the winner
 * Side effects: sets the phase and the winner.
 */
function finish(room, seat) {
  room.phase = 'finished';
  room.winner = seat;
  addMove(room, msg('log.won', { name: room.seats[seat].name, score: room.seats[seat].score }), LOG_LIMIT);
}

/** The next turn is this seat's, unless the game has just ended. */
function handTurnTo(room, seat) {
  if (room.phase === 'finished') return;
  room.turn = seat;
  room.phase = 'turn';
}

// ---- a turn ----

/** The seat this person is in, if the game is at a point where they may act at all. */
const playing = (room, seat) => (Number.isInteger(seat) && seat >= 0 && seat < SEATS && room.seats[seat] ? room.seats[seat] : null);

/**
 * Takes a card off a stack of the player's choosing, falling back to the fullest when they name none that has
 * anything on it, and shuffling the graveyard back into the stacks when they have all run dry.
 *
 * @param {object} room  @param {unknown} wanted  the stack asked for  @param {() => number} rng
 * @returns {string | null} the card, or null when the whole deck is spent
 * Side effects: changes room.stacks, and may empty room.graveyard into them.
 */
function take(room, wanted, rng) {
  const stack = numberFrom(wanted);
  return drawCard(battleOf(room), rng, Number.isInteger(stack) ? stack : -1);
}

/**
 * The battle duel.js works on: the duel's own fields, with the room's stacks and graveyard shared by reference.
 *
 * Everything duel.js changes it changes in place — the arrays of the battlefield, the stacks, the graveyard, the
 * points, and the fights — so a shallow copy of the duel is enough for those changes to reach the room.  That matters
 * because a room is saved as JSON: holding the stacks inside the duel as well as beside it would make two of them the
 * moment a room was read back.
 */
const battleOf = (room) => ({ ...room.duel, stacks: room.stacks, graveyard: room.graveyard, marker: room.marker });

/**
 * Swaps one card: it goes face down on the graveyard, and a fresh one comes off the stack asked for.
 *
 * @param {object} room  @param {number} seat  @param {unknown} card  @param {unknown} stack  @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: changes the hand, the stacks, and the graveyard, and passes the turn.
 */
export function swapOne(room, seat, card, stack, rng) {
  if (room.phase !== 'turn') return fail('notYourTurn');
  if (seat !== room.turn) return fail('notYourTurn');
  if (!playing(room, seat)) return fail('notInGame');
  const hand = room.hands[seat];
  const at = isCard(card) ? hand.indexOf(/** @type {string} */ (card)) : -1;
  if (at === -1) return fail('notInHand');
  const drawn = take(room, stack, rng);
  if (!drawn) return fail('nothingToDraw');
  hand.splice(at, 1, drawn);
  room.graveyard.push(/** @type {string} */ (card));
  addMove(room, msg('log.swapOne', { name: room.seats[seat].name }), LOG_LIMIT);
  handTurnTo(room, other(seat));
  return ok({ drawn });
}

/**
 * Swaps the whole hand, which gives the other player a point.
 *
 * @param {object} room  @param {number} seat  @param {unknown} stacks  five stack numbers, or nothing at all
 * @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: changes the hand, the stacks, and the graveyard, scores a point, and passes the turn.
 */
export function swapAll(room, seat, stacks, rng) {
  if (room.phase !== 'turn') return fail('notYourTurn');
  if (seat !== room.turn) return fail('notYourTurn');
  if (!playing(room, seat)) return fail('notInGame');
  const wanted = Array.isArray(stacks) ? stacks : [];
  const old = room.hands[seat].splice(0, HAND_SIZE);
  room.graveyard.push(...old);
  const fresh = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    const drawn = take(room, wanted[i], rng);
    if (drawn) fresh.push(drawn);
  }
  room.hands[seat] = fresh;
  bump(room.seats[seat].stats, 'dumped');
  addMove(room, msg('log.swapAll', { name: room.seats[seat].name, other: room.seats[other(seat)].name }), LOG_LIMIT);
  score(room, { [other(seat)]: DUMP_POINTS }, msg('scores.dumped', { name: room.seats[seat].name }));
  handTurnTo(room, other(seat));
  return ok();
}

/**
 * Challenges the other player to a duel.
 *
 * @param {object} room  @param {number} seat
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: opens a duel waiting on the other player's answer.
 */
export function challenge(room, seat) {
  if (room.phase !== 'turn') return fail('notYourTurn');
  if (seat !== room.turn) return fail('notYourTurn');
  if (!playing(room, seat)) return fail('notInGame');
  room.duel = { challenger: seat, starter: null, placed: [Array(POSITIONS).fill(null), Array(POSITIONS).fill(null)], at: 0, fights: [], points: [0, 0], fiveElement: [null, null], special: [null, null], revealed: [], sudden: null, result: null };
  room.phase = 'challenged';
  addMove(room, msg('log.challenged', { name: room.seats[seat].name, other: room.seats[other(seat)].name }), LOG_LIMIT);
  return ok();
}

/**
 * The challenged player accepts the duel or declines it.  Declining hands the challenger five points and the next
 * turn to the player who declined: a challenge is a turn like any other, so the turn passes.
 *
 * @param {object} room  @param {number} seat  @param {unknown} accept
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: either scores the decline and goes back to a turn, or moves on to choosing who places first.
 */
export function answer(room, seat, accept) {
  if (room.phase !== 'challenged') return fail('notTimeToAnswer');
  if (seat !== other(room.duel.challenger)) return fail('notYourChallenge');
  const challenger = room.duel.challenger;
  if (!accept) {
    bump(room.seats[seat].stats, 'declined');
    bump(room.seats[challenger].stats, 'refused');
    room.duel = null;
    addMove(room, msg('log.declined', { name: room.seats[seat].name }), LOG_LIMIT);
    score(room, { [challenger]: DECLINE_POINTS }, msg('scores.declined', { name: room.seats[seat].name }));
    handTurnTo(room, seat);
    return ok({ accepted: false });
  }
  // The Duel card sits with the challenged player from here on, and whoever holds it acts first.
  room.marker = seat;
  room.phase = 'starter';
  addMove(room, msg('log.accepted', { name: room.seats[seat].name }), LOG_LIMIT);
  return ok({ accepted: true });
}

/**
 * The challenged player says who places the first card.
 *
 * @param {object} room  @param {number} seat  @param {unknown} who  the seat that is to start
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: judges both hands for a special hand and begins the placing.
 */
export function chooseStarter(room, seat, who) {
  if (room.phase !== 'starter') return fail('notTimeToChoose');
  if (seat !== other(room.duel.challenger)) return fail('notYourChallenge');
  const starter = numberFrom(who);
  if (starter !== 0 && starter !== 1) return fail('chooseAPlayer');
  room.duel.starter = starter;
  // The special hands are judged on the backs in hand at the moment the duel starts, and nothing afterwards changes
  // them.  What a five-of-a-kind hand is worth in a fight is the **element** its backs promise, not the colour of
  // them: a fight weighs faces, and "white" is not a face.
  room.duel.special = room.hands.map(specialHand);
  room.duel.fiveElement = room.hands.map((hand) => (specialHand(hand) === 'fiveOfAKind' ? BACK_ELEMENT[cardOf(hand[0]).back] : null));
  room.phase = 'placing';
  addMove(room, msg('log.starts', { name: room.seats[starter].name }), LOG_LIMIT);
  return ok();
}

/** Every card's place in the deck, which is how an achievement counts the different ones somebody has held. */
const CARD_NUMBER = new Map(CARDS.map((card, index) => [card.id, index]));

/**
 * The deck numbers of the cards each person is holding, for the achievement that counts how many different ones they
 * have ever had.  Only accounts are in it: a computer player collects nothing.
 *
 * @param {object} room
 * @returns {{ userId: number, cards: number[] }[]} one entry per person holding anything
 * Side effects: none.
 */
export function heldByPeople(room) {
  return room.seats.flatMap((seat, i) =>
    isHuman(seat) && room.hands[i]?.length ? [{ userId: seat.id, cards: room.hands[i].map((id) => CARD_NUMBER.get(id)).filter((n) => n !== undefined) }] : [],
  );
}

/**
 * What a hand of backs is worth: all five different is a rainbow, all five the same is five of a kind.
 *
 * @param {string[]} hand
 * @returns {string | null} 'rainbow', 'fiveOfAKind', or null
 * Side effects: none.
 */
export function specialHand(hand) {
  if (hand.length !== HAND_SIZE) return null;
  const backs = new Set(hand.map((id) => cardOf(id)?.back));
  if (backs.size === HAND_SIZE) return 'rainbow';
  if (backs.size === 1) return 'fiveOfAKind';
  return null;
}

/**
 * Whose turn it is to place a card, and how many they still owe this burst.
 *
 * @param {object} room
 * @returns {{ seat: number, left: number, position: number } | null} null once all ten are down
 * Side effects: none.
 */
export function placer(room) {
  const duel = room.duel;
  if (!duel || duel.starter === null) return null;
  const down = duel.placed.flat().filter(Boolean).length;
  let seen = 0;
  for (let burst = 0; burst < BURSTS.length; burst++) {
    if (down < seen + BURSTS[burst]) {
      const seat = burst % 2 === 0 ? duel.starter : other(duel.starter);
      return { seat, left: seen + BURSTS[burst] - down, position: duel.placed[seat].filter(Boolean).length };
    }
    seen += BURSTS[burst];
  }
  return null;
}

/**
 * Puts one card face down in the next position.  Which position that is the rhythm decides, not the player.
 *
 * @param {object} room  @param {number} seat  @param {unknown} card
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: moves the card from the hand to the battlefield, and begins the revealing once all ten are down.
 */
export function place(room, seat, card) {
  if (room.phase !== 'placing') return fail('notTimeToPlace');
  const next = placer(room);
  if (!next || next.seat !== seat) return fail('notYourTurnToPlace');
  const hand = room.hands[seat];
  const at = isCard(card) ? hand.indexOf(/** @type {string} */ (card)) : -1;
  if (at === -1) return fail('notInHand');
  hand.splice(at, 1);
  room.duel.placed[seat][next.position] = card;
  addMove(room, msg('log.placed', { name: room.seats[seat].name, position: next.position + 1 }), LOG_LIMIT);
  if (!placer(room)) {
    room.phase = 'revealing';
    room.duel.at = 0;
  }
  return ok({ position: next.position });
}

/**
 * Turns over the next pair and fights it.  Either player may ask for this; the server does it by itself after a pause
 * if neither of them does, so that a duel is watched rather than waited on.
 *
 * @param {object} room  @param {number} seat  @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: fights one position, and settles the duel once the fifth is done.
 */
export function reveal(room, seat, rng) {
  if (room.phase !== 'revealing') return fail('notTimeToReveal');
  if (!playing(room, seat)) return fail('notInGame');
  return revealNext(room, rng);
}

/**
 * Turns the next pair over with nobody having asked, which is what the server does when the pause runs out.
 *
 * @param {object} room  @param {() => number} rng
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as reveal.
 */
export function revealNext(room, rng) {
  if (room.phase !== 'revealing') return fail('notTimeToReveal');
  const battle = battleOf(room);
  const fight = fightAt(battle, rng);
  recordFight(room, fight);
  room.duel.at += 1;
  if (room.duel.at >= POSITIONS) settleDuel(room, rng);
  return ok();
}

/** The counters a single fight moves, and the cards it has turned face up for good. */
function recordFight(room, fight) {
  for (const id of fight.cards) if (id && !room.duel.revealed.includes(id)) room.duel.revealed.push(id);
  for (const side of [0, 1]) {
    const stats = room.seats[side].stats;
    if (fight.winner === side) {
      bump(stats, 'pairsWon');
      if (cardOf(fight.cards[side])?.talent === 'zurubang') bump(stats, 'zurubangWins');
    }
    if (fight.destroyed[side]) bump(stats, 'destroyed', fight.destroyed[side]);
  }
  addMove(room, fightLine(room, fight), LOG_LIMIT);
}

/** One line of the move log for a fight. */
const fightLine = (room, fight) =>
  fight.winner === null
    ? msg('log.drew', { a: msg(`cards.${fight.cards[0]}`), b: msg(`cards.${fight.cards[1]}`) })
    : msg('log.beat', { winner: msg(`cards.${fight.cards[fight.winner]}`), loser: msg(`cards.${fight.cards[other(fight.winner)]}`), name: room.seats[fight.winner].name });

/**
 * All five fights are done: either somebody has more points, or it goes to a sudden death.
 *
 * @param {object} room  @param {() => number} rng
 * @returns {void}
 * Side effects: either opens a sudden death or banks the duel.
 */
function settleDuel(room, rng) {
  const [a, b] = room.duel.points;
  if (a === b) {
    room.duel.sudden = { round: 1, picks: [null, null], out: [[], []] };
    room.phase = 'sudden';
    addMove(room, msg('log.sudden', { points: a }), LOG_LIMIT);
    return;
  }
  bankDuel(room, a > b ? 0 : 1, false);
}

/**
 * A player chooses the card that fights for them in a sudden death.  Both choices are secret until both are in.
 *
 * @param {object} room  @param {number} seat  @param {unknown} position
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: records the pick, and fights the pair once both are in.
 */
export function suddenPick(room, seat, position, rng) {
  if (room.phase !== 'sudden') return fail('notTimeToPick');
  if (!playing(room, seat)) return fail('notInGame');
  const sudden = room.duel.sudden;
  if (sudden.picks[seat] !== null) return fail('alreadyPicked');
  const at = numberFrom(position);
  if (!Number.isInteger(at) || at < 0 || at >= POSITIONS) return fail('pickAPosition', { max: POSITIONS });
  if (sudden.out[seat].includes(at)) return fail('cardIsOut');
  sudden.picks[seat] = at;
  if (sudden.picks.some((pick) => pick === null)) return ok();
  fightSudden(room, rng);
  return ok();
}

/**
 * The two chosen cards fight, and the result is added to the level scores.  A draw takes both cards out of the sudden
 * death and another round is played; when that empties the battlefield, nobody has won and nobody banks.
 *
 * @param {object} room  @param {() => number} rng
 * @returns {void}
 * Side effects: fights the pair, and either banks the duel or opens the next sudden-death round.
 */
function fightSudden(room, rng) {
  const sudden = room.duel.sudden;
  const picks = [...sudden.picks];
  const battle = battleOf(room);
  // Every card on the battlefield has been turned over by now, which is what `at` says to the talents that count them.
  battle.at = POSITIONS;
  const fight = fightAt(battle, rng, picks);
  recordFight(room, fight);
  sudden.picks = [null, null];
  if (fight.winner !== null) {
    bump(room.seats[fight.winner].stats, 'suddenDeaths');
    bankDuel(room, fight.winner, true);
    return;
  }
  for (const side of [0, 1]) sudden.out[side].push(picks[side]);
  if (sudden.out[0].length >= POSITIONS) {
    addMove(room, msg('log.noWinner'), LOG_LIMIT);
    bankDuel(room, null, true);
    return;
  }
  sudden.round += 1;
  addMove(room, msg('log.suddenAgain', { round: sudden.round }), LOG_LIMIT);
}

/**
 * The duel is over: the winner banks every point they made, with the special hand on top, and both players take their
 * cards back off the battlefield.
 *
 * @param {object} room
 * The cards stay on the battlefield until the result has been closed: they are picked up in nextTurn, which is both
 * what the rulebook describes and what keeps every card in exactly one place at every moment.
 *
 * @param {number | null} winner  the seat that won it, or null when five drawn sudden deaths settled nothing
 * @param {boolean} sudden  whether it went to a sudden death
 * @returns {void}
 * Side effects: scores, and waits for both players to close the duel.
 */
function bankDuel(room, winner, sudden) {
  const banked = winner === null ? 0 : room.duel.points[winner];
  const special = winner === null ? null : room.duel.special[winner];
  const bonus = special === 'rainbow' ? RAINBOW_BONUS : special === 'fiveOfAKind' ? FIVE_OF_A_KIND_BONUS : 0;

  for (const side of [0, 1]) bump(room.seats[side].stats, 'duelsFought');
  if (winner !== null) {
    const stats = room.seats[winner].stats;
    bump(stats, 'duelsWon');
    peak(stats, 'bestDuel', banked + bonus);
    if (special === 'rainbow') bump(stats, 'rainbowWins');
    if (special === 'fiveOfAKind') bump(stats, 'fiveOfAKindWins');
    if (room.duel.fights.filter((f) => f.position !== null).every((f) => f.winner === winner)) bump(stats, 'cleanSweeps');
  }

  room.duelNo += 1;
  room.duel = { ...room.duel, result: { winner, banked, bonus, sudden, points: [...room.duel.points] } };
  for (const seat of room.seats) seat.ready = false;
  room.phase = 'duelOver';
  const challenged = other(room.duel.challenger);
  room.turn = challenged;
  addMove(room, winner === null ? msg('log.duelDrawn') : msg('log.duelWon', { name: room.seats[winner].name, points: banked + bonus }), LOG_LIMIT);
  if (winner !== null) {
    const notes = bonus ? { [winner]: msg(`scores.${special}`, { points: bonus }) } : undefined;
    score(room, { [winner]: banked + bonus, [other(winner)]: 0 }, msg('scores.duel', { n: room.duelNo }), notes);
  } else {
    room.history.push({ label: msg('scores.duel', { n: room.duelNo }), deltas: { 0: 0, 1: 0 } });
  }
}

/**
 * A player has seen enough of the duel's result.  When both have, the challenged player takes the next turn.
 *
 * @param {object} room  @param {number} seat
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: marks the seat ready, and may begin the next turn.
 */
export function ready(room, seat, rng) {
  if (room.phase !== 'duelOver') return fail('nothingToClose');
  if (!playing(room, seat)) return fail('notInGame');
  room.seats[seat].ready = true;
  if (room.seats.every((s) => s.ready)) nextTurn(room, rng);
  return ok();
}

/** Nobody closed the duel, so the server does.  Used by the room server when the wait runs out. */
export function forceNext(room, rng) {
  if (room.phase !== 'duelOver') return fail('nothingToClose');
  nextTurn(room, rng);
  return ok();
}

/** Is the game waiting for somebody to close a duel? */
export const waitingForReady = (room) => room.phase === 'duelOver';

/** Who the duel is still waiting on. */
export const waitingOn = (room) => (room.phase === 'duelOver' ? room.seats.flatMap((s, i) => (s.ready ? [] : [i])) : []);

/**
 * Picks every card up off the battlefield — the swapping cards changing sides — makes both hands back up to five,
 * puts the duel away, and gives the turn to the player who was challenged.
 *
 * @param {object} room  @param {() => number} rng
 * @returns {void}
 * Side effects: changes the hands, the stacks, the graveyard, and the phase.
 */
function nextTurn(room, rng) {
  const battle = battleOf(room);
  const challenged = other(room.duel.challenger);
  const hands = pickUp(battle);
  for (const side of [0, 1]) {
    room.hands[side] = hands[side];
    while (room.hands[side].length < HAND_SIZE) {
      const drawn = drawCard(battle, rng);
      if (!drawn) break;
      room.hands[side].push(drawn);
    }
  }
  room.duel = null;
  for (const seat of room.seats) seat.ready = false;
  handTurnTo(room, challenged);
}

// ---- computer players ----

/**
 * What a computer player has to do right now, if anything: the key is what the room server keeps a timer under.
 *
 * @param {object} room
 * @returns {{ seat: number, kind: string, key: string } | null}
 * Side effects: none.
 */
export function pendingBot(room) {
  const ask = (seat, kind) => (isBot(room.seats[seat]) ? { seat, kind, key: `${kind}:${room.duelNo}:${seat}:${room.duel?.at ?? 0}:${room.duel?.sudden?.round ?? 0}:${room.history.length}` } : null);
  switch (room.phase) {
    case 'turn':
      return ask(room.turn, 'turn');
    case 'challenged':
      return ask(other(room.duel.challenger), 'answer');
    case 'starter':
      return ask(other(room.duel.challenger), 'starter');
    case 'placing': {
      const next = placer(room);
      return next ? ask(next.seat, 'place') : null;
    }
    case 'sudden': {
      const waiting = [0, 1].find((seat) => room.duel.sudden.picks[seat] === null && isBot(room.seats[seat]));
      return waiting === undefined ? null : ask(waiting, 'sudden');
    }
    case 'duelOver': {
      const waiting = waitingOn(room).find((seat) => isBot(room.seats[seat]));
      return waiting === undefined ? null : ask(waiting, 'ready');
    }
    default:
      return null;
  }
}

/**
 * Plays a computer player's move.  The AI is only ever asked to choose: the move itself goes through the same rules a
 * person's does, so a computer player can never do something a person could not, and an AI that answers with nonsense
 * is overruled by the fallback inside each chooser.
 *
 * @param {object} room  @param {() => number} rng  @param {object} [action]  what pendingBot said
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: whatever the move does.
 */
export function botMove(room, rng, action = pendingBot(room)) {
  if (!action) return fail('nothingToDo');
  const { seat, kind } = action;
  const ai = aiById(AIS, room.seats[seat].ai);
  const context = aiContext(room, seat);
  switch (kind) {
    case 'turn': {
      const move = chooseTurn(ai, context, rng);
      if (move.kind === 'challenge') return challenge(room, seat);
      if (move.kind === 'swapAll') return swapAll(room, seat, move.stacks, rng);
      return swapOne(room, seat, move.card, move.stack, rng);
    }
    case 'answer':
      return answer(room, seat, attempt(() => ai.accepts?.(context, rng), true));
    case 'starter':
      return chooseStarter(room, seat, attempt(() => ai.startsWith?.(context, rng), seat));
    case 'place': {
      const chosen = attempt(() => ai.place?.(context, rng), context.hand[0]);
      return place(room, seat, context.hand.includes(chosen) ? chosen : context.hand[0]);
    }
    case 'sudden': {
      const chosen = attempt(() => ai.suddenPick?.(context, rng), context.suddenChoices[0]);
      return suddenPick(room, seat, context.suddenChoices.includes(chosen) ? chosen : context.suddenChoices[0], rng);
    }
    case 'ready':
      return ready(room, seat, rng);
    default:
      return fail('nothingToDo');
  }
}

/** Asks an AI for a choice, and falls back to a legal one if it throws or answers with nothing. */
function attempt(ask, fallback) {
  try {
    const answered = ask();
    return answered === undefined || answered === null ? fallback : answered;
  } catch {
    return fallback;
  }
}

/** The turn an AI chooses, made safe: a card it does not hold becomes the first card in its hand. */
function chooseTurn(ai, context, rng) {
  const move = attempt(() => ai.turn?.(context, rng), null) ?? { kind: 'swapOne' };
  if (move.kind === 'challenge' || move.kind === 'swapAll') return move;
  return { kind: 'swapOne', card: context.hand.includes(move.card) ? move.card : context.hand[0], stack: move.stack };
}

/**
 * What a computer player is allowed to know: its own hand in full, the other player's backs, the battlefield as it
 * stands, and the counts.  It is built from the view, so an AI can never see anything a person in its seat could not.
 *
 * @param {object} room  @param {number} seat
 * @returns {object} the context the AIs are given
 * Side effects: none.
 */
export function aiContext(room, seat) {
  const view = viewFor(room, room.seats[seat].id, { online: () => true, asSeat: seat });
  const duel = view.duel;
  return {
    seat,
    hand: [...view.hand],
    theirBacks: view.theirHand.map((card) => card.back),
    special: specialHand(view.hand),
    score: view.seats[seat].score,
    theirScore: view.seats[other(seat)].score,
    target: room.target,
    stacks: view.stacks,
    graveyard: view.graveyard,
    duel: duel
      ? {
          starter: duel.starter,
          challenger: duel.challenger,
          mine: duel.placed[seat].map((card) => card?.id ?? null),
          theirBacks: duel.placed[other(seat)].map((card) => card?.back ?? null),
          theirs: duel.placed[other(seat)].map((card) => card?.id ?? null),
          at: duel.at,
          points: [...duel.points],
          fights: duel.fights,
        }
      : null,
    suddenChoices: duel?.sudden ? [...Array(POSITIONS).keys()].filter((p) => !duel.sudden.out.includes(p)) : [],
  };
}

// ---- the view ----

/**
 * One card as the player looking at it may see it: the whole card if they are allowed to know it, and nothing but its
 * back if they are not.  Backs are public in this game and faces are private, which is the opposite way round from
 * every other card game on the site.
 *
 * @param {string | null} id  @param {boolean} seen  whether this viewer may know the face
 * @returns {object | null}
 * Side effects: none.
 */
const cardView = (id, seen) => (id ? (seen ? { id, back: cardOf(id).back } : { back: cardOf(id).back }) : null);

/**
 * The duel as one seat may see it.  A card on the battlefield is yours to know if you put it there, and everybody's
 * once its position has been fought — but a card that replaced a destroyed one is face down again, even at a position
 * that has already been fought.
 */
function duelView(room, me) {
  const duel = room.duel;
  if (!duel) return null;
  const revealed = new Set(duel.revealed ?? []);
  // A card is yours to know if you put it there, and everybody's once it has fought.  A card that took a destroyed
  // one's place has never fought, so it is a back again even at a position the duel has already passed.
  const seen = (id, side) => side === me || revealed.has(id);
  return {
    challenger: duel.challenger,
    starter: duel.starter,
    at: duel.at,
    points: [...duel.points],
    placed: duel.placed.map((row, side) => row.map((id) => cardView(id, seen(id, side)))),
    fights: duel.fights,
    special: duel.special,
    sudden: duel.sudden ? { round: duel.sudden.round, out: duel.sudden.out[me] ?? [], picked: me === -1 ? null : duel.sudden.picks[me], chosen: duel.sudden.picks.map((pick) => pick !== null) } : null,
    result: duel.result,
  };
}

/** The standard scoreboard (shared/scores.js): the players, the duels scored so far, and the target. */
function scoreboardView(room, me, online) {
  const current = (i) => {
    if (room.phase === 'turn') return room.turn === i;
    if (room.phase === 'challenged' || room.phase === 'starter') return other(room.duel.challenger) === i;
    if (room.phase === 'placing') return placer(room)?.seat === i;
    if (room.phase === 'sudden') return room.duel.sudden.picks[i] === null;
    if (room.phase === 'duelOver') return !room.seats[i].ready;
    return false;
  };
  return {
    players: room.seats.flatMap((seat, i) => (seat ? [{ ...seatScoreboardEntry(seat, i, { score: seat.score, me, current: current(i), online }), ...(room.phase === 'duelOver' ? { ready: seat.ready } : {}) }] : [])),
    rounds: room.history,
    lowIsBetter: false,
    target: room.target,
  };
}

/**
 * What one person may see.  The other player's faces are never in here, and neither are the stacks or the graveyard:
 * only how many cards are in them.
 *
 * @param {object} room
 * @param {number} userId  the account looking
 * @param {{ online?: (id: number) => boolean, asSeat?: number }} [options]
 * @returns {object} the view sent to that person
 * Side effects: none.
 */
export function viewFor(room, userId, { online = () => true, asSeat } = {}) {
  const me = asSeat ?? seatOf(room, userId);
  const mine = me === 0 || me === 1 ? me : -1;
  const theirs = mine === -1 ? -1 : other(mine);
  return {
    code: room.code,
    phase: room.phase,
    target: room.target,
    you: mine,
    isHost: room.hostId === userId,
    seatCount: sizeOf(room),
    playing: wouldPlay(room, SEATS),
    limits: { targets: TARGETS, min: SEATS, max: SEATS, fillTo: SEATS },
    seats: room.seats.map((seat, i) =>
      seat
        ? {
            seat: i,
            name: seat.name,
            kind: seat.kind,
            bot: isBot(seat),
            gone: isGone(seat),
            host: isHuman(seat) && seat.id === room.hostId,
            online: isBot(seat) || (isHuman(seat) && online(seat.id)),
            score: seat.score,
            ready: seat.ready,
            ai: isBot(seat) && room.phase !== 'lobby' ? describeAI(seat.ai) : null,
            cards: room.hands[i]?.length ?? 0,
            special: room.duel && room.duel.starter !== null ? room.duel.special[i] : null,
          }
        : null,
    ),
    turn: room.phase === 'lobby' || room.phase === 'finished' ? null : room.turn,
    marker: room.marker,
    hand: mine === -1 ? [] : [...room.hands[mine]],
    theirHand: theirs === -1 ? [] : room.hands[theirs].map((id) => cardView(id, false)),
    placer: room.phase === 'placing' ? placer(room) : null,
    duel: duelView(room, mine),
    duelNo: room.duelNo,
    stacks: room.stacks.map((stack) => stack.length),
    graveyard: room.graveyard.length,
    log: recentMoves(room, 40),
    winner: room.winner,
    scoreboard: scoreboardView(room, mine, online),
  };
}

/** An AI as a view may show it: its name and nothing else. */
function describeAI(id) {
  const ai = aiById(AIS, id);
  return ai ? { id: ai.id, name: ai.name } : null;
}

/**
 * The result of a finished game for ctx.stats.record: people only.
 *
 * @param {object} room  a finished room
 * @returns {object[]} one row per account
 * Side effects: none.
 */
export function statsPlayers(room) {
  const places = placements(Object.fromEntries(room.seats.map((seat, i) => [i, seat.score])));
  return statsRows(room.seats, (seat, i) => ({
    outcome: i === room.winner ? 'win' : 'loss',
    placement: places[i],
    score: seat.score,
    extras: extrasOf(seat.stats, STAT_KEYS),
  }));
}
