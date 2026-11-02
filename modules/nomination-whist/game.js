// The rules of Nomination Whist, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error, params? }, where `error` is a refusal code (a key under
// `errors.` in the game's own locale file or the site's, see shared/seats.js); anything else a client will show is a
// message, { key, params } from shared/messages.js, never a sentence.
// Depends on shared/ (cards, seats, scores, tally, tricks, ai), ./trick.js for the card rules, ./tally.js for the statistics
// and ./ai for the computer players; the sockets and timers are in server.js.
//
// Seats run clockwise: the player to your left is seat + 1, so play and nominations go round in increasing seat order.
// A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer player ({ kind: 'bot', id: 'bot:<n>',
// name }), a person who left after the game ended ({ kind: 'gone', name }) or null (empty, lobby only).
import { deckFor, isJoker, shuffle, sortHand } from '../../shared/cards.js';
import { msg, suitMsg } from '../../shared/messages.js';
import { placements, seatScoreboardEntry } from '../../shared/scores.js';
import { extrasOf, statsRows } from '../../shared/tally.js';
import { nextSeat, turnAfterPlay } from '../../shared/tricks.js';
import { AIS } from './ai/index.js';
import { contextModel, lutv } from './ai/lut.js';
import { handModel } from './sim/hand-model.js';
import { FULL_HAND, newTally, STAT_KEYS, tallyRound } from './tally.js';
import { ledSuit, legalCards as legalCardsFor, winningCard } from './trick.js';
import { aiById, assignAIs, pickAI } from '../../shared/ai.js';
import { DEFAULT_BOT_NAMES, asHost, botSeats, createSeatRules, fail, freeGoneSeats, goneSeat, hasPlayer, hostInLobby, humanSeats, isBot, isGone, isHuman, ok, seatOf } from '../../shared/seats.js';

export const MIN_SEATS = 3;
export const MAX_SEATS = 7;
export const LENGTHS = ['full', 'short'];
export const DEFAULT_SETTINGS = { seats: 4, length: 'full', missPoints: true, instantWin: true, jokers: false, hints: true };
export const FULL_SCHEDULE = [7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7];
export const SHORT_SCHEDULE = [7, 6, 5, 4, 3, 2, 1];
export const TRUMP_ORDER = ['H', 'C', 'D', 'S', null];
export const HIT_BONUS = 10;
/** Nominating this many (a full 7-card hand) and winning every trick in the first or last round wins the game. */
export const INSTANT_WIN_TRICKS = FULL_HAND;
export { STAT_KEYS };
/**
 * Whether the instant win is on. Games saved before the option existed have it on.
 *
 * @param {object} settings  the room's settings
 * @returns {boolean} false only if the setting was explicitly turned off
 * Side effects: none.
 */
export const instantWinOn = (settings) => settings.instantWin !== false;
/**
 * Whether the nomination hint is on. Games saved before the option existed have hints on.
 *
 * @param {object} settings  the room's settings
 * @returns {boolean} false only if the setting was explicitly turned off
 * Side effects: none.
 */
export const hintsOn = (settings) => settings.hints !== false;
/** The names computer players are given (the shared list). */
export const BOT_NAMES = DEFAULT_BOT_NAMES;

const LIVE = ['lobby', 'nominating', 'playing', 'roundEnd'];
const MID_GAME = ['nominating', 'playing', 'roundEnd'];

/**
 * Is the game still going (not finished)? Finished rooms are kept for a day, live ones for a week.
 *
 * @param {object} room  the room (not changed)
 * @returns {boolean} true unless the game has finished
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);
// The seat vocabulary is shared (shared/seats.js); it is re-exported because the server, the AIs and the tests import it from here.
export { hasPlayer, humanSeats, isBot, isHuman, seatOf };

// ---- the shape of a game ----

/**
 * The cards dealt in each round of a game, in order.
 *
 * @param {object} settings  the room's settings (length 'full' or 'short')
 * @returns {number[]} hand sizes by round
 * Side effects: none.
 */
export const scheduleFor = (settings) => (settings.length === 'short' ? SHORT_SCHEDULE : FULL_SCHEDULE);
/**
 * How many rounds a game lasts.
 *
 * @param {object} settings  the room's settings
 * @returns {number} the number of rounds
 * Side effects: none.
 */
export const roundCount = (settings) => scheduleFor(settings).length;
/**
 * Cards dealt in a round (0-based).
 *
 * @param {object} settings  the room's settings
 * @param {number} round  the zero-based round
 * @returns {number} the hand size
 * Side effects: none.
 */
export const handSize = (settings, round) => scheduleFor(settings)[round];
/**
 * The trump suit of a round (0-based): H, C, D, S, or null for no trumps; the order repeats.
 *
 * @param {number} round  the zero-based round
 * @returns {string | null} the suit letter, or null for no trumps
 * Side effects: none.
 */
export const trumpOf = (round) => TRUMP_ORDER[round % TRUMP_ORDER.length];
/**
 * The trump suit as a message the client puts into words (shared/messages.js): the site's name for the suit, or the
 * game's own "no trumps".
 *
 * @param {string | null} trump  the suit letter, or null
 * @returns {{ key: string }} the message
 * Side effects: none.
 */
export const trumpName = (trump) => (trump ? suitMsg(trump) : msg('noTrumps'));
/**
 * A short heading for a round, such as "Round 3: 5 cards, diamonds", as a message (`count` picks the plural of "card").
 *
 * @param {object} settings  the room's settings
 * @param {number} round  the zero-based round
 * @returns {{ key: string, params: object }} the label
 * Side effects: none.
 */
export const roundLabel = (settings, round) => {
  const cards = handSize(settings, round);
  return msg('round.label', { n: round + 1, count: cards, trump: trumpName(trumpOf(round)) });
};
/**
 * The dealer of a round (0-based), given the first round's dealer: the deal passes clockwise each round.
 *
 * @param {number} firstDealer  the first round's dealer seat
 * @param {number} round  the zero-based round
 * @param {number} seats  the number of seats
 * @returns {number} the dealer's seat
 * Side effects: none.
 */
export const dealerFor = (firstDealer, round, seats) => (firstDealer + round) % seats;

/**
 * The one number the dealer may not nominate: the one that makes the nominations total the tricks available (so that
 * somebody must always miss).
 *
 * @param {number} cards  the hand size, which is also the number of tricks
 * @param {number} othersTotal  the sum of everybody else's nominations
 * @returns {number | null} the forbidden number, or null when it would be negative (nothing is forbidden)
 * Side effects: none.
 */
export const forbiddenNomination = (cards, othersTotal) => (cards - othersTotal >= 0 ? cards - othersTotal : null);

/**
 * What a player scores in a round. Exactly right: 10 plus the nomination. A miss: the tricks taken, or nothing.
 *
 * @param {number} bid  the nomination
 * @param {number} taken  the tricks won
 * @param {object} settings  the room's settings (missPoints)
 * @returns {number} the points
 * Side effects: none.
 */
export function scoreRound(bid, taken, settings) {
  if (bid === taken) return HIT_BONUS + bid;
  return settings.missPoints ? taken : 0;
}

/**
 * Whether a round (0-based) can end the game on the spot: the first round, or the last if it is a 7-card round.
 *
 * @param {object} settings  the room's settings
 * @param {number} round  the zero-based round
 * @returns {boolean} true if a made 7 here would win the game
 * Side effects: none.
 */
export const isInstantWinRound = (settings, round) =>
  handSize(settings, round) === INSTANT_WIN_TRICKS && (round === 0 || round === roundCount(settings) - 1);

/**
 * The seats with the highest total (more than one on a tie).
 *
 * @param {number[]} scores  totals by seat
 * @returns {number[]} the winning seats
 * Side effects: none.
 */
export const winnersOf = (scores) => scores.flatMap((score, seat) => (score === Math.max(...scores) ? [seat] : []));

/**
 * Checks a settings change and merges it over the current settings.
 *
 * @param {object} input  the settings sent (any subset of seats, length, missPoints, instantWin, jokers, hints)
 * @param {object} [current=DEFAULT_SETTINGS]  the settings to change
 * @returns {{ ok: boolean, settings?: object, error?: string }} the new settings, or why they are refused
 * Side effects: none.
 */
export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  if (input?.seats !== undefined) {
    if (!Number.isInteger(input.seats) || input.seats < MIN_SEATS || input.seats > MAX_SEATS) return fail('playersRange', { min: MIN_SEATS, max: MAX_SEATS });
    next.seats = input.seats;
  }
  if (input?.length !== undefined) {
    if (!LENGTHS.includes(input.length)) return fail('lengthSetting');
    next.length = input.length;
  }
  if (input?.missPoints !== undefined) {
    if (typeof input.missPoints !== 'boolean') return fail('missPointsSetting');
    next.missPoints = input.missPoints;
  }
  if (input?.instantWin !== undefined) {
    if (typeof input.instantWin !== 'boolean') return fail('instantWinSetting');
    next.instantWin = input.instantWin;
  }
  if (input?.jokers !== undefined) {
    if (typeof input.jokers !== 'boolean') return fail('jokersSetting');
    next.jokers = input.jokers;
  }
  if (input?.hints !== undefined) {
    if (typeof input.hints !== 'boolean') return fail('hintsSetting');
    next.hints = input.hints;
  }
  return ok({ settings: next });
}

/**
 * A new lobby room with the host in seat 0.
 *
 * @param {object} args
 * @param {string} args.code  the room code
 * @param {*} args.hostId  the host's account id
 * @param {string} args.hostName  the host's display name
 * @param {object} [args.settings={}]  the settings to start with (merged over the defaults)
 * @param {number} args.now  the creation time in milliseconds
 * @returns {object} the room
 * Side effects: none (throws if the settings are invalid).
 */
export function createRoom({ code, hostId, hostName, settings = {}, now }) {
  const normalised = normaliseSettings(settings);
  if (!normalised.ok) throw new Error(`A room cannot be created with those settings (${normalised.error}).`);
  const room = {
    code,
    hostId,
    phase: 'lobby',
    settings: normalised.settings,
    seats: [{ kind: 'human', id: hostId, name: hostName }, ...Array(normalised.settings.seats - 1).fill(null)],
    nextBot: 1,
    createdAt: now,
    updatedAt: now,
  };
  resetGame(room);
  return room;
}

/**
 * Puts the game state back to the start (scores, tallies, history and the round's cards), keeping seats and settings.
 *
 * @param {object} room  mutates every game field
 * @returns {void}
 * Side effects: overwrites the room's game state.
 */
function resetGame(room) {
  const n = room.seats.length;
  Object.assign(room, {
    roundIndex: 0,
    dealer: 0,
    scores: Array(n).fill(0),
    tally: Array.from({ length: n }, newTally),
    history: [],
    winners: null,
    instantWin: null,
    recorded: false,
    hands: Array.from({ length: n }, () => []),
    nominations: Array(n).fill(null),
    taken: Array(n).fill(0),
    trick: [],
    lastTrick: null,
    played: [],
    tricksPlayed: 0,
    turn: null,
  });
}

// ---- seats and settings ----

/**
 * The seat rules (joining, leaving, kicking and the computer players) are the shared ones from shared/seats.js. What is
 * particular to Nomination Whist:
 *   - "mid-game" is any phase from nominating to the round-end pop-up;
 *   - a person who leaves mid-game is replaced by a computer player that picks its own AI (takeOver);
 *   - if they were the only person the round-end pop-up was waiting for, the next round is dealt (afterRemoval);
 *   - a person who leaves a finished game leaves a { kind: 'gone', name } marker so the final scores still make sense.
 * The shared kick refuses a finished game, so the host cannot eject anybody once the game is over.
 */
const seats = createSeatRules({
  isMidGame: (room) => MID_GAME.includes(room.phase),
  botNames: BOT_NAMES,
  takeOver: (room, bot, seat, rng) => ({ ...bot, ai: pickAI(AIS, rng).id }),
  afterRemoval: (room, rng) => advanceIfReady(room, rng),
  finishedSeat: goneSeat,
});
export const { addHuman, addBot, removeBot, fillWithBots, kick, removeHuman } = seats;

/**
 * Changes the number of seats: the people and computer players keep their order, and surplus computer players go.
 *
 * @param {object} room   the room (lobby only); mutates room.seats
 * @param {number} count  the new number of seats
 * @returns {{ ok: boolean, error?: string }} fails, changing nothing, when there are more people than seats
 */
function resizeSeats(room, count) {
  const occupants = room.seats.filter(Boolean);
  while (occupants.length > count) {
    const index = occupants.findLastIndex(isBot);
    if (index === -1) return fail('removeBeforeFewerSeats');
    occupants.splice(index, 1);
  }
  room.seats = [...occupants, ...Array(count - occupants.length).fill(null)];
  return ok();
}

/**
 * The host changes the game's settings (lobby only). Changing the number of seats resizes the table and resets the game.
 *
 * @param {object} room    mutates room.settings, and room.seats and the scores if the seat count changes
 * @param {*} userId       the account asking; must be the host
 * @param {object} input   the settings to change (see normaliseSettings)
 * @returns {{ ok: boolean, error?: string }}
 */
export function setSettings(room, userId, input) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  const next = normaliseSettings(input, room.settings);
  if (!next.ok) return next;
  if (next.settings.seats !== room.seats.length) {
    const resized = resizeSeats(room, next.settings.seats);
    if (!resized.ok) return resized;
    resetGame(room);
  }
  room.settings = next.settings;
  return ok();
}

// ---- rounds ----

/**
 * The host starts the game: picks the first dealer, deals round one and gives every computer player its AI.
 *
 * @param {object} room  mutates the whole room (resets it, deals, sets the phase to 'nominating')
 * @param {*} userId     the account asking; must be the host
 * @param {() => number} rng  random numbers for the dealer, the deal and the AIs
 * @returns {{ ok: boolean, error?: string }}
 */
export function start(room, userId, rng) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('seatsNeedPlayers');
  if (!humanSeats(room).length) return fail('needPerson');
  resetGame(room);
  room.dealer = Math.floor(rng() * room.seats.length);
  dealRound(room, rng);
  assignBotAIs(room, rng);
  return ok();
}

/**
 * Every computer player picks the AI it will play this game with (kept on the seat, so it survives a restart).
 *
 * @param {object} room  mutates `ai` on every computer player's seat
 * @param {() => number} rng  random numbers for the choice
 * @returns {void}
 * Side effects: sets `ai` on the computer players' seats.
 */
function assignBotAIs(room, rng) {
  const bots = botSeats(room);
  const chosen = assignAIs(AIS, bots, rng);
  room.seats.forEach((s, i) => {
    if (isBot(s)) s.ai = chosen[i];
  });
}

/**
 * Deals the current round: shuffles, deals sorted hands, clears the round's state and puts the player after the dealer to nominate.
 *
 * @param {object} room  mutates hands, nominations, taken, trick, played, phase and turn
 * @param {() => number} rng  random numbers for the shuffle
 * @returns {void}
 * Side effects: mutates the room as described.
 */
export function dealRound(room, rng) {
  const n = room.seats.length;
  const cards = handSize(room.settings, room.roundIndex);
  const deck = shuffle(deckFor(room.settings.jokers === true), rng);
  room.hands = Array.from({ length: n }, (_, i) => sortHand(deck.slice(i * cards, (i + 1) * cards), trumpOf(room.roundIndex)));
  room.nominations = Array(n).fill(null);
  room.taken = Array(n).fill(0);
  room.trick = [];
  room.lastTrick = null;
  room.played = [];
  room.tricksPlayed = 0;
  room.phase = 'nominating';
  room.turn = (room.dealer + 1) % n;
}

/**
 * The hand size of the round in play.
 *
 * @param {object} room  not changed
 * @returns {number} the cards each player holds at the start of the round
 * Side effects: none.
 */
export const cardsThisRound = (room) => handSize(room.settings, room.roundIndex);
/**
 * The trump suit of the round in play.
 *
 * @param {object} room  not changed
 * @returns {string | null} the suit letter, or null for no trumps
 * Side effects: none.
 */
export const trumpThisRound = (room) => trumpOf(room.roundIndex);

/**
 * The number the dealer may not nominate right now, or null (it is not the dealer's turn).
 *
 * @param {object} room  not changed
 * @returns {number | null} the forbidden number, or null
 * Side effects: none.
 */
export function forbiddenNow(room) {
  if (room.phase !== 'nominating' || room.turn !== room.dealer) return null;
  const others = room.nominations.reduce((sum, bid, seat) => sum + (seat === room.dealer ? 0 : (bid ?? 0)), 0);
  return forbiddenNomination(cardsThisRound(room), others);
}

/**
 * The numbers a seat may nominate on its turn.
 *
 * @param {object} room  not changed
 * @param {number} seat  the nominating seat
 * @returns {number[]} 0 to the hand size, without the dealer's forbidden number when the seat is the dealer
 * Side effects: none.
 */
export function allowedNominations(room, seat) {
  const forbidden = seat === room.dealer ? forbiddenNow(room) : null;
  return Array.from({ length: cardsThisRound(room) + 1 }, (_, n) => n).filter((n) => n !== forbidden);
}

/**
 * A seat nominates the number of tricks it will take. After the dealer the round moves to play.
 *
 * @param {object} room  mutates nominations, turn and (after the dealer) phase
 * @param {number} seat  the nominating seat
 * @param {number} number  the nomination
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as described; the room is unchanged when it fails.
 */
export function nominate(room, seat, number) {
  if (room.phase !== 'nominating') return fail('notTimeToNominate');
  if (room.turn !== seat) return fail('notYourTurnToNominate');
  const cards = cardsThisRound(room);
  if (!Number.isInteger(number) || number < 0 || number > cards) return fail('nominateRange', { max: cards });
  if (seat === room.dealer && number === forbiddenNow(room)) {
    return fail('dealerForbidden', { number, cards });
  }
  room.nominations[seat] = number;
  if (seat === room.dealer) {
    room.phase = 'playing';
    room.turn = nextSeat(room.dealer, room.seats.length);
  } else {
    room.turn = nextSeat(seat, room.seats.length);
  }
  return ok();
}

// ---- playing ----

/**
 * Why this card cannot be played now, or null when it can: it must be in the hand, follow the suit led when it can, and a Joker
 * only goes down when the player cannot follow (see trick.js).
 *
 * @param {object} room  not changed
 * @param {number} seat  the seat playing
 * @param {string} card  the card it wants to play
 * @returns {{ key: string, params?: object } | null} the reason as a message (an `errors.` key, see shared/messages.js),
 *   or null when the card is legal
 */
export function illegalReason(room, seat, card) {
  const hand = room.hands[seat];
  if (!hand.includes(card)) return msg('errors.notInHand');
  const trick = room.trick.map((p) => p.card);
  if (legalCardsFor(hand, trick).includes(card)) return null;
  const led = suitMsg(ledSuit(trick));
  return isJoker(card) ? msg('errors.jokerOnlyWhenVoid', { suit: led }) : msg('errors.followSuit', { suit: led });
}

/**
 * The cards a seat may play right now.
 *
 * @param {object} room  not changed
 * @param {number} seat  the seat
 * @returns {string[]} the legal cards from its hand
 * Side effects: none.
 */
export const legalCards = (room, seat) => room.hands[seat].filter((card) => illegalReason(room, seat, card) === null);

/**
 * Plays a card to the trick, if the seat may.
 * Side effects: takes the card from the hand, adds it to the trick and the played pile, and moves the turn on (to nobody once the trick is full).
 *
 * @param {object} room  mutated as described
 * @param {number} seat  the seat playing
 * @param {string} card  the card to play
 * @returns {{ ok: boolean, error?: string, complete?: boolean }} `complete` says the trick is now full
 */
export function playCard(room, seat, card) {
  if (room.phase !== 'playing') return fail('notPlaying');
  if (room.turn !== seat) return fail('notYourTurn');
  if (typeof card !== 'string') return fail('notACard');
  const reason = illegalReason(room, seat, card);
  if (reason) return fail(reason.key.slice('errors.'.length), reason.params);
  const n = room.seats.length;
  room.hands[seat] = room.hands[seat].filter((c) => c !== card);
  room.trick.push({ seat, card });
  room.played.push(card);
  room.turn = turnAfterPlay(seat, room.trick.length, n);
  return ok({ complete: room.trick.length === n });
}

/**
 * The seat winning a (possibly unfinished) trick: see trick.js for the rules, including the Jokers.
 *
 * @param {{ seat: number, card: string }[]} trick  in the order played; not empty
 * @param {string | null} trump  the round's trump suit, or null for none
 * @returns {number} the seat
 */
export function trickWinner(trick, trump) {
  const best = winningCard(trick.map((p) => p.card), trump);
  return trick.find((p) => p.card === best).seat;
}

/**
 * Gives a finished trick to its winner, who leads next; after the last trick the round is scored.
 *
 * @param {object} room  mutates taken, lastTrick, trick, tricksPlayed and turn (and, via endRound, the scores and phase)
 * @returns {{ ok: boolean, error?: string, winner?: number, roundOver?: boolean }}
 * Side effects: as described; the room is unchanged when there is no finished trick.
 */
export function resolveTrick(room) {
  if (room.phase !== 'playing' || room.trick.length !== room.seats.length) return fail('noFinishedTrick');
  const winner = trickWinner(room.trick, trumpThisRound(room));
  room.taken[winner]++;
  room.lastTrick = { plays: room.trick, winner };
  room.trick = [];
  room.tricksPlayed++;
  if (room.tricksPlayed === cardsThisRound(room)) {
    room.turn = null;
    endRound(room);
    return ok({ winner, roundOver: true });
  }
  room.turn = winner;
  return ok({ winner, roundOver: false });
}

/**
 * Scores the round: adds the points, records the tallies and history, and decides what comes next (an instant win or the last
 * round finishes the game; otherwise the round-end pop-up).
 *
 * @param {object} room  mutates scores, tally, history, phase, winners, instantWin and ready
 * @returns {void}
 * Side effects: as described.
 */
function endRound(room) {
  const points = room.nominations.map((bid, seat) => scoreRound(bid, room.taken[seat], room.settings));
  room.scores = room.scores.map((score, seat) => score + points[seat]);
  const onlyOneMadeIt = room.nominations.filter((bid, seat) => bid === room.taken[seat]).length === 1;
  room.nominations.forEach((bid, seat) => tallyRound(room.tally[seat], { bid, taken: room.taken[seat], onlyOneMadeIt }));
  room.history.push({
    round: room.roundIndex + 1,
    cards: cardsThisRound(room),
    trump: trumpThisRound(room),
    dealer: room.dealer,
    bids: [...room.nominations],
    taken: [...room.taken],
    points,
  });
  const instant =
    instantWinOn(room.settings) && isInstantWinRound(room.settings, room.roundIndex)
      ? room.nominations.findIndex((bid, seat) => bid === INSTANT_WIN_TRICKS && room.taken[seat] === INSTANT_WIN_TRICKS)
      : -1;
  if (instant !== -1) {
    room.history.at(-1).instantWin = instant;
    room.instantWin = instant;
    room.phase = 'finished';
    room.winners = [instant];
  } else if (room.roundIndex + 1 >= roundCount(room.settings)) {
    room.phase = 'finished';
    room.winners = winnersOf(room.scores);
  } else {
    room.phase = 'roundEnd';
    room.ready = [];
  }
}

/**
 * A person is ready for the next round (they closed the score pop-up); it is dealt once every person is.
 *
 * @param {object} room  mutates ready, and deals when everybody is ready
 * @param {*} userId  the account that closed the pop-up
 * @param {() => number} rng  random numbers for the deal
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as described.
 */
export function nextRound(room, userId, rng) {
  if (!hasPlayer(room, userId)) return fail('notInGame');
  if (room.phase !== 'roundEnd') return fail('roundNotOver');
  room.ready ??= [];
  const seat = seatOf(room, userId);
  if (!room.ready.includes(seat)) room.ready.push(seat);
  advanceIfReady(room, rng);
  return ok();
}

/**
 * Deals the next round if the game is at the round-end pop-up and every person has closed it.
 *
 * @param {object} room  mutates the room (deals) when everybody is ready
 * @param {() => number} rng  random numbers for the deal
 * @returns {boolean} whether a new round was dealt
 */
function advanceIfReady(room, rng) {
  if (room.phase !== 'roundEnd') return false;
  room.ready ??= [];
  if (!humanSeats(room).every((seat) => room.ready.includes(seat))) return false;
  dealNext(room, rng);
  return true;
}

/**
 * Moves on a round: the deal passes clockwise and the new round is dealt.
 *
 * @param {object} room  mutates roundIndex, dealer, ready and the round's cards
 * @param {() => number} rng  random numbers for the deal
 * @returns {void}
 * Side effects: as described.
 */
function dealNext(room, rng) {
  room.roundIndex++;
  room.dealer = (room.dealer + 1) % room.seats.length;
  room.ready = [];
  dealRound(room, rng);
}

/**
 * Deals the next round whether or not everyone has closed the pop-up (the server does this after a wait).
 *
 * @param {object} room  mutates as dealNext does
 * @param {() => number} rng  random numbers for the deal
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: as described.
 */
export function forceNextRound(room, rng) {
  if (room.phase !== 'roundEnd') return fail('roundNotOver');
  dealNext(room, rng);
  return ok();
}

/**
 * Whether the game is waiting for people to close the round-end pop-up.
 *
 * @param {object} room  not changed
 * @returns {boolean} true in the roundEnd phase
 * Side effects: none.
 */
export const waitingForReady = (room) => room.phase === 'roundEnd';

/**
 * The host takes everybody back to the lobby after the game: markers for people who left are cleared and the game reset.
 *
 * @param {object} room  mutates seats, scores and phase
 * @param {*} userId     the account asking; must be the host
 * @returns {{ ok: boolean, error?: string }}
 */
export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('notOver');
  freeGoneSeats(room);
  for (const s of room.seats) if (s) delete s.ai;
  resetGame(room);
  room.phase = 'lobby';
  return ok();
}

/**
 * What the statistics should record for a finished game: one entry per human still seated. An instant winner is placed first
 * whatever the totals.
 *
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}
 * Side effects: none.
 */
export function statsPlayers(room) {
  const place = placements(Object.fromEntries(room.scores.map((score, seat) => [seat, score])));
  if (room.instantWin !== null && room.instantWin !== undefined) {
    // The instant winner is first whatever the totals; everybody else is ranked by theirs, below the winner.
    const others = placements(Object.fromEntries(room.scores.flatMap((score, seat) => (seat === room.instantWin ? [] : [[seat, score]]))));
    for (const seat of Object.keys(others)) place[seat] = others[seat] + 1;
    place[room.instantWin] = 1;
  }
  return statsRows(room.seats, (seat, i) => ({
    outcome: room.winners.includes(i) ? 'win' : 'loss',
    placement: place[i],
    score: room.scores[i],
    // extrasOf, not a spread: a room saved before a counter existed then records 0 for it rather than nothing.
    extras: { ...extrasOf(room.tally[i], STAT_KEYS), perfectGames: room.tally[i].roundsPlayed > 0 && room.tally[i].bidsMade === room.tally[i].roundsPlayed ? 1 : 0, instantWins: room.instantWin === i ? 1 : 0, scoredOver100: room.scores[i] > 100 ? 1 : 0 },
  }));
}

// ---- computer players ----

/**
 * The next thing a computer (or the clock) has to do, or null when the game waits for a person.
 *
 * @param {object} room  not changed
 * @returns {{ type: 'nominate' | 'play' | 'resolve', seat?: number, key: string } | null} the action, or null; `key` names
 *   it and stays the same while unrelated things happen, so the server's timer for it is not restarted by them
 * Side effects: none.
 */
export function pendingAction(room) {
  if (room.phase === 'nominating') return isBot(room.seats[room.turn]) ? { type: 'nominate', seat: room.turn, key: `nominate:${room.turn}:${room.roundIndex}` } : null;
  if (room.phase !== 'playing') return null;
  if (room.trick.length === room.seats.length) return { type: 'resolve', key: `resolve:${room.roundIndex}:${room.tricksPlayed}` };
  return isBot(room.seats[room.turn]) ? { type: 'play', seat: room.turn, key: `play:${room.turn}:${room.roundIndex}:${room.tricksPlayed}:${room.trick.length}` } : null;
}

/**
 * The AI a computer player plays with; rooms saved before AIs existed fall back to the first one.
 *
 * @param {object} room  not changed
 * @param {number} seat  the computer player's seat
 * @returns {object} the AI
 * Side effects: none.
 */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat]?.ai);

/**
 * What an AI may know when it nominates: its own hand and the public table, never anybody else's cards.
 *
 * @param {object} room  not changed
 * @param {number} seat  the nominating seat
 * @param {() => number} rng  random numbers for the AI
 * @returns {object} the nomination context (copies of the room's arrays, so an AI cannot change the room)
 * Side effects: none.
 */
export function nominateContext(room, seat, rng) {
  return {
    hand: [...room.hands[seat]],
    trump: trumpThisRound(room),
    players: room.seats.length,
    allowed: allowedNominations(room, seat),
    instantWin: instantWinOn(room.settings) && isInstantWinRound(room.settings, room.roundIndex),
    missPoints: room.settings.missPoints !== false,
    jokers: room.settings.jokers === true,
    scores: [...room.scores],
    round: room.roundIndex,
    rounds: roundCount(room.settings),
    seat,
    dealer: room.dealer,
    cards: cardsThisRound(room),
    nominations: [...room.nominations],
    rng,
  };
}

/**
 * The same for a card to play: the trick so far, what has been played, and everybody's nominations and tricks.
 *
 * @param {object} room  not changed
 * @param {number} seat  the playing seat
 * @param {() => number} rng  random numbers for the AI
 * @returns {object} the play context (copies of the room's arrays)
 * Side effects: none.
 */
export function playContext(room, seat, rng) {
  return {
    hand: [...room.hands[seat]],
    legal: legalCards(room, seat),
    trick: room.trick.map((p) => p.card),
    trickPlays: room.trick.map((p) => ({ ...p })),
    trump: trumpThisRound(room),
    played: [...room.played],
    need: room.nominations[seat] - room.taken[seat],
    players: room.seats.length,
    seat,
    nominations: [...room.nominations],
    taken: [...room.taken],
    handSizes: room.hands.map((h) => h.length),
    cards: cardsThisRound(room),
    instantWin: instantWinOn(room.settings) && isInstantWinRound(room.settings, room.roundIndex),
    missPoints: room.settings.missPoints !== false,
    jokers: room.settings.jokers === true,
    rng,
  };
}

/**
 * The card a computer player would play: always one of its legal cards (an AI that answers illegally is overruled).
 *
 * @param {object} room  not changed
 * @param {number} seat  the computer player's seat
 * @param {() => number} rng  random numbers for the AI
 * @returns {string} the card
 * Side effects: may advance rng.
 */
export function botPlay(room, seat, rng) {
  const context = playContext(room, seat, rng);
  const card = aiOf(room, seat).play(context);
  return context.legal.includes(card) ? card : AIS[0].play(context);
}

/**
 * The nomination the bid-value table suggests to the person whose turn it is to nominate: the allowed number (so never the
 * dealer's forbidden one) that was worth most in simulated games from their own cards, their table position and what the
 * players before them have nominated, with the player then playing to it. From the table learned for games with or without
 * the Jokers (falling back to the table-aware one where it has nothing). Null at any other time, so nobody is told it early,
 * and always null when the host has turned hints off.
 *
 * @param {object} room  not changed
 * @param {number} seat  the viewer's seat
 * @returns {number | null} the suggested nomination, or null
 * Side effects: none (it uses a fixed random source, so the hint is steady); may load tables from disk once.
 */
export function suggestedNomination(room, seat) {
  if (!hintsOn(room.settings) || room.phase !== 'nominating' || room.turn !== seat) return null;
  if (room.settings.jokers && !handModel(true) && !contextModel(true)) return null; // nothing has been learned for games with Jokers, and the plain table would mislead
  // Without the scores the table's own opinion is given: the computer players' last-chance push towards 7 is never suggested.
  const context = { ...nominateContext(room, seat, () => 0.5), scores: undefined };
  const number = lutv.nominate(context);
  return context.allowed.includes(number) ? number : null;
}

/**
 * The number a computer player would nominate: always an allowed one (an AI that answers illegally is overruled).
 *
 * @param {object} room  not changed
 * @param {number} seat  the computer player's seat
 * @param {() => number} rng  random numbers for the AI
 * @returns {number} the nomination
 * Side effects: may advance rng.
 */
export function botNominate(room, seat, rng) {
  const context = nominateContext(room, seat, rng);
  const number = aiOf(room, seat).nominate(context);
  return context.allowed.includes(number) ? number : AIS[0].nominate(context);
}

/**
 * Performs a pending action. Returns the action, or null if there was nothing to do.
 *
 * @param {object} room  mutated by the nomination, play or trick resolution
 * @param {() => number} rng  random numbers for the AI
 * @returns {{ type: string, seat?: number } | null} the action performed, or null
 * Side effects: as the action does; throws if a computer player makes an illegal move.
 */
export function runPending(room, rng) {
  const action = pendingAction(room);
  if (!action) return null;
  const result =
    action.type === 'nominate'
      ? nominate(room, action.seat, botNominate(room, action.seat, rng))
      : action.type === 'play'
        ? playCard(room, action.seat, botPlay(room, action.seat, rng))
        : resolveTrick(room);
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}

// ---- what each player may see ----

/**
 * The standard scoreboard rounds (shared/scores.js), plus the detail the round table shows. The round's `label` and each
 * player's note ("bid 2, took 1") are messages (shared/messages.js), put into words by the client.
 *
 * @param {object} room  not changed
 * @returns {object[]} one entry per scored round
 * Side effects: none.
 */
export function roundsView(room) {
  return room.history.map((h) => ({
    label: roundLabel(room.settings, h.round - 1),
    deltas: Object.fromEntries(h.points.map((points, seat) => [seat, points])),
    notes: Object.fromEntries(h.bids.map((bid, seat) => [seat, msg('round.note', { bid, taken: h.taken[seat] })])),
    round: h.round,
    cards: h.cards,
    trump: h.trump,
    dealer: h.dealer,
    bids: h.bids,
    taken: h.taken,
    instantWin: h.instantWin ?? null,
  }));
}

/**
 * An AI as the table shows it: its id and name.
 *
 * @param {{ id: string, name: string }} ai  the AI
 * @returns {{ id: string, name: string }}
 * Side effects: none.
 */
const aiSummary = ({ id, name }) => ({ id, name });

/**
 * One occupied seat as the table shows it to everybody.
 *
 * @param {object} room  not changed
 * @param {number} i  the seat's index
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object} the seat's public fields (cards held, nomination, tricks, score, readiness)
 * Side effects: none.
 */
function seatView(room, i, online) {
  const seat = room.seats[i];
  return {
    seat: i,
    name: seat.name,
    bot: isBot(seat),
    ai: isBot(seat) && room.phase !== 'lobby' ? aiSummary(aiOf(room, i)) : null,
    away: isGone(seat) || (isHuman(seat) && !online(seat.id)),
    cards: room.hands[i].length,
    bid: room.nominations[i],
    tricks: room.taken[i],
    score: room.scores[i],
    ready: room.phase === 'roundEnd' ? isBot(seat) || Boolean(room.ready?.includes(i)) : false,
  };
}

/**
 * The round being played: its number, size, trump and dealer.
 *
 * @param {object} room  not changed
 * @returns {object} number, total, cards, trump, dealer and label
 * Side effects: none.
 */
function roundView(room) {
  const round = room.roundIndex;
  return {
    number: round + 1,
    total: roundCount(room.settings),
    cards: handSize(room.settings, round),
    trump: trumpOf(round),
    dealer: room.dealer,
    label: roundLabel(room.settings, round),
  };
}

/**
 * The viewer's hand, the trick in progress and what they may play: what a viewer may see once the game has started.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {object} fields to add to the view when the game has started
 * Side effects: none.
 */
function playView(room, me) {
  const canPlay = room.phase === 'playing' && room.turn === me && room.trick.length < room.seats.length;
  return {
    round: roundView(room),
    hand: room.hands[me] ?? [],
    trick: room.trick,
    trickWinner: room.trick.length === room.seats.length ? trickWinner(room.trick, trumpOf(room.roundIndex)) : null,
    lastTrick: room.lastTrick,
    turn: room.turn,
    forbidden: forbiddenNow(room),
    suggestion: suggestedNomination(room, me),
    legal: canPlay ? Object.fromEntries(room.hands[me].map((card) => [card, illegalReason(room, me, card)])) : null,
  };
}

/**
 * The standard scoreboard (shared/scores.js): the players (with who is ready between rounds, and the instant winner
 * noted), the rounds scored so far, and that high scores win. The site reads `current` from here (its `global.slow`
 * clock), so it is built on the server like every other game's.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online
 * @returns {object}
 * Side effects: none.
 */
function scoreboardView(room, me, online) {
  const player = (seat, i) => ({
    ...seatScoreboardEntry(seat, i, { score: room.scores[i], me, current: room.turn === i, online }),
    ...(room.phase === 'roundEnd' ? { ready: isBot(seat) || Boolean(room.ready?.includes(i)) } : {}),
    ...(room.instantWin === i ? { note: msg('instantWin') } : {}),
  });
  return { players: room.seats.flatMap((seat, i) => (seat ? [player(seat, i)] : [])), rounds: roundsView(room), lowIsBetter: false };
}

/**
 * Everything one account may know: its own hand and the public table, never anybody else's cards.
 *
 * @param {object} room  not changed
 * @param {number} userId  the account looking (it may be a spectator with no seat)
 * @param {{ online?: (id: number) => boolean }} [options]  says who is connected, so the view can show who is away
 * @returns {object} the view sent to that person
 * Side effects: none.
 */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const view = {
    code: room.code,
    phase: room.phase,
    you: me,
    hostSeat: seatOf(room, room.hostId),
    settings: room.settings,
    seats: room.seats.map((seat, i) => (seat ? seatView(room, i, online) : null)),
    rounds: roundsView(room),
    scoreboard: scoreboardView(room, me, online),
    winners: room.winners,
    instantWin: room.instantWin ?? null,
    limits: { minSeats: MIN_SEATS, maxSeats: MAX_SEATS },
  };
  if (room.phase !== 'lobby') Object.assign(view, playView(room, me));
  return view;
}
