// The rules of Hearts, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// Three to seven players (the host's choice, 4 by default; see deals.js for the deal and the passing of each size).
// Seats 0..n-1 run clockwise: the player to your left is seat + 1, so passing "left" sends cards to seat + 1 and play
// goes round in increasing seat order. The number of seats is room.seats.length. A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer
// player ({ kind: 'bot', id: 'bot:<n>', name }), a person who left after the game ended ({ kind: 'gone', name }, kept so the
// final scores still make sense) or null (empty, lobby only).
// Depends on: deals.js (deal sizes and pass rotation), tally.js (statistics), ai/ (computer players) and the shared helpers
// for seats, cards, tricks, scores and AI selection under ../../shared.
import { placements, seatScoreboardEntry } from '../../shared/scores.js';
import { statsRows } from '../../shared/tally.js';
import { followCards, trickWinnerSeat, turnAfterPlay } from '../../shared/tricks.js';
import { cardName, rankValue, shuffle, sortHand, suitOf, SUIT_NAMES } from '../../shared/cards.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { DEFAULT_BOT_NAMES, asHost, botSeats, createSeatRules, emptySeats, fail, freeGoneSeats, goneSeat, hasPlayer, hostInLobby, humanSeats, isBot, isHuman, ok, seatOf } from '../../shared/seats.js';
import { AIS } from './ai/index.js';
import { newTally, STAT_KEYS, tallyExchange, tallyHand, tallyTrick } from './tally.js';
import { wantsMoon as standardWantsMoon, passStandard } from './ai/standard.js';
import { DEFAULT_SEATS, HAND_POINTS, MAX_SEATS, MIN_SEATS, deckFor, dealFor, describePass, directionName, isSeatCount, offsetFor, offsetOfDirection, openingCard, passCountFor, tricksFor } from './deals.js';

export { DEFAULT_SEATS, MAX_SEATS, MIN_SEATS, HAND_POINTS, openingCard };
export const TARGETS = [50, 100, 150];
export const MOON_MODES = ['others', 'self'];
export const DEFAULT_SETTINGS = { target: 100, jackOfDiamonds: true, moon: 'others' };
export const PASS_DIRECTIONS = ['left', 'right', 'across', 'none']; // the four-player rotation (see deals.js for the rest)
export const QUEEN = 'QS';
export const JACK = 'JD';
export const MOON_POINTS = HAND_POINTS;
export const JACK_POINTS = -5;
export { STAT_KEYS };
export const BOT_NAMES = DEFAULT_BOT_NAMES;

const LIVE = ['lobby', 'passing', 'playing', 'handEnd'];

/**
 * Whether a card is a heart.
 * @param {string} card  card code such as 'QS'.
 * @returns {boolean} true for hearts.
 * Side effects: none.
 */
export const isHeart = (card) => suitOf(card) === 'H';
/**
 * Whether a card scores penalty points on its own (a heart or the Queen of Spades; the Jack is a bonus, not a penalty).
 * @param {string} card  card code.
 * @returns {boolean} true for hearts and the Queen.
 * Side effects: none.
 */
export const isPointCard = (card) => isHeart(card) || card === QUEEN;
/**
 * Whether the room is still in progress (not finished).
 * @param {object} room  the room.
 * @returns {boolean} true in lobby, passing, playing and handEnd.
 * Side effects: none.
 */
export const isLive = (room) => LIVE.includes(room.phase);
export { hasPlayer, humanSeats, isBot, isHuman, seatOf };
/**
 * The seat a player's passed cards go to.
 * @param {number} seat  the passing seat.
 * @param {string} direction  pass direction name (see deals.js directionName).
 * @param {number} [seats]  seat count (default four).
 * @returns {number} the receiving seat.
 * Side effects: none.
 */
export const passTarget = (seat, direction, seats = DEFAULT_SEATS) => (seat + offsetOfDirection(seats, direction)) % seats;
/**
 * The seat a player's received cards come from (the inverse of passTarget).
 * @param {number} seat  the receiving seat.
 * @param {string} direction  pass direction name.
 * @param {number} [seats]  seat count (default four).
 * @returns {number} the passing seat.
 * Side effects: none.
 */
export const passSource = (seat, direction, seats = DEFAULT_SEATS) => (seat + seats - offsetOfDirection(seats, direction)) % seats;
// A fresh list of n empty card lists, one per seat.
const emptyHands = (n) => Array.from({ length: n }, () => []);

const seatsProblem = `A game has ${MIN_SEATS} to ${MAX_SEATS} players.`;

/**
 * Validates a settings change on top of the current settings (target score, Jack of Diamonds, moon scoring mode).
 * @param {object} input  the requested changes; missing keys keep their current value.
 * @param {object} [current]  the settings to start from (default DEFAULT_SETTINGS).
 * @returns {{ok: boolean, settings?: object, error?: string}} the merged settings or the first problem found.
 * Side effects: none.
 */
export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  if (input?.target !== undefined) {
    if (!TARGETS.includes(input.target)) return fail(`The target score must be ${TARGETS.slice(0, -1).join(', ')} or ${TARGETS.at(-1)}.`);
    next.target = input.target;
  }
  if (input?.jackOfDiamonds !== undefined) {
    if (typeof input.jackOfDiamonds !== 'boolean') return fail('The Jack of Diamonds setting must be on or off.');
    next.jackOfDiamonds = input.jackOfDiamonds;
  }
  if (input?.moon !== undefined) {
    if (!MOON_MODES.includes(input.moon)) return fail('Shooting the moon must score +26 for everyone else, or -26 for the shooter.');
    next.moon = input.moon;
  }
  return ok({ settings: next });
}

/**
 * Creates a new room in the lobby with the host seated.
 * @param {object} options
 * @param {string} options.code  the room code.
 * @param {number} options.hostId  the host's account id.
 * @param {string} options.hostName  the host's display name.
 * @param {object} [options.settings]  initial settings, including `seats` (3 to 7, default 4).
 * @param {number} [options.now]  creation timestamp.
 * @returns {object} the new room.
 * Side effects: none; throws an Error when the seat count or the settings are invalid.
 */
export function createRoom({ code, hostId, hostName, settings = {}, now }) {
  const seatCount = settings.seats ?? DEFAULT_SEATS;
  if (!isSeatCount(seatCount)) throw new Error(seatsProblem);
  const normalised = normaliseSettings(settings);
  const room = {
    code,
    hostId,
    phase: 'lobby',
    settings: normalised.ok ? normalised.settings : { ...DEFAULT_SETTINGS },
    seats: [{ kind: 'human', id: hostId, name: hostName }, ...emptySeats(seatCount - 1)],
    nextBot: 1,
    createdAt: now,
    updatedAt: now,
  };
  if (!normalised.ok) throw new Error(normalised.error);
  resetGame(room);
  return room;
}

/**
 * Resets everything that belongs to one game (scores, tallies, history and the hand state) for the current seat count.
 * @param {object} room  the room.
 * @returns {void}
 * Side effects: mutates room (scores, tally, history, hands, passes, trick state, moon bid and so on).
 */
function resetGame(room) {
  const n = room.seats.length;
  Object.assign(room, {
    scores: Array(n).fill(0),
    tally: Array.from({ length: n }, newTally),
    history: [],
    lastHand: null,
    winners: null,
    recorded: false,
    handNumber: 0,
    passDirection: directionName(n, offsetFor(n, 0)),
    passOffset: offsetFor(n, 0),
    hands: emptyHands(n),
    passes: emptySeats(n),
    received: emptyHands(n),
    taken: emptyHands(n),
    trick: [],
    trickLog: [],
    lastTrick: null,
    lastClaim: null,
    turn: null,
    tricksPlayed: 0,
    heartsBroken: false,
    moonBid: null,
  });
}

// ---- seats and settings ----

/**
 * The seat rules (join, leave, kick, computer players) are the shared ones. In Hearts a person who leaves mid-hand is
 * replaced by a computer player that gets its own AI, and if they were the only one the hand-end pop-up was waiting for,
 * the game moves on.
 * Side effects: the rules it returns (addHuman, addBot, ...) mutate room.seats; see shared/seats.js.
 */
const seats = createSeatRules({
  isMidGame: (room) => ['passing', 'playing', 'handEnd'].includes(room.phase),
  botNames: BOT_NAMES,
  takeOver: (room, bot, seat, rng) => ({ ...bot, ai: pickAI(AIS, rng).id }),
  afterRemoval: (room, rng) => advanceIfReady(room, rng),
  finishedSeat: goneSeat,
});
export const { addHuman, addBot, removeBot, fillWithBots, kick, removeHuman } = seats;

/**
 * Lets the host change settings (and the number of seats) while in the lobby.
 * @param {object} room  the room.
 * @param {number} userId  the account asking; must be the host.
 * @param {object} input  requested settings, optionally with `seats`.
 * @returns {{ok: boolean, error?: string}} ok, or why it was refused.
 * Side effects: on success mutates room.settings and may resize the seats (which resets the game).
 */
export function setSettings(room, userId, input) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  const next = normaliseSettings(input, room.settings);
  if (!next.ok) return next;
  if (input?.seats !== undefined) {
    if (!isSeatCount(input.seats)) return fail(seatsProblem);
    const seated = room.seats.filter(Boolean).length;
    if (input.seats < seated) return fail('Remove a player first: that would leave too few seats.');
    resizeSeats(room, input.seats);
  }
  room.settings = next.settings;
  return ok();
}

/** Grows or shrinks the table. Shrinking keeps everyone seated, closing up the gaps in turn order if it has to. */
/**
 * Grows or shrinks the table to `count` seats, closing gaps when shrinking would otherwise drop a player.
 * @param {object} room  the room.
 * @param {number} count  the new number of seats.
 * @returns {void}
 * Side effects: replaces room.seats and resets the game state.
 */
function resizeSeats(room, count) {
  if (count < room.seats.length && room.seats.slice(count).some(Boolean)) room.seats = room.seats.filter(Boolean);
  room.seats = [...room.seats.slice(0, count), ...emptySeats(Math.max(0, count - room.seats.length))];
  resetGame(room);
}

// ---- dealing and passing ----

/**
 * Shuffles and deals a hand, works out this hand's pass direction and starts either the passing or (on a no-pass hand) the play.
 * @param {object} room  the room.
 * @param {() => number} rng  random source for the shuffle.
 * @returns {void}
 * Side effects: mutates room (hands, pass state, trick state, phase, turn and moon bid).
 */
export function deal(room, rng) {
  const n = room.seats.length;
  const each = tricksFor(n);
  const deck = shuffle(deckFor(n), rng);
  room.hands = Array.from({ length: n }, (_, i) => sortHand(deck.slice(i * each, (i + 1) * each)));
  room.passOffset = offsetFor(n, room.handNumber);
  room.passDirection = directionName(n, room.passOffset);
  room.passes = emptySeats(n);
  room.received = emptyHands(n);
  room.taken = emptyHands(n);
  room.trick = [];
  room.trickLog = [];
  room.lastTrick = null;
  room.lastClaim = null;
  room.tricksPlayed = 0;
  room.heartsBroken = false;
  room.moonBid = null;
  room.turn = null;
  if (room.passOffset === 0) beginPlay(room);
  else room.phase = 'passing';
}

/**
 * Starts the play of a hand: the holder of the opening card leads, and any computer player with a moon-worthy hand declares.
 * @param {object} room  the room.
 * @returns {void}
 * Side effects: sets room.phase, room.turn and room.moonBid.
 */
function beginPlay(room) {
  room.phase = 'playing';
  room.turn = room.hands.findIndex((hand) => hand.includes(openingCard(room.seats.length)));
  setMoonBid(room);
}

/** The first computer player whose AI judges its hand strong enough to go for every point (if any). */
/**
 * Records which computer seat (if any) will try to shoot the moon, so that seat's AI plays for every point.
 * @param {object} room  the room.
 * @returns {void}
 * Side effects: sets room.moonBid to a seat index or null.
 */
function setMoonBid(room) {
  const bidder = room.seats.findIndex((s, i) => isBot(s) && aiOf(room, i).bidsMoon?.({ hand: room.hands[i], settings: room.settings, seatCount: room.seats.length }));
  room.moonBid = bidder === -1 ? null : bidder;
}

/**
 * Starts the game: checks the table is full, deals the first hand and gives each computer player an AI for the whole game.
 * @param {object} room  the room.
 * @param {number} userId  the account asking; must be the host in the lobby.
 * @param {() => number} rng  random source.
 * @returns {{ok: boolean, error?: string}} ok, or why it was refused.
 * Side effects: on success resets and deals the room and sets room.seats[i].ai for each bot.
 */
export function start(room, userId, rng) {
  const problem = hostInLobby(room, userId);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail(`All ${room.seats.length} seats need a player. Add computer players to fill the empty ones.`);
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  deal(room, rng);
  // Every computer player picks its AI for the whole game (after the deal, so the deal itself is unchanged).
  const bots = botSeats(room);
  const picks = assignAIs(AIS, bots, rng);
  for (const i of bots) room.seats[i].ai = picks[i];
  if (room.phase === 'playing') setMoonBid(room);
  return ok();
}

/**
 * Records a seat's chosen pass cards; when every seat has chosen, the exchange happens.
 * @param {object} room  the room.
 * @param {number} seat  the passing seat.
 * @param {string[]} cards  exactly passCount different cards from the seat's hand.
 * @returns {{ok: boolean, error?: string}} ok, or why it was refused.
 * Side effects: on success sets room.passes[seat] and may run the exchange and start the play.
 */
export function choosePass(room, seat, cards) {
  if (room.phase !== 'passing') return fail('It is not time to pass cards.');
  if (room.passes[seat]) return fail('You have already passed your cards.');
  const count = passCountFor(room.seats.length);
  if (!Array.isArray(cards) || cards.length !== count || new Set(cards).size !== count) return fail(`Choose exactly ${count} different cards to pass.`);
  if (!cards.every((card) => typeof card === 'string' && room.hands[seat].includes(card))) return fail('You can only pass cards from your hand.');
  room.passes[seat] = sortHand(cards);
  if (room.passes.every(Boolean)) exchange(room);
  return ok();
}

/**
 * Carries out the pass: every seat loses its passed cards and receives the ones sent to it, then play begins.
 * @param {object} room  the room; every seat must have chosen.
 * @returns {void}
 * Side effects: mutates room.hands, room.received and the tallies (opening card passed or received), then calls beginPlay.
 */
function exchange(room) {
  const n = room.seats.length;
  const hands = room.hands.map((hand, seat) => hand.filter((card) => !room.passes[seat].includes(card)));
  for (let seat = 0; seat < n; seat++) {
    const received = room.passes[passSource(seat, room.passDirection, n)];
    room.received[seat] = [...received];
    hands[seat] = sortHand([...hands[seat], ...received]);
  }
  tallyExchange(room.tally, room.passes, (seat) => passTarget(seat, room.passDirection, n), openingCard(n));
  room.hands = hands;
  beginPlay(room);
}

// ---- playing ----

/**
 * Why this card cannot be played now, or null when it can: it must be in the hand, the first trick opens with the opening
 * card and carries no points, suit must be followed, and hearts cannot lead until broken.
 *
 * @param {object} room  not changed
 * @param {number} seat
 * @param {string} card
 * @returns {string | null} the reason, or null when the card is legal
 * Side effects: none.
 */
export function illegalReason(room, seat, card) {
  const hand = room.hands[seat];
  if (!hand.includes(card)) return 'That card is not in your hand.';
  if (room.trick.length === 0) {
    if (room.tricksPlayed === 0) {
      const opening = openingCard(room.seats.length);
      return card === opening ? null : `You must lead the ${cardName(opening)}.`;
    }
    if (isHeart(card) && !room.heartsBroken && hand.some((c) => !isHeart(c))) return 'Hearts have not been broken yet.';
    return null;
  }
  const led = suitOf(room.trick[0].card);
  if (suitOf(card) === led) return null;
  if (followCards(hand, led).length) return `You must follow suit (${SUIT_NAMES[led]}).`;
  if (room.tricksPlayed === 0 && isPointCard(card) && hand.some((c) => !isPointCard(c))) return 'No points on the first trick.';
  return null;
}

/**
 * The cards a seat may legally play right now.
 * @param {object} room  not changed.
 * @param {number} seat  the seat.
 * @returns {string[]} the playable cards from its hand.
 * Side effects: none.
 */
export const legalCards = (room, seat) => room.hands[seat].filter((card) => illegalReason(room, seat, card) === null);

/**
 * Plays a card to the trick, if the seat may.
 * Side effects: takes the card from the hand, adds it to the trick, may break hearts and moves the turn on (to nobody once the trick is full).
 *
 * @param {object} room
 * @param {number} seat
 * @param {string} card
 * @returns {{ ok: boolean, error?: string, complete?: boolean }} `complete` says the trick is now full
 */
export function playCard(room, seat, card) {
  if (room.phase !== 'playing') return fail('The game is not being played.');
  if (room.turn !== seat) return fail('It is not your turn.');
  if (typeof card !== 'string') return fail('That is not a card.');
  const reason = illegalReason(room, seat, card);
  if (reason) return fail(reason);
  room.hands[seat] = room.hands[seat].filter((c) => c !== card);
  room.trick.push({ seat, card });
  if (isHeart(card) || card === QUEEN) room.heartsBroken = true; // the queen breaks hearts too
  const n = room.seats.length;
  room.turn = turnAfterPlay(seat, room.trick.length, n);
  return ok({ complete: room.trick.length === n });
}

/**
 * The seat that is winning a (possibly unfinished) trick: the highest card of the suit led (there is no trump).
 *
 * @param {{ seat: number, card: string }[]} trick  in the order played; not empty
 * @returns {number} the seat
 * Side effects: none.
 */
export function trickWinner(trick) {
  return trickWinnerSeat(trick);
}

/**
 * True when the seat has the lead and cannot lose another trick whatever the others hold: every card in its hand is higher
 * than every card of its suit that has not been played and is not in its hand. Leading them in any order then wins every
 * trick (a player with none of the suit cannot beat it, and follows only with lower cards).
 * @param {object} room  not changed.
 * @param {number} seat  the seat asking.
 * @returns {boolean} true when the seat may claim every remaining trick.
 * Side effects: none.
 */
export function canClaim(room, seat) {
  if (room.phase !== 'playing' || room.turn !== seat || room.trick.length !== 0) return false;
  const hand = room.hands[seat];
  if (hand.length < 2) return false; // on the last trick there is nothing to claim: just play the card
  const known = new Set([...hand, ...room.taken.flat()]);
  const unseen = deckFor(room.seats.length).filter((card) => !known.has(card));
  return hand.every((card) => unseen.every((other) => suitOf(other) !== suitOf(card) || rankValue(other) < rankValue(card)));
}

/**
 * The seat takes every remaining trick. The rest of the hand is played out for real (the others' cards go where they
 * would have gone, so the scoring is exact), recorded in the trick log like any other.
 * @param {object} room  the room.
 * @param {number} seat  the claiming seat; must be on lead with a claimable hand.
 * @returns {{ok: boolean, tricks?: number, error?: string}} the number of tricks claimed, or why it was refused.
 * Side effects: plays out every remaining card, resolves the tricks, scores the hand (may finish the game) and sets room.lastClaim.
 */
export function claimAll(room, seat) {
  if (room.phase !== 'playing') return fail('The game is not being played.');
  if (room.turn !== seat || room.trick.length !== 0) return fail('You can only claim when it is your turn to lead.');
  if (!canClaim(room, seat)) return fail('You could still lose a trick: a higher card is out there.');
  const n = room.seats.length;
  const tricks = tricksFor(n) - room.tricksPlayed;
  while (room.phase === 'playing') {
    for (let i = 0; i < n; i++) {
      const who = room.turn;
      const result = playCard(room, who, legalCards(room, who)[0]);
      if (!result.ok) throw new Error(`Claiming played an illegal card: ${result.error}`);
    }
    resolveTrick(room);
  }
  room.lastClaim = { seat, tricks, hand: room.handNumber + 1 };
  return ok({ tricks });
}

/**
 * Gives a finished trick to its winner, who leads next; after the last trick the hand is scored.
 * @param {object} room  the room with a full trick on the table.
 * @returns {{ok: boolean, winner?: number, handOver?: boolean, error?: string}} the winner and whether that was the last trick.
 * Side effects: moves the trick into the winner's taken cards and the trick log, updates tallies, cancels a moon bid if somebody else
 *   took points, advances the turn and, after the last trick, scores the hand (endHand).
 */
export function resolveTrick(room) {
  if (room.phase !== 'playing' || room.trick.length !== room.seats.length) return fail('There is no finished trick.');
  const winner = trickWinner(room.trick);
  const cards = room.trick.map((p) => p.card);
  room.taken[winner].push(...cards);
  tallyTrick(room.tally[winner]);
  room.lastTrick = { plays: room.trick, winner };
  if (cards.some(isPointCard) && winner !== room.moonBid) room.moonBid = null;
  room.trickLog ??= [];
  room.trickLog.push({ plays: room.trick, winner });
  room.trick = [];
  room.tricksPlayed++;
  if (room.tricksPlayed === tricksFor(room.seats.length)) {
    room.turn = null;
    endHand(room);
    return ok({ winner, handOver: true });
  }
  room.turn = winner;
  return ok({ winner, handOver: false });
}

// ---- scoring ----

/**
 * What each seat scores for a hand, given the cards each took in tricks. Hearts are 1, the Queen of Spades 13 and, if
 * the setting is on, the Jack of Diamonds -5. A player who takes every heart and the Queen of Spades shoots the moon:
 * everyone else scores 26, whatever the number of players (or, in the "self" mode, the shooter scores -26 and the others nothing). The Jack of
 * Diamonds still counts on a moon hand, when the setting is on: whoever took it also scores -5 (the Jack does not
 * have to be taken to shoot the moon).
 * @param {string[][]} taken  the cards each seat took in tricks.
 * @param {object} settings  game settings (jackOfDiamonds, moon).
 * @returns {{points: number[], moon: (number|null), details: {hearts: number, queen: boolean, jack: boolean}[]}} points per seat,
 *   the seat that shot the moon (or null) and what each seat took.
 * Side effects: none.
 */
export function scoreHand(taken, settings) {
  const details = taken.map((cards) => ({
    hearts: cards.filter(isHeart).length,
    queen: cards.includes(QUEEN),
    jack: cards.includes(JACK),
  }));
  const moonSeat = details.findIndex((d) => d.hearts === 13 && d.queen /* every heart is always in the deck */);
  const jackPoints = (d) => (settings.jackOfDiamonds && d.jack ? JACK_POINTS : 0);
  let points;
  if (moonSeat !== -1) {
    points = details.map((d, seat) => (settings.moon === 'self' ? (seat === moonSeat ? -MOON_POINTS : 0) : seat === moonSeat ? 0 : MOON_POINTS) + jackPoints(d));
  } else {
    points = details.map((d) => d.hearts + (d.queen ? 13 : 0) + jackPoints(d));
  }
  return { points, moon: moonSeat === -1 ? null : moonSeat, details };
}

/**
 * The seats with the lowest score (lowest wins in Hearts); several seats on a tie.
 * @param {number[]} scores  total score per seat.
 * @returns {number[]} the winning seats.
 * Side effects: none.
 */
export const winnersOf = (scores) => scores.flatMap((score, seat) => (score === Math.min(...scores) ? [seat] : []));

/**
 * Scores the finished hand: updates scores, tallies and history, then either ends the game (someone reached the target) or waits for the next hand.
 * @param {object} room  the room with every trick taken.
 * @returns {void}
 * Side effects: mutates room (scores, tally, lastHand, history, phase, winners, ready).
 */
function endHand(room) {
  const result = scoreHand(room.taken, room.settings);
  room.scores = room.scores.map((score, seat) => score + result.points[seat]);
  result.details.forEach((d, seat) => {
    tallyHand(room.tally[seat], d, { points: result.points[seat], shotMoon: result.moon === seat, moonShot: result.moon !== null, jackScores: room.settings.jackOfDiamonds });
  });
  room.lastHand = { hand: room.handNumber + 1, ...result, totals: [...room.scores] };
  room.history.push({
    label: `Hand ${room.handNumber + 1}`,
    deltas: Object.fromEntries(result.points.map((points, seat) => [seat, points])),
    notes: result.moon === null ? {} : { [result.moon]: 'shot the moon' },
    points: result.points,
    moon: result.moon,
  });
  if (room.scores.some((score) => score >= room.settings.target)) {
    room.phase = 'finished';
    room.winners = winnersOf(room.scores);
  } else {
    room.phase = 'handEnd';
    room.ready = [];
  }
}

/**
 * A person is ready for the next hand (they closed the score pop-up); it is dealt once every person is.
 * @param {object} room  the room.
 * @param {number} userId  the account that closed the pop-up.
 * @param {() => number} rng  random source for the deal.
 * @returns {{ok: boolean, error?: string}} ok, or why it was refused.
 * Side effects: adds the seat to room.ready and may deal the next hand.
 */
export function nextHand(room, userId, rng) {
  if (!hasPlayer(room, userId)) return fail('You are not in this game.');
  if (room.phase !== 'handEnd') return fail('The hand is not over.');
  room.ready ??= [];
  const seat = seatOf(room, userId);
  if (!room.ready.includes(seat)) room.ready.push(seat);
  advanceIfReady(room, rng);
  return ok();
}

/**
 * Deals the next hand if every human has closed the score pop-up.
 * @param {object} room  the room.
 * @param {() => number} rng  random source.
 * @returns {boolean} true if a new hand was dealt.
 * Side effects: may deal the next hand (mutates the room).
 */
function advanceIfReady(room, rng) {
  if (room.phase !== 'handEnd') return false;
  room.ready ??= [];
  if (!humanSeats(room).every((seat) => room.ready.includes(seat))) return false;
  dealNext(room, rng);
  return true;
}

/**
 * Moves on to the next hand number and deals it.
 * @param {object} room  the room.
 * @param {() => number} rng  random source.
 * @returns {void}
 * Side effects: increments room.handNumber, clears room.ready and deals.
 */
function dealNext(room, rng) {
  room.handNumber++;
  room.ready = [];
  deal(room, rng);
}

/**
 * Deals the next hand whether or not everyone has closed the pop-up (the server does this after a wait).
 * @param {object} room  the room.
 * @param {() => number} rng  random source for the deal.
 * @returns {{ok: boolean, error?: string}} ok, or why it was refused.
 * Side effects: deals the next hand (mutates the room).
 */
export function forceNextHand(room, rng) {
  if (room.phase !== 'handEnd') return fail('The hand is not over.');
  dealNext(room, rng);
  return ok();
}

/**
 * Returns a finished game to the lobby so the same table can play again.
 * @param {object} room  the room.
 * @param {number} userId  the account asking; must be the host.
 * @returns {{ok: boolean, error?: string}} ok, or why it was refused.
 * Side effects: on success resets the game and sets room.phase to 'lobby'.
 */
export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over.');
  freeGoneSeats(room);
  resetGame(room);
  room.phase = 'lobby';
  return ok();
}

/**
 * What the statistics should record for a finished game: one entry per human still seated.
 *
 * @param {object} room  a finished room (not changed)
 * @returns {{ userId: number, outcome: string, placement: number, score: number, extras: object }[]}
 * Side effects: none.
 */
export function statsPlayers(room) {
  const places = placements(Object.fromEntries(room.scores.map((score, seat) => [seat, score])), { lowIsBetter: true });
  return statsRows(room.seats, (seat, i) => ({
    outcome: room.winners.includes(i) ? 'win' : 'loss',
    placement: places[i],
    score: room.scores[i],
    extras: { ...room.tally[i], perfectGames: room.scores[i] <= 0 ? 1 : 0 },
  }));
}

// ---- computer players ----

// Re-exported so callers (and tests) can ask whether a hand is overwhelming enough to go for the moon.
export const wantsMoon = standardWantsMoon;

/**
 * The AI a computer seat plays with. Seats without one (rooms saved before AIs existed) get the first, standard AI.
 * @param {object} room  not changed.
 * @param {number} seat  the computer seat.
 * @returns {object} the AI object (see ai/index.js).
 * Side effects: none.
 */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat]?.ai);

/**
 * Cards to pass, as the standard AI chooses them (kept for callers that only have a hand).
 * @param {string[]} hand  the hand.
 * @param {object} [settings]  game settings (default DEFAULT_SETTINGS).
 * @param {number} [count]  how many cards to pass (default 3).
 * @returns {string[]} the cards to pass.
 * Side effects: none.
 */
export function botPass(hand, settings = DEFAULT_SETTINGS, count = 3) {
  return passStandard({ hand, settings, passCount: count });
}

/**
 * The plain data an AI decides from: its own hand and the public history of the hand, never other hands. Everything is
 * copied so an AI cannot change the room.
 * @param {object} room  not changed.
 * @param {number} seat  the computer seat.
 * @param {() => number} rng  random source handed to the AI.
 * @returns {object} the context described at the top of ai/index.js.
 * Side effects: none.
 */
export function aiContext(room, seat, rng) {
  return {
    seat,
    hand: [...room.hands[seat]],
    legal: room.phase === 'playing' ? legalCards(room, seat) : [],
    trick: room.trick.map((p) => ({ ...p })),
    history: (room.trickLog ?? []).map((t) => ({ plays: t.plays.map((p) => ({ ...p })), winner: t.winner })),
    taken: room.taken.map((cards) => [...cards]),
    scores: [...room.scores],
    settings: { ...room.settings },
    heartsBroken: room.heartsBroken,
    tricksPlayed: room.tricksPlayed,
    handNumber: room.handNumber,
    direction: room.passDirection,
    seatCount: room.seats.length,
    trickCount: tricksFor(room.seats.length),
    passCount: passCountFor(room.seats.length),
    passOffset: room.passOffset ?? offsetOfDirection(room.seats.length, room.passDirection),
    openingCard: openingCard(room.seats.length),
    passed: room.passes[seat] ? [...room.passes[seat]] : [],
    received: [...(room.received?.[seat] ?? [])],
    moonBid: room.moonBid,
    rng,
  };
}

/**
 * The cards a computer seat passes, chosen by its own AI (always the right number of different cards from its hand).
 * Falls back to the standard AI if the chosen AI returns something invalid.
 * @param {object} room  not changed.
 * @param {number} seat  the computer seat.
 * @param {() => number} rng  random source.
 * @returns {string[]} the cards to pass.
 * Side effects: may advance rng.
 */
export function botPassFor(room, seat, rng) {
  const hand = room.hands[seat];
  const count = passCountFor(room.seats.length);
  // True when the AI's answer is a proper pass: the right number of different cards, all from the hand.
  const valid = (cards) => Array.isArray(cards) && cards.length === count && new Set(cards).size === count && cards.every((c) => hand.includes(c));
  const ctx = aiContext(room, seat, rng);
  const cards = aiOf(room, seat).choosePass(ctx);
  return valid(cards) ? cards : passStandard(ctx);
}

/**
 * The card a computer player plays: always one of its legal cards, chosen by its own AI (the first legal card if it errs).
 * @param {object} room  not changed.
 * @param {number} seat  the computer seat.
 * @param {() => number} rng  random source.
 * @returns {string} a legal card.
 * Side effects: may advance rng.
 */
export function botPlay(room, seat, rng) {
  const legal = legalCards(room, seat);
  if (legal.length === 1) return legal[0];
  const card = aiOf(room, seat).choosePlay(aiContext(room, seat, rng));
  return legal.includes(card) ? card : legal[0];
}

/**
 * True while the hand is over and waiting for people to close the score pop-up (the server times this out).
 * @param {object} room  not changed.
 * @returns {boolean} true in the handEnd phase.
 * Side effects: none.
 */
export const waitingForReady = (room) => room.phase === 'handEnd';

/**
 * The next thing a computer (or the clock) has to do, or null when the game waits for a person.
 * @param {object} room  not changed.
 * @returns {{type: 'pass'|'play'|'resolve', seat?: number, key: string}|null} the pending action; `key` names it, and stays
 *   the same while unrelated things happen (another person passing, somebody connecting), so the server's timer for it is
 *   not restarted by them.
 * Side effects: none.
 */
export function pendingAction(room) {
  if (room.phase === 'passing') {
    const seat = room.seats.findIndex((s, i) => isBot(s) && !room.passes[i]);
    return seat === -1 ? null : { type: 'pass', seat, key: `pass:${seat}:${room.handNumber}` };
  }
  if (room.phase !== 'playing') return null;
  if (room.trick.length === room.seats.length) return { type: 'resolve', key: `resolve:${room.handNumber}:${room.tricksPlayed}` };
  return isBot(room.seats[room.turn]) ? { type: 'play', seat: room.turn, key: `play:${room.turn}:${room.handNumber}:${room.tricksPlayed}:${room.trick.length}` } : null;
}

/**
 * Performs a pending action. Returns the action, or null if there was nothing to do.
 * @param {object} room  the room.
 * @param {() => number} rng  random source for the computer players.
 * @returns {{type: string, seat?: number}|null} the action performed.
 * Side effects: mutates the room (a computer pass, play or the resolving of a full trick); throws if a computer makes an illegal move.
 */
export function runPending(room, rng) {
  const action = pendingAction(room);
  if (!action) return null;
  const result =
    action.type === 'pass'
      ? choosePass(room, action.seat, botPassFor(room, action.seat, rng))
      : action.type === 'play'
        ? playCard(room, action.seat, botPlay(room, action.seat, rng))
        : resolveTrick(room);
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}

// ---- what each player may see ----

/**
 * What the points taken so far this hand are worth to a seat.
 *
 * @param {object} room  not changed
 * @param {number} seat
 * @returns {number} hearts, plus 13 for the Queen of Spades, plus the Jack of Diamonds' bonus when that counts
 * Side effects: none.
 */
function handPoints(room, seat) {
  const { hearts, queen, jack } = scoreHand(room.taken, { ...room.settings, moon: 'others' }).details[seat];
  return hearts + (queen ? 13 : 0) + (room.settings.jackOfDiamonds && jack ? JACK_POINTS : 0);
}

/**
 * One occupied seat as the table shows it to everybody.
 *
 * @param {object} room  not changed
 * @param {number} i  the seat's index
 * @param {(id: number) => boolean} online  says who is connected
 * @returns {object}
 * Side effects: none.
 */
function seatView(room, i, online) {
  const seat = room.seats[i];
  return {
    seat: i,
    name: seat.name,
    bot: isBot(seat),
    ...(isBot(seat) && room.phase !== 'lobby' ? { ai: describeAIBrief(aiOf(room, i)) } : {}),
    online: isBot(seat) || (isHuman(seat) && online(seat.id)), // a person who left the finished game is away
    cards: room.hands[i].length,
    tricks: room.taken[i].length / room.seats.length,
    hearts: room.taken[i].filter(isHeart).length,
    queen: room.taken[i].includes(QUEEN),
    jack: room.taken[i].includes(JACK),
    points: handPoints(room, i),
    passed: Boolean(room.passes[i]),
    ready: room.phase === 'handEnd' ? isBot(seat) || Boolean(room.ready?.includes(i)) : false,
    score: room.scores[i],
  };
}

/**
 * Every seat as the table shows it (null for an empty one).
 *
 * @param {object} room  not changed
 * @param {(id: number) => boolean} online
 * @returns {(object | null)[]}
 * Side effects: none.
 */
const seatsView = (room, online) => room.seats.map((seat, i) => (seat ? seatView(room, i, online) : null));

/**
 * The standard scoreboard (shared/scores.js): the players, the hands scored so far, and that low scores win.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @param {(id: number) => boolean} online
 * @returns {object}
 * Side effects: none.
 */
function scoreboardView(room, me, online) {
  // One scoreboard row for a seat, plus whether it has closed the hand-end pop-up.
  const player = (seat, i) => ({
    ...seatScoreboardEntry(seat, i, { score: room.scores[i], me, current: room.phase === 'playing' && room.turn === i, online }),
    ...(room.phase === 'handEnd' ? { ready: isBot(seat) || Boolean(room.ready?.includes(i)) } : {}),
  });
  return {
    players: room.seats.flatMap((seat, i) => (seat ? [player(seat, i)] : [])),
    rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
    lowIsBetter: true,
    target: room.settings.target,
  };
}

/**
 * The viewer's hand and the trick in progress: only what a seat at the table may see once the hand is dealt.
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {object} fields to add to the view when the game has started
 * Side effects: none.
 */
function playView(room, me) {
  const myTurn = room.phase === 'playing' && room.turn === me && room.trick.length < room.seats.length;
  const hand = room.hands[me] ?? [];
  return {
    hand,
    received: (room.received[me] ?? []).filter((c) => hand.includes(c)),
    trick: room.trick,
    trickWinner: room.trick.length === room.seats.length ? trickWinner(room.trick) : null,
    lastTrick: room.lastTrick,
    turn: room.turn,
    canClaim: canClaim(room, me),
    lastClaim: room.lastClaim ?? null,
    heartsBroken: room.heartsBroken,
    trickNumber: Math.min(room.tricksPlayed + 1, tricksFor(room.seats.length)),
    legal: myTurn ? Object.fromEntries(room.hands[me].map((card) => [card, illegalReason(room, me, card)])) : null,
  };
}

/**
 * The passing step as the viewer sees it: who they pass to and receive from (only while choosing), what they chose, and who
 * passes to whom this hand (public once dealt, for drawing the arrows).
 *
 * @param {object} room  not changed
 * @param {number} me  the viewer's seat, or -1
 * @returns {object}
 * Side effects: none.
 */
function passView(room, me) {
  const n = room.seats.length;
  const offset = room.passOffset ?? offsetOfDirection(n, room.passDirection);
  // The display name of a seat, or null when it is empty or out of range.
  const name = (seat) => (seat === null || seat === undefined || !room.seats[seat] ? null : room.seats[seat].name);
  const base = { ...describePass(n, offset), cards: passCountFor(n) };
  let pass;
  if (room.phase === 'passing' && me !== -1 && offset !== 0) {
    const to = passTarget(me, room.passDirection, n);
    const from = passSource(me, room.passDirection, n);
    pass = { ...base, to, from, toName: name(to), fromName: name(from), chosen: room.passes[me], incomingReady: Boolean(room.passes[from]) };
  } else {
    pass = { ...base, to: null, from: null, toName: null, fromName: null, chosen: null, incomingReady: false };
  }
  pass.targets = room.phase === 'lobby' || offset === 0 ? [] : room.seats.map((_, seat) => passTarget(seat, room.passDirection, n));
  return pass;
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
    seats: seatsView(room, online),
    scoreboard: scoreboardView(room, me, online),
    handNumber: room.handNumber + 1,
    lastHand: room.lastHand,
    winners: room.winners,
    seatCount: room.seats.length,
    deal: dealView(room.seats.length),
    limits: { targets: TARGETS, moonModes: MOON_MODES, minSeats: MIN_SEATS, maxSeats: MAX_SEATS },
  };
  if (room.phase !== 'lobby') Object.assign(view, playView(room, me));
  view.pass = passView(room, me);
  return view;
}

/**
 * What the table needs to describe the deal for this many players: removed cards are public.
 * @param {number} seats  number of players.
 * @returns {object} cards each, tricks, pass count, removed cards, opening card, hand points and the pass rotation.
 * Side effects: none.
 */
function dealView(seats) {
  const deal = dealFor(seats);
  return { cardsEach: deal.each, tricks: deal.each, passCount: deal.pass, removed: [...deal.removed], openingCard: openingCard(seats), handPoints: HAND_POINTS, rotation: deal.rotation.map((offset) => describePass(seats, offset)) };
}

// Just the id and name of an AI, which is all the table needs to show about a computer player.
const describeAIBrief = (ai) => {
  const { id, name } = describeAI(ai);
  return { id, name };
};
