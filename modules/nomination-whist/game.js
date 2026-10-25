// The rules of Nomination Whist, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// Seats run clockwise: the player to your left is seat + 1, so play and nominations go round in increasing seat order.
// A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer player ({ kind: 'bot', id: 'bot:<n>',
// name }), a person who left after the game ended ({ kind: 'gone', name }) or null (empty, lobby only).
import { fullDeck, rankValue, shuffle, sortHand, suitOf, SUIT_NAMES } from '../../shared/cards.js';
import { placements } from '../../shared/scores.js';
import { chooseCard, chooseNomination } from './bot.js';

export const MIN_SEATS = 3;
export const MAX_SEATS = 7;
export const LENGTHS = ['full', 'short'];
export const DEFAULT_SETTINGS = { seats: 4, length: 'full', missPoints: true };
export const FULL_SCHEDULE = [7, 6, 5, 4, 3, 2, 1, 1, 2, 3, 4, 5, 6, 7];
export const SHORT_SCHEDULE = [7, 6, 5, 4, 3, 2, 1];
export const TRUMP_ORDER = ['H', 'C', 'D', 'S', null];
export const HIT_BONUS = 10;
export const STAT_KEYS = ['roundsPlayed', 'bidsMade', 'tricksWon'];
export const BOT_NAMES = ['Hazel', 'Otis', 'Mabel', 'Felix', 'Ivy', 'Rufus', 'Nell', 'Boris', 'Pearl', 'Hugo'];

const LIVE = ['lobby', 'nominating', 'playing', 'roundEnd'];
const MID_GAME = ['nominating', 'playing', 'roundEnd'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export const isLive = (room) => LIVE.includes(room.phase);
export const isHuman = (seat) => seat?.kind === 'human';
export const isBot = (seat) => seat?.kind === 'bot';
export const seatOf = (room, userId) => room.seats.findIndex((s) => isHuman(s) && s.id === userId);
export const hasPlayer = (room, userId) => seatOf(room, userId) !== -1;
export const humanSeats = (room) => room.seats.flatMap((s, i) => (isHuman(s) ? [i] : []));

// ---- the shape of a game ----

export const scheduleFor = (settings) => (settings.length === 'short' ? SHORT_SCHEDULE : FULL_SCHEDULE);
export const roundCount = (settings) => scheduleFor(settings).length;
/** Cards dealt in a round (0-based). */
export const handSize = (settings, round) => scheduleFor(settings)[round];
/** The trump suit of a round (0-based): H, C, D, S, or null for no trumps; the order repeats. */
export const trumpOf = (round) => TRUMP_ORDER[round % TRUMP_ORDER.length];
export const trumpName = (trump) => (trump ? SUIT_NAMES[trump] : 'no trumps');
export const roundLabel = (settings, round) => {
  const cards = handSize(settings, round);
  return `Round ${round + 1}: ${cards} ${cards === 1 ? 'card' : 'cards'}, ${trumpName(trumpOf(round))}`;
};
/** The dealer of a round (0-based), given the first round's dealer: the deal passes clockwise each round. */
export const dealerFor = (firstDealer, round, seats) => (firstDealer + round) % seats;

/** The one number the dealer may not nominate: the one that makes the nominations total the tricks available. */
export const forbiddenNomination = (cards, othersTotal) => (cards - othersTotal >= 0 ? cards - othersTotal : null);

/** What a player scores in a round. Exactly right: 10 plus the nomination. A miss: the tricks taken, or nothing. */
export function scoreRound(bid, taken, settings) {
  if (bid === taken) return HIT_BONUS + bid;
  return settings.missPoints ? taken : 0;
}

export const winnersOf = (scores) => scores.flatMap((score, seat) => (score === Math.max(...scores) ? [seat] : []));

const freshTally = () => Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));

export function normaliseSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  if (input?.seats !== undefined) {
    if (!Number.isInteger(input.seats) || input.seats < MIN_SEATS || input.seats > MAX_SEATS) return fail(`A game needs ${MIN_SEATS} to ${MAX_SEATS} seats.`);
    next.seats = input.seats;
  }
  if (input?.length !== undefined) {
    if (!LENGTHS.includes(input.length)) return fail('The game is either the full 14 rounds or 7 down to 1.');
    next.length = input.length;
  }
  if (input?.missPoints !== undefined) {
    if (typeof input.missPoints !== 'boolean') return fail('That scoring option must be on or off.');
    next.missPoints = input.missPoints;
  }
  return ok({ settings: next });
}

export function createRoom({ code, hostId, hostName, settings = {}, now = Date.now() }) {
  const normalised = normaliseSettings(settings);
  if (!normalised.ok) throw new Error(normalised.error);
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

function resetGame(room) {
  const n = room.seats.length;
  Object.assign(room, {
    roundIndex: 0,
    dealer: 0,
    scores: Array(n).fill(0),
    tally: Array.from({ length: n }, freshTally),
    history: [],
    winners: null,
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

const firstEmpty = (room) => room.seats.findIndex((s) => s === null);
const asHost = (room, userId) => (room.hostId === userId ? null : fail('Only the host can do that.'));
const inLobby = (room) => (room.phase === 'lobby' ? null : fail('You can only change that before the game starts.'));

function uniqueName(room, wanted) {
  const used = new Set(room.seats.filter(Boolean).map((s) => s.name.toLowerCase()));
  let name = wanted;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${wanted} (${n})`;
  return name;
}

export function addHuman(room, userId, name) {
  if (hasPlayer(room, userId)) return ok({ seat: seatOf(room, userId) });
  if (room.phase !== 'lobby') return fail('That game has already started.');
  const seat = firstEmpty(room);
  if (seat === -1) return fail('That game is full.');
  room.seats[seat] = { kind: 'human', id: userId, name: uniqueName(room, name) };
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
 * Removes a human. Before the game starts the seat is freed; mid-game a computer player takes it over; after the end
 * the seat is kept (so the final scores still make sense). `empty` is true when no human is left: discard the room.
 */
export function removeHuman(room, userId) {
  const seat = seatOf(room, userId);
  if (seat === -1) return fail('You are not in this game.');
  const name = room.seats[seat].name;
  if (MID_GAME.includes(room.phase)) room.seats[seat] = newBot(room);
  else room.seats[seat] = room.phase === 'finished' ? { kind: 'gone', name } : null;
  const humans = humanSeats(room);
  if (!humans.length) return ok({ empty: true, seat });
  if (room.hostId === userId) room.hostId = room.seats[humans[0]].id;
  return ok({ empty: false, seat, replaced: MID_GAME.includes(room.phase) });
}

/** Changes the number of seats: the people and computer players keep their order, and surplus computer players go. */
function resizeSeats(room, count) {
  const occupants = room.seats.filter(Boolean);
  while (occupants.length > count) {
    const index = occupants.findLastIndex(isBot);
    if (index === -1) return fail('Too many people are in the game for that many seats.');
    occupants.splice(index, 1);
  }
  room.seats = [...occupants, ...Array(count - occupants.length).fill(null)];
  return ok();
}

export function setSettings(room, userId, input) {
  const problem = asHost(room, userId) ?? inLobby(room);
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

/** The host removes another person from a lobby seat. */
export function kick(room, hostId, seat) {
  const problem = asHost(room, hostId) ?? inLobby(room);
  if (problem) return problem;
  const target = Number.isInteger(seat) ? room.seats[seat] : null;
  if (!isHuman(target) || target.id === hostId) return fail('There is no one else in that seat.');
  room.seats[seat] = null;
  return ok({ userId: target.id });
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

// ---- rounds ----

export function start(room, userId, rng = Math.random) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail('Every seat needs a player. Add computer players to fill the empty ones.');
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  room.dealer = Math.floor(rng() * room.seats.length);
  dealRound(room, rng);
  return ok();
}

export function dealRound(room, rng = Math.random) {
  const n = room.seats.length;
  const cards = handSize(room.settings, room.roundIndex);
  const deck = shuffle(fullDeck(), rng);
  room.hands = Array.from({ length: n }, (_, i) => sortHand(deck.slice(i * cards, (i + 1) * cards)));
  room.nominations = Array(n).fill(null);
  room.taken = Array(n).fill(0);
  room.trick = [];
  room.lastTrick = null;
  room.played = [];
  room.tricksPlayed = 0;
  room.phase = 'nominating';
  room.turn = (room.dealer + 1) % n;
}

export const cardsThisRound = (room) => handSize(room.settings, room.roundIndex);
export const trumpThisRound = (room) => trumpOf(room.roundIndex);

/** The number the dealer may not nominate right now, or null (it is not the dealer's turn). */
export function forbiddenNow(room) {
  if (room.phase !== 'nominating' || room.turn !== room.dealer) return null;
  const others = room.nominations.reduce((sum, bid, seat) => sum + (seat === room.dealer ? 0 : (bid ?? 0)), 0);
  return forbiddenNomination(cardsThisRound(room), others);
}

/** The numbers a seat may nominate on its turn. */
export function allowedNominations(room, seat) {
  const forbidden = seat === room.dealer ? forbiddenNow(room) : null;
  return Array.from({ length: cardsThisRound(room) + 1 }, (_, n) => n).filter((n) => n !== forbidden);
}

export function nominate(room, seat, number) {
  if (room.phase !== 'nominating') return fail('It is not time to nominate.');
  if (room.turn !== seat) return fail('It is not your turn to nominate.');
  const cards = cardsThisRound(room);
  if (!Number.isInteger(number) || number < 0 || number > cards) return fail(`Nominate a whole number from 0 to ${cards}.`);
  if (seat === room.dealer && number === forbiddenNow(room)) {
    return fail(`As the dealer you cannot nominate ${number}: the total would be ${cards}, the number of tricks, so somebody has to miss.`);
  }
  room.nominations[seat] = number;
  if (seat === room.dealer) {
    room.phase = 'playing';
    room.turn = (room.dealer + 1) % room.seats.length;
  } else {
    room.turn = (seat + 1) % room.seats.length;
  }
  return ok();
}

// ---- playing ----

/** Why this card cannot be played now, or null when it can. */
export function illegalReason(room, seat, card) {
  const hand = room.hands[seat];
  if (!hand.includes(card)) return 'That card is not in your hand.';
  if (room.trick.length === 0) return null;
  const led = suitOf(room.trick[0].card);
  if (suitOf(card) === led) return null;
  if (hand.some((c) => suitOf(c) === led)) return `You must follow suit (${SUIT_NAMES[led]}).`;
  return null;
}

export const legalCards = (room, seat) => room.hands[seat].filter((card) => illegalReason(room, seat, card) === null);

export function playCard(room, seat, card) {
  if (room.phase !== 'playing') return fail('The cards are not being played.');
  if (room.turn !== seat) return fail('It is not your turn.');
  if (typeof card !== 'string') return fail('That is not a card.');
  const reason = illegalReason(room, seat, card);
  if (reason) return fail(reason);
  const n = room.seats.length;
  room.hands[seat] = room.hands[seat].filter((c) => c !== card);
  room.trick.push({ seat, card });
  room.played.push(card);
  room.turn = room.trick.length === n ? null : (seat + 1) % n;
  return ok({ complete: room.trick.length === n });
}

/** The seat winning a (possibly unfinished) trick: the highest trump, or if there is none, the highest card led. */
export function trickWinner(trick, trump) {
  const led = suitOf(trick[0].card);
  const trumps = trump ? trick.filter((p) => suitOf(p.card) === trump) : [];
  const pool = trumps.length ? trumps : trick.filter((p) => suitOf(p.card) === led);
  return pool.reduce((best, play) => (rankValue(play.card) > rankValue(best.card) ? play : best)).seat;
}

/** Gives a finished trick to its winner, who leads next; after the last trick the round is scored. */
export function resolveTrick(room) {
  if (room.phase !== 'playing' || room.trick.length !== room.seats.length) return fail('There is no finished trick.');
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

function endRound(room) {
  const points = room.nominations.map((bid, seat) => scoreRound(bid, room.taken[seat], room.settings));
  room.scores = room.scores.map((score, seat) => score + points[seat]);
  room.nominations.forEach((bid, seat) => {
    const tally = room.tally[seat];
    tally.roundsPlayed++;
    tally.tricksWon += room.taken[seat];
    if (bid === room.taken[seat]) tally.bidsMade++;
  });
  room.history.push({
    round: room.roundIndex + 1,
    cards: cardsThisRound(room),
    trump: trumpThisRound(room),
    dealer: room.dealer,
    bids: [...room.nominations],
    taken: [...room.taken],
    points,
  });
  if (room.roundIndex + 1 >= roundCount(room.settings)) {
    room.phase = 'finished';
    room.winners = winnersOf(room.scores);
  } else {
    room.phase = 'roundEnd';
  }
}

export function nextRound(room, userId, rng = Math.random) {
  if (!hasPlayer(room, userId)) return fail('You are not in this game.');
  if (room.phase !== 'roundEnd') return fail('The round is not over.');
  room.roundIndex++;
  room.dealer = (room.dealer + 1) % room.seats.length;
  dealRound(room, rng);
  return ok();
}

export function playAgain(room, userId) {
  const problem = asHost(room, userId);
  if (problem) return problem;
  if (room.phase !== 'finished') return fail('The game is not over.');
  room.seats = room.seats.map((s) => (s?.kind === 'gone' ? null : s));
  resetGame(room);
  room.phase = 'lobby';
  return ok();
}

/** What the statistics should record for a finished game: one entry per human still seated. */
export function statsPlayers(room) {
  const place = placements(Object.fromEntries(room.scores.map((score, seat) => [seat, score])));
  return room.seats.flatMap((seat, i) =>
    isHuman(seat)
      ? [
          {
            userId: seat.id,
            outcome: room.winners.includes(i) ? 'win' : 'loss',
            placement: place[i],
            score: room.scores[i],
            extras: { ...room.tally[i], perfectGames: room.tally[i].roundsPlayed > 0 && room.tally[i].bidsMade === room.tally[i].roundsPlayed ? 1 : 0 },
          },
        ]
      : [],
  );
}

// ---- computer players ----

/** The next thing a computer (or the clock) has to do, or null when the game waits for a person. */
export function pendingAction(room) {
  if (room.phase === 'nominating') return isBot(room.seats[room.turn]) ? { type: 'nominate', seat: room.turn } : null;
  if (room.phase !== 'playing') return null;
  if (room.trick.length === room.seats.length) return { type: 'resolve' };
  return isBot(room.seats[room.turn]) ? { type: 'play', seat: room.turn } : null;
}

/** The card a computer player would play: always one of its legal cards. */
export function botPlay(room, seat) {
  return chooseCard({
    hand: room.hands[seat],
    legal: legalCards(room, seat),
    trick: room.trick.map((p) => p.card),
    trump: trumpThisRound(room),
    played: room.played,
    need: room.nominations[seat] - room.taken[seat],
    players: room.seats.length,
  });
}

export function botNominate(room, seat, rng = Math.random) {
  return chooseNomination({ hand: room.hands[seat], trump: trumpThisRound(room), players: room.seats.length, allowed: allowedNominations(room, seat), rng });
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  const result =
    action.type === 'nominate'
      ? nominate(room, action.seat, botNominate(room, action.seat, rng))
      : action.type === 'play'
        ? playCard(room, action.seat, botPlay(room, action.seat))
        : resolveTrick(room);
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}

// ---- what each player may see ----

/** The standard scoreboard rounds (shared/scores.js), plus the detail the round table shows. */
export function roundsView(room) {
  return room.history.map((h) => ({
    label: roundLabel(room.settings, h.round - 1),
    deltas: Object.fromEntries(h.points.map((points, seat) => [seat, points])),
    notes: Object.fromEntries(h.bids.map((bid, seat) => [seat, `bid ${bid}, took ${h.taken[seat]}`])),
    round: h.round,
    cards: h.cards,
    trump: h.trump,
    dealer: h.dealer,
    bids: h.bids,
    taken: h.taken,
  }));
}

/** Everything one account may know: its own hand and the public table, never anybody else's cards. */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
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
            away: seat.kind === 'gone' || (isHuman(seat) && !online(seat.id)),
            cards: room.hands[i].length,
            bid: room.nominations[i],
            tricks: room.taken[i],
            score: room.scores[i],
          }
        : null,
    ),
    rounds: roundsView(room),
    winners: room.winners,
    limits: { minSeats: MIN_SEATS, maxSeats: MAX_SEATS },
  };
  if (room.phase !== 'lobby') {
    const round = room.roundIndex;
    view.round = {
      number: round + 1,
      total: roundCount(room.settings),
      cards: handSize(room.settings, round),
      trump: trumpOf(round),
      dealer: room.dealer,
      label: roundLabel(room.settings, round),
    };
    view.hand = room.hands[me] ?? [];
    view.trick = room.trick;
    view.trickWinner = room.trick.length === room.seats.length ? trickWinner(room.trick, trumpOf(round)) : null;
    view.lastTrick = room.lastTrick;
    view.turn = room.turn;
    view.forbidden = forbiddenNow(room);
    const canPlay = room.phase === 'playing' && room.turn === me && room.trick.length < room.seats.length;
    view.legal = canPlay ? Object.fromEntries(room.hands[me].map((card) => [card, illegalReason(room, me, card)])) : null;
  }
  return view;
}
