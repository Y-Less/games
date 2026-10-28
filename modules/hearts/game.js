// The rules of Hearts, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// Three to seven players (the host's choice, 4 by default; see deals.js for the deal and the passing of each size).
// Seats 0..n-1 run clockwise: the player to your left is seat + 1, so passing "left" sends cards to seat + 1 and play
// goes round in increasing seat order. The number of seats is room.seats.length. A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer
// player ({ kind: 'bot', id: 'bot:<n>', name }) or null (empty, lobby only).
import { placements } from '../../shared/scores.js';
import { cardName, rankValue, shuffle, sortHand, suitOf, SUIT_NAMES } from '../../shared/cards.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { AIS } from './ai/index.js';
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
export const STAT_KEYS = ['handsPlayed', 'moonsShot', 'queensTaken', 'heartsTaken'];
export const BOT_NAMES = ['Hazel', 'Otis', 'Mabel', 'Felix', 'Ivy', 'Rufus', 'Nell', 'Boris', 'Pearl', 'Hugo'];

const LIVE = ['lobby', 'passing', 'playing', 'handEnd'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export const isHeart = (card) => suitOf(card) === 'H';
export const isPointCard = (card) => isHeart(card) || card === QUEEN;
export const isLive = (room) => LIVE.includes(room.phase);
export const isHuman = (seat) => seat?.kind === 'human';
export const isBot = (seat) => seat?.kind === 'bot';
export const seatOf = (room, userId) => room.seats.findIndex((s) => isHuman(s) && s.id === userId);
export const hasPlayer = (room, userId) => seatOf(room, userId) !== -1;
export const humanSeats = (room) => room.seats.flatMap((s, i) => (isHuman(s) ? [i] : []));
export const seatCountOf = (room) => room.seats.length;
export const passTarget = (seat, direction, seats = DEFAULT_SEATS) => (seat + offsetOfDirection(seats, direction)) % seats;
export const passSource = (seat, direction, seats = DEFAULT_SEATS) => (seat + seats - offsetOfDirection(seats, direction)) % seats;
const emptySeats = (n) => Array.from({ length: n }, () => null);

const freshTally = () => Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
const emptyHands = (n) => Array.from({ length: n }, () => []);

const seatsProblem = `A game has ${MIN_SEATS} to ${MAX_SEATS} players.`;

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

export function createRoom({ code, hostId, hostName, settings = {}, now = Date.now() }) {
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

function resetGame(room) {
  const n = room.seats.length;
  Object.assign(room, {
    scores: Array(n).fill(0),
    tally: Array.from({ length: n }, freshTally),
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

const firstEmpty = (room) => room.seats.findIndex((s) => s === null);

export function addHuman(room, userId, name) {
  if (hasPlayer(room, userId)) return ok({ seat: seatOf(room, userId) });
  if (room.phase !== 'lobby') return fail('That game has already started.');
  const seat = firstEmpty(room);
  if (seat === -1) return fail('That game is full.');
  room.seats[seat] = { kind: 'human', id: userId, name };
  return ok({ seat });
}

function newBot(room) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name));
  const base = BOT_NAMES.find((n) => !used.has(n)) ?? 'Computer';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
  return { kind: 'bot', id: `bot:${room.nextBot++}`, name };
}

/**
 * Removes a human. Before the game starts (or after it ends) the seat is freed; mid-game a computer player takes
 * it over. `empty` is true when no human is left, so the room should be discarded.
 */
export function removeHuman(room, userId, rng = Math.random) {
  const seat = seatOf(room, userId);
  if (seat === -1) return fail('You are not in this game.');
  const midGame = ['passing', 'playing', 'handEnd'].includes(room.phase);
  room.seats[seat] = midGame ? { ...newBot(room), ai: pickAI(AIS, rng).id } : null;
  const humans = humanSeats(room);
  if (!humans.length) return ok({ empty: true, seat });
  if (room.hostId === userId) room.hostId = room.seats[humans[0]].id;
  advanceIfReady(room); // the person who left may have been the only one still to close the pop-up
  return ok({ empty: false, seat, replaced: midGame });
}

const asHost = (room, userId) => (room.hostId === userId ? null : fail('Only the host can do that.'));
const inLobby = (room) => (room.phase === 'lobby' ? null : fail('You can only change that before the game starts.'));

export function setSettings(room, userId, input) {
  const problem = asHost(room, userId) ?? inLobby(room);
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
function resizeSeats(room, count) {
  if (count < room.seats.length && room.seats.slice(count).some(Boolean)) room.seats = room.seats.filter(Boolean);
  room.seats = [...room.seats.slice(0, count), ...emptySeats(Math.max(0, count - room.seats.length))];
  resetGame(room);
}

export function addBot(room, userId, seat) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  const index = seat === undefined ? firstEmpty(room) : seat;
  if (index === -1) return fail('Every seat is taken.');
  if (!Number.isInteger(index) || index < 0 || index >= room.seats.length) return fail('There is no such seat.');
  if (room.seats[index]) return fail('That seat is taken.');
  room.seats[index] = newBot(room);
  return ok({ seat: index });
}

/**
 * The host removes another person, at any time before the game is over: in the lobby their seat is freed, and in a
 * game a computer player takes it over (as when someone leaves). The result names the person so the server can send
 * them home.
 */
export function kick(room, hostId, seat, rng = Math.random) {
  const problem = asHost(room, hostId);
  if (problem) return problem;
  const target = Number.isInteger(seat) ? room.seats[seat] : null;
  if (!isHuman(target) || target.id === hostId) return fail('There is no one else in that seat.');
  if (room.phase === 'finished') return fail('The game is over: there is nobody to remove.');
  const removed = removeHuman(room, target.id, rng);
  return removed.ok ? ok({ userId: target.id, replaced: Boolean(removed.replaced) }) : removed;
}

export function removeBot(room, userId, seat) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  if (!Number.isInteger(seat) || !isBot(room.seats[seat])) return fail('There is no computer player in that seat.');
  room.seats[seat] = null;
  return ok();
}

export function fillWithBots(room, userId) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  for (let i = 0; i < room.seats.length; i++) if (!room.seats[i]) room.seats[i] = newBot(room);
  return ok();
}

// ---- dealing and passing ----

export function deal(room, rng = Math.random) {
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

function beginPlay(room) {
  room.phase = 'playing';
  room.turn = room.hands.findIndex((hand) => hand.includes(openingCard(room.seats.length)));
  setMoonBid(room);
}

/** The first computer player whose AI judges its hand strong enough to go for every point (if any). */
function setMoonBid(room) {
  const bidder = room.seats.findIndex((s, i) => isBot(s) && aiOf(room, i).bidsMoon?.({ hand: room.hands[i], settings: room.settings, seatCount: room.seats.length }));
  room.moonBid = bidder === -1 ? null : bidder;
}

export function start(room, userId, rng = Math.random) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail(`All ${room.seats.length} seats need a player. Add computer players to fill the empty ones.`);
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  deal(room, rng);
  // Every computer player picks its AI for the whole game (after the deal, so the deal itself is unchanged).
  const botSeats = room.seats.flatMap((s, i) => (isBot(s) ? [i] : []));
  const picks = assignAIs(AIS, botSeats, rng);
  for (const i of botSeats) room.seats[i].ai = picks[i];
  if (room.phase === 'playing') setMoonBid(room);
  return ok();
}

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

function exchange(room) {
  const n = room.seats.length;
  const hands = room.hands.map((hand, seat) => hand.filter((card) => !room.passes[seat].includes(card)));
  for (let seat = 0; seat < n; seat++) {
    const received = room.passes[passSource(seat, room.passDirection, n)];
    room.received[seat] = [...received];
    hands[seat] = sortHand([...hands[seat], ...received]);
  }
  room.hands = hands;
  beginPlay(room);
}

// ---- playing ----

/** Why this card cannot be played now, or null when it can. */
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
  if (hand.some((c) => suitOf(c) === led)) return `You must follow suit (${SUIT_NAMES[led]}).`;
  if (room.tricksPlayed === 0 && isPointCard(card) && hand.some((c) => !isPointCard(c))) return 'No points on the first trick.';
  return null;
}

export const legalCards = (room, seat) => room.hands[seat].filter((card) => illegalReason(room, seat, card) === null);

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
  room.turn = room.trick.length === n ? null : (seat + 1) % n;
  return ok({ complete: room.trick.length === n });
}

/** The seat that is winning a (possibly unfinished) trick: the highest card of the suit led. */
export function trickWinner(trick) {
  const led = suitOf(trick[0].card);
  return trick.reduce((best, play) => (suitOf(play.card) === led && rankValue(play.card) > rankValue(best.card) ? play : best), trick[0]).seat;
}

/**
 * True when the seat has the lead and cannot lose another trick whatever the others hold: every card in its hand is higher
 * than every card of its suit that has not been played and is not in its hand. Leading them in any order then wins every
 * trick (a player with none of the suit cannot beat it, and follows only with lower cards).
 */
export function canClaim(room, seat) {
  if (room.phase !== 'playing' || room.turn !== seat || room.trick.length !== 0) return false;
  const hand = room.hands[seat];
  if (!hand.length) return false;
  const known = new Set([...hand, ...room.taken.flat()]);
  const unseen = deckFor(room.seats.length).filter((card) => !known.has(card));
  return hand.every((card) => unseen.every((other) => suitOf(other) !== suitOf(card) || rankValue(other) < rankValue(card)));
}

/**
 * The seat takes every remaining trick. The rest of the hand is played out for real (the others' cards go where they
 * would have gone, so the scoring is exact), recorded in the trick log like any other.
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

/** Gives a finished trick to its winner, who leads next; after the last trick the hand is scored. */
export function resolveTrick(room) {
  if (room.phase !== 'playing' || room.trick.length !== room.seats.length) return fail('There is no finished trick.');
  const winner = trickWinner(room.trick);
  const cards = room.trick.map((p) => p.card);
  room.taken[winner].push(...cards);
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

export const winnersOf = (scores) => scores.flatMap((score, seat) => (score === Math.min(...scores) ? [seat] : []));

function endHand(room) {
  const result = scoreHand(room.taken, room.settings);
  room.scores = room.scores.map((score, seat) => score + result.points[seat]);
  result.details.forEach((d, seat) => {
    const tally = room.tally[seat];
    tally.handsPlayed++;
    tally.heartsTaken += d.hearts;
    if (d.queen) tally.queensTaken++;
    if (result.moon === seat) tally.moonsShot++;
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

/** A person is ready for the next hand (they closed the score pop-up); it is dealt once every person is. */
export function nextHand(room, userId, rng = Math.random) {
  if (!hasPlayer(room, userId)) return fail('You are not in this game.');
  if (room.phase !== 'handEnd') return fail('The hand is not over.');
  room.ready ??= [];
  const seat = seatOf(room, userId);
  if (!room.ready.includes(seat)) room.ready.push(seat);
  advanceIfReady(room, rng);
  return ok();
}

function advanceIfReady(room, rng = Math.random) {
  if (room.phase !== 'handEnd') return false;
  room.ready ??= [];
  if (!humanSeats(room).every((seat) => room.ready.includes(seat))) return false;
  dealNext(room, rng);
  return true;
}

function dealNext(room, rng) {
  room.handNumber++;
  room.ready = [];
  deal(room, rng);
}

/** Deals the next hand whether or not everyone has closed the pop-up (the server does this after a wait). */
export function forceNextHand(room, rng = Math.random) {
  if (room.phase !== 'handEnd') return fail('The hand is not over.');
  dealNext(room, rng);
  return ok();
}

export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over.');
  resetGame(room);
  room.phase = 'lobby';
  return ok();
}

/** What the statistics should record for a finished game: one entry per human still seated. */
export function statsPlayers(room) {
  const places = placements(Object.fromEntries(room.scores.map((score, seat) => [seat, score])), { lowIsBetter: true });
  return room.seats.flatMap((seat, i) =>
    isHuman(seat)
      ? [
          {
            userId: seat.id,
            outcome: room.winners.includes(i) ? 'win' : 'loss',
            placement: places[i],
            score: room.scores[i],
            extras: { ...room.tally[i] },
          },
        ]
      : [],
  );
}

// ---- computer players ----

export const wantsMoon = standardWantsMoon;

/** The AI a computer seat plays with. Seats without one (rooms saved before AIs existed) get the first, standard AI. */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat]?.ai);

/** Cards to pass, as the standard AI chooses them (kept for callers that only have a hand). */
export function botPass(hand, settings = DEFAULT_SETTINGS, count = 3) {
  return passStandard({ hand, settings, passCount: count });
}

/** The plain data an AI decides from: its own hand and the public history of the hand, never other hands. */
export function aiContext(room, seat, rng = Math.random) {
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

/** The cards a computer seat passes, chosen by its own AI (always the right number of different cards from its hand). */
export function botPassFor(room, seat, rng = Math.random) {
  const hand = room.hands[seat];
  const count = passCountFor(room.seats.length);
  const valid = (cards) => Array.isArray(cards) && cards.length === count && new Set(cards).size === count && cards.every((c) => hand.includes(c));
  const ctx = aiContext(room, seat, rng);
  const cards = aiOf(room, seat).choosePass(ctx);
  return valid(cards) ? cards : passStandard(ctx);
}

/** The card a computer player plays: always one of its legal cards, chosen by its own AI. */
export function botPlay(room, seat, rng = Math.random) {
  const legal = legalCards(room, seat);
  if (legal.length === 1) return legal[0];
  const card = aiOf(room, seat).choosePlay(aiContext(room, seat, rng));
  return legal.includes(card) ? card : legal[0];
}

/** The next thing a computer (or the clock) has to do, or null when the game waits for a person. */
/** True while the hand is over and waiting for people to close the score pop-up (the server times this out). */
export const waitingForReady = (room) => room.phase === 'handEnd';

export function pendingAction(room) {
  if (room.phase === 'passing') {
    const seat = room.seats.findIndex((s, i) => isBot(s) && !room.passes[i]);
    return seat === -1 ? null : { type: 'pass', seat };
  }
  if (room.phase !== 'playing') return null;
  if (room.trick.length === room.seats.length) return { type: 'resolve' };
  return isBot(room.seats[room.turn]) ? { type: 'play', seat: room.turn } : null;
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
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

function handPoints(room, seat) {
  const { hearts, queen, jack } = scoreHand(room.taken, { ...room.settings, moon: 'others' }).details[seat];
  return hearts + (queen ? 13 : 0) + (room.settings.jackOfDiamonds && jack ? JACK_POINTS : 0);
}

/** Everything one account may know: its own hand and the public table, never anybody else's cards. */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const playing = room.phase === 'playing';
  const myTurn = playing && room.turn === me && room.trick.length < room.seats.length;
  const view = {
    code: room.code,
    phase: room.phase,
    you: me,
    hostSeat: seatOf(room, room.hostId),
    settings: room.settings,
    seats: room.seats.map((seat, i) =>
      seat
        ? {
            seat: i,
            name: seat.name,
            bot: isBot(seat),
            ...(isBot(seat) && room.phase !== 'lobby' ? { ai: describeAIBrief(aiOf(room, i)) } : {}),
            online: isBot(seat) || online(seat.id),
            cards: room.hands[i].length,
            tricks: room.taken[i].length / room.seats.length,
            hearts: room.taken[i].filter(isHeart).length,
            queen: room.taken[i].includes(QUEEN),
            jack: room.taken[i].includes(JACK),
            points: handPoints(room, i),
            passed: Boolean(room.passes[i]),
            ready: room.phase === 'handEnd' ? isBot(seat) || Boolean(room.ready?.includes(i)) : false,
            score: room.scores[i],
          }
        : null,
    ),
    scoreboard: {
      players: room.seats.flatMap((seat, i) => (seat ? [{ id: i, name: seat.name, score: room.scores[i], isMe: i === me, bot: isBot(seat), current: room.phase === 'playing' && room.turn === i, away: isHuman(seat) && !online(seat.id), ...(room.phase === 'handEnd' ? { ready: isBot(seat) || Boolean(room.ready?.includes(i)) } : {}) }] : [])),
      rounds: room.history.map(({ label, deltas, notes }) => ({ label, deltas, notes })),
      lowIsBetter: true,
      target: room.settings.target,
    },
    handNumber: room.handNumber + 1,
    lastHand: room.lastHand,
    winners: room.winners,
    seatCount: room.seats.length,
    deal: dealView(room.seats.length),
    limits: { targets: TARGETS, moonModes: MOON_MODES, minSeats: MIN_SEATS, maxSeats: MAX_SEATS },
  };
  if (room.phase !== 'lobby') {
    view.hand = room.hands[me] ?? [];
    view.received = (room.received[me] ?? []).filter((c) => view.hand.includes(c));
    view.trick = room.trick;
    view.trickWinner = room.trick.length === room.seats.length ? trickWinner(room.trick) : null;
    view.lastTrick = room.lastTrick;
    view.turn = room.turn;
    view.canClaim = canClaim(room, me);
    view.lastClaim = room.lastClaim ?? null;
    view.heartsBroken = room.heartsBroken;
    view.trickNumber = Math.min(room.tricksPlayed + 1, tricksFor(room.seats.length));
    view.legal = myTurn ? Object.fromEntries(room.hands[me].map((card) => [card, illegalReason(room, me, card)])) : null;
  }
  const n = room.seats.length;
  const offset = room.passOffset ?? offsetOfDirection(n, room.passDirection);
  const name = (seat) => (seat === null || seat === undefined || !room.seats[seat] ? null : room.seats[seat].name);
  const base = { ...describePass(n, offset), cards: passCountFor(n) };
  if (room.phase === 'passing' && me !== -1 && offset !== 0) {
    const to = passTarget(me, room.passDirection, n);
    const from = passSource(me, room.passDirection, n);
    view.pass = { ...base, to, from, toName: name(to), fromName: name(from), chosen: room.passes[me], incomingReady: Boolean(room.passes[from]) };
  } else {
    view.pass = { ...base, to: null, from: null, toName: null, fromName: null, chosen: null, incomingReady: false };
  }
  // Who passes to whom this hand (public once the hand is dealt), for drawing the arrows.
  view.pass.targets = room.phase === 'lobby' || offset === 0 ? [] : room.seats.map((_, seat) => passTarget(seat, room.passDirection, n));
  return view;
}

/** What the table needs to describe the deal for this many players: removed cards are public. */
function dealView(seats) {
  const deal = dealFor(seats);
  return { cardsEach: deal.each, tricks: deal.each, passCount: deal.pass, removed: [...deal.removed], openingCard: openingCard(seats), handPoints: HAND_POINTS, rotation: deal.rotation.map((offset) => describePass(seats, offset)) };
}

const describeAIBrief = (ai) => {
  const { id, name } = describeAI(ai);
  return { id, name };
};
