// The rules of Cheat, with no sockets or files. A room is a plain object that can be saved as JSON.
// Every action returns { ok: true, ... } or { ok: false, error }.
//
// Three to seven players, all the cards dealt out. Turns go clockwise and each one has a rank to claim, which runs Ace, 2, 3 ...
// King and round again. On your turn you put one to four cards face down on the pile and say they are all of that rank (they
// need not be: that is the cheating). Anyone else may call "Cheat!" on the last play before the next one is made. If it was
// a lie its player picks up the whole pile; if it was true the caller does. The first player to get rid of every card wins,
// once nobody has caught their last play out.
//
// Seats 0..n-1 run clockwise. A seat holds a human ({ kind: 'human', id: <account id>, name }), a computer player
// ({ kind: 'bot', id: 'bot:<n>', name, ai }) or null (empty, lobby only).
import { placements } from '../../shared/scores.js';
import { RANKS, fullDeck, rankOf, shuffle, sortHand } from '../../shared/cards.js';
import { aiById, assignAIs, describeAI, pickAI } from '../../shared/ai.js';
import { AIS } from './ai/index.js';
import { extrasOf } from '../../shared/tally.js';
import { newTally, PUBLIC_KEYS, STAT_KEYS, tallyCall, tallyCleanGetaway, tallyHand, tallyLieStood, tallyPlay } from './tally.js';

export const MIN_SEATS = 3;
export const MAX_SEATS = 7;
export const DEFAULT_SEATS = 4;
export const MAX_PLAY = 4;
/** The ranks in the order they are claimed: the Ace first. */
export const SEQUENCE = ['A', ...RANKS.filter((rank) => rank !== 'A')];
export { STAT_KEYS };
export const BOT_NAMES = ['Hazel', 'Otis', 'Mabel', 'Felix', 'Ivy', 'Rufus', 'Nell', 'Boris', 'Pearl', 'Hugo'];

const LIVE = ['lobby', 'playing', 'check'];
const fail = (error) => ({ ok: false, error });
const ok = (extra = {}) => ({ ok: true, ...extra });

export const isLive = (room) => LIVE.includes(room.phase);
export const isHuman = (seat) => seat?.kind === 'human';
export const isBot = (seat) => seat?.kind === 'bot';
export const seatOf = (room, userId) => room.seats.findIndex((s) => isHuman(s) && s.id === userId);
export const hasPlayer = (room, userId) => seatOf(room, userId) !== -1;
export const humanSeats = (room) => room.seats.flatMap((s, i) => (isHuman(s) ? [i] : []));
export const isSeatCount = (n) => Number.isInteger(n) && n >= MIN_SEATS && n <= MAX_SEATS;
/** The rank to claim on the nth play of the game (0 for the first). */
export const rankFor = (plays) => SEQUENCE[plays % SEQUENCE.length];
/** Six or more players use two packs, so that there are enough cards to go round and to lie with. */
export const decksFor = (seats) => (seats >= 6 ? 2 : 1);
export const deckFor = (seats) => Array.from({ length: decksFor(seats) }, () => fullDeck()).flat();
const emptySeats = (n) => Array.from({ length: n }, () => null);
const seatsProblem = `A game has ${MIN_SEATS} to ${MAX_SEATS} players.`;
const nextSeat = (room, seat) => (seat + 1) % room.seats.length;

export function createRoom({ code, hostId, hostName, settings = {}, now = Date.now() }) {
  const seatCount = settings.seats ?? DEFAULT_SEATS;
  if (!isSeatCount(seatCount)) throw new Error(seatsProblem);
  const room = {
    code,
    hostId,
    phase: 'lobby',
    seats: [{ kind: 'human', id: hostId, name: hostName }, ...emptySeats(seatCount - 1)],
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
    hands: Array.from({ length: n }, () => []),
    pile: [], // every card played since the last pick-up, face down
    plays: 0, // plays made in the game: this decides the rank to claim
    turn: null,
    last: null, // the play that can still be called: { seat, count, rank, cards, lie }
    lastCall: null, // what the last call turned up, public until the next play
    decided: [], // computer seats that have decided about the last play (and, in the final check, everyone who has accepted it)
    winner: null,
    cardsLeft: null,
    tally: Array.from({ length: n }, newTally),
    recorded: false,
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
  const midGame = ['playing', 'check'].includes(room.phase);
  room.seats[seat] = midGame ? { ...newBot(room), ai: pickAI(AIS, rng).id } : null;
  const humans = humanSeats(room);
  if (!humans.length) return ok({ empty: true, seat });
  if (room.hostId === userId) room.hostId = room.seats[humans[0]].id;
  return ok({ empty: false, seat, replaced: midGame });
}

const asHost = (room, userId) => (room.hostId === userId ? null : fail('Only the host can do that.'));
const inLobby = (room) => (room.phase === 'lobby' ? null : fail('You can only change that before the game starts.'));

export function setSettings(room, userId, input) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  if (input?.seats !== undefined) {
    if (!isSeatCount(input.seats)) return fail(seatsProblem);
    const seated = room.seats.filter(Boolean).length;
    if (input.seats < seated) return fail('Remove a player first: that would leave too few seats.');
    resizeSeats(room, input.seats);
  }
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

// ---- starting ----

export function start(room, userId, rng = Math.random) {
  const problem = asHost(room, userId) ?? inLobby(room);
  if (problem) return problem;
  if (room.seats.some((s) => !s)) return fail(`All ${room.seats.length} seats need a player. Add computer players to fill the empty ones.`);
  if (!humanSeats(room).length) return fail('At least one person has to play.');
  resetGame(room);
  const n = room.seats.length;
  const deck = shuffle(deckFor(n), rng);
  const hands = Array.from({ length: n }, () => []);
  deck.forEach((card, i) => hands[i % n].push(card));
  room.hands = hands.map(sortHand);
  room.turn = Math.max(0, room.hands.findIndex((hand) => hand.includes('AS'))); // the Ace of Spades starts, as the Ace is claimed first
  room.phase = 'playing';
  // Every computer player picks its AI for the whole game (after the deal, so the deal itself is unchanged).
  const botSeats = room.seats.flatMap((s, i) => (isBot(s) ? [i] : []));
  const picks = assignAIs(AIS, botSeats, rng);
  for (const i of botSeats) room.seats[i].ai = picks[i];
  return ok();
}

// ---- playing ----

/** Puts one to four cards face down on the pile, claiming they are all of the rank of the turn (they need not be). */
export function playCards(room, seat, cards) {
  if (room.phase !== 'playing') return fail('The game is not being played.');
  if (room.turn !== seat) return fail('It is not your turn.');
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > MAX_PLAY) return fail(`Play between 1 and ${MAX_PLAY} cards.`);
  const hand = [...room.hands[seat]];
  for (const card of cards) {
    const at = typeof card === 'string' ? hand.indexOf(card) : -1;
    if (at === -1) return fail('You can only play cards from your hand.');
    hand.splice(at, 1);
  }
  const rank = rankFor(room.plays);
  const lie = cards.some((card) => rankOf(card) !== rank);
  room.hands[seat] = hand;
  room.pile.push(...cards);
  if (room.last?.lie) tallyLieStood(room.tally[room.last.seat]); // nobody called the play before this one
  room.last = { seat, count: cards.length, rank, cards: [...cards], lie };
  room.plays++;
  room.decided = [];
  room.lastCall = null;
  tallyPlay(room.tally[seat], { count: cards.length, lie });
  if (hand.length === 0) {
    room.phase = 'check'; // out of cards: they win unless this last play is caught out
    room.turn = null;
  } else room.turn = nextSeat(room, seat);
  return ok();
}

/** Calls "Cheat!" on the last play. Whoever is wrong picks up the pile. */
export function callCheat(room, seat) {
  if (!['playing', 'check'].includes(room.phase) || !room.last) return fail('There is nothing to call.');
  if (!Number.isInteger(seat) || !room.seats[seat]) return fail('You are not in this game.');
  if (seat === room.last.seat) return fail('You cannot call your own play.');
  const { seat: accused, rank, count, cards, lie } = room.last;
  const picker = lie ? accused : seat;
  const pileSize = room.pile.length;
  const held = room.hands[picker];
  room.hands[picker] = sortHand([...held, ...room.pile]);
  tallyHand(room.tally[picker], held, room.hands[picker]);
  room.pile = [];
  room.lastCall = { caller: seat, accused, rank, count, cards: [...cards], lie, picker, pileSize };
  tallyCall(room.tally[seat], room.tally[accused], lie);
  room.last = null;
  room.decided = [];
  if (room.phase === 'check') {
    if (lie) {
      room.phase = 'playing';
      room.turn = nextSeat(room, accused);
    } else finish(room, accused);
  }
  return ok({ lie });
}

/** In the final check, a person says they believe the last play, so that the player who went out can win. */
export function accept(room, seat) {
  if (room.phase !== 'check' || !room.last) return fail('There is no last play to accept.');
  if (!Number.isInteger(seat) || !room.seats[seat]) return fail('You are not in this game.');
  if (seat === room.last.seat) return fail('You cannot accept your own play.');
  if (!room.decided.includes(seat)) room.decided.push(seat);
  settleCheck(room);
  return ok();
}

/** The player who went out wins once everybody else has accepted their last play. */
function settleCheck(room) {
  if (room.phase !== 'check' || !room.last) return;
  const others = room.seats.map((_, i) => i).filter((i) => i !== room.last.seat);
  if (!others.every((i) => room.decided.includes(i))) return;
  if (room.last.lie) {
    tallyLieStood(room.tally[room.last.seat]);
    tallyCleanGetaway(room.tally[room.last.seat]);
  }
  finish(room, room.last.seat);
}

function finish(room, winner) {
  room.phase = 'finished';
  room.winner = winner;
  room.turn = null;
  room.last = null;
  room.cardsLeft = room.hands.map((hand) => hand.length);
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
  const left = room.cardsLeft ?? room.hands.map((hand) => hand.length);
  const places = placements(Object.fromEntries(left.map((count, seat) => [seat, count])), { lowIsBetter: true });
  return room.seats.flatMap((seat, i) =>
    isHuman(seat)
      ? [{ userId: seat.id, outcome: room.winner === i ? 'win' : 'loss', placement: places[i], score: left[i], extras: { ...extrasOf(room.tally[i], STAT_KEYS), honestWins: room.winner === i && !room.tally[i].liesTold ? 1 : 0 } }]
      : [],
  );
}

// ---- computer players ----

/** The AI a computer seat plays with. Seats without one get the first, standard AI. */
export const aiOf = (room, seat) => aiById(AIS, room.seats[seat]?.ai);

/** The plain data an AI decides from: its own hand and what everyone can see, never other hands or what was really played. */
export function aiContext(room, seat, rng = Math.random) {
  return {
    seat,
    hand: [...room.hands[seat]],
    rank: rankFor(room.plays),
    plays: room.plays,
    pileSize: room.pile.length,
    handSizes: room.hands.map((hand) => hand.length),
    decks: decksFor(room.seats.length),
    maxPlay: MAX_PLAY,
    last: room.last ? { seat: room.last.seat, count: room.last.count, rank: room.last.rank } : null,
    final: room.phase === 'check',
    rng,
  };
}

/** The cards a computer player plays: always one to four cards from its hand, chosen by its own AI. */
export function botPlay(room, seat, rng = Math.random) {
  const hand = room.hands[seat];
  const valid = (cards) => {
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > MAX_PLAY) return false;
    const rest = [...hand];
    return cards.every((card) => {
      const at = rest.indexOf(card);
      if (at === -1) return false;
      rest.splice(at, 1);
      return true;
    });
  };
  let cards;
  try {
    cards = aiOf(room, seat).play(aiContext(room, seat, rng));
  } catch {
    cards = undefined; // a broken AI must not stop the game
  }
  return valid(cards) ? cards : [hand[0]];
}

/** Whether a computer player calls "Cheat!" on the last play. */
export function botCalls(room, seat, rng = Math.random) {
  try {
    return aiOf(room, seat).call(aiContext(room, seat, rng)) === true;
  } catch {
    return false;
  }
}

/** The next thing a computer player has to do, or null when the game waits for a person. */
export function pendingAction(room) {
  if (!['playing', 'check'].includes(room.phase)) return null;
  if (room.last) {
    const seat = room.seats.findIndex((s, i) => isBot(s) && i !== room.last.seat && !room.decided.includes(i));
    if (seat !== -1) return { type: 'decide', seat };
  }
  if (room.phase === 'playing' && isBot(room.seats[room.turn])) return { type: 'play', seat: room.turn };
  return null;
}

/** Performs a pending action. Returns the action, or null if there was nothing to do. */
export function runPending(room, rng = Math.random) {
  const action = pendingAction(room);
  if (!action) return null;
  let result;
  if (action.type === 'decide') {
    if (botCalls(room, action.seat, rng)) result = callCheat(room, action.seat);
    else {
      room.decided.push(action.seat);
      settleCheck(room);
      result = ok();
    }
  } else result = playCards(room, action.seat, botPlay(room, action.seat, rng));
  if (!result.ok) throw new Error(`A computer player made an illegal move: ${result.error}`);
  return action;
}

// ---- what each player may see ----

/** Everything one account may know: its own hand and the table as everybody sees it, never anybody else's cards. */
export function viewFor(room, userId, { online = () => true } = {}) {
  const me = seatOf(room, userId);
  const live = ['playing', 'check'].includes(room.phase);
  const started = room.phase !== 'lobby';
  const view = {
    code: room.code,
    phase: room.phase,
    you: me,
    hostSeat: seatOf(room, room.hostId),
    seatCount: room.seats.length,
    decks: decksFor(room.seats.length),
    seats: room.seats.map((seat, i) =>
      seat
        ? {
            seat: i,
            name: seat.name,
            bot: isBot(seat),
            ...(isBot(seat) && started ? { ai: describeAIBrief(aiOf(room, i)) } : {}),
            online: isBot(seat) || online(seat.id),
            cards: room.hands[i].length,
            ...(started ? { stats: extrasOf(room.tally[i], PUBLIC_KEYS) } : {}),
          }
        : null,
    ),
    scoreboard: {
      // Cards left are the score: fewer is better.
      players: room.seats.flatMap((seat, i) => (seat ? [{ id: i, name: seat.name, userId: isHuman(seat) ? seat.id : undefined, score: room.hands[i].length, isMe: i === me, bot: isBot(seat), current: room.phase === 'playing' && room.turn === i, away: isHuman(seat) && !online(seat.id) }] : [])),
      rounds: [],
      lowIsBetter: true,
    },
    winner: room.winner,
    limits: { minSeats: MIN_SEATS, maxSeats: MAX_SEATS, maxPlay: MAX_PLAY },
  };
  if (started) {
    view.hand = me === -1 ? [] : [...room.hands[me]];
    view.pile = room.pile.length;
    view.turn = room.turn;
    view.plays = room.plays;
    view.rank = live ? rankFor(room.plays) : null;
    view.last = room.last ? { seat: room.last.seat, count: room.last.count, rank: room.last.rank } : null;
    view.lastCall = room.lastCall ? { ...room.lastCall, cards: [...room.lastCall.cards] } : null;
    view.canPlay = room.phase === 'playing' && room.turn === me && me !== -1;
    view.canCall = live && Boolean(room.last) && me !== -1 && room.last.seat !== me;
    view.mustRespond = room.phase === 'check' && Boolean(room.last) && me !== -1 && room.last.seat !== me && !room.decided.includes(me);
  }
  return view;
}

const describeAIBrief = (ai) => {
  const { id, name } = describeAI(ai);
  return { id, name };
};
